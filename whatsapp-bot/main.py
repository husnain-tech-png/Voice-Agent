"""
============================================================
  WhatsApp Cloud API — AI Voice Agent Backend
  Stage 6 of Voice Agent Project
============================================================

  A complete FastAPI webhook server that receives WhatsApp
  voice notes, transcribes them via Groq Whisper, generates
  a conversational reply with a Groq LLM, synthesizes the
  reply into speech using edge-tts, and sends the audio
  response back to the user on WhatsApp.

  Pipeline:
    Voice Note (.ogg) → Groq Whisper STT → Groq LLM →
    edge-tts TTS → Upload to Meta → WhatsApp Audio Reply

  Run with:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
============================================================
"""

import os
import io
import uuid
import time
import logging
import tempfile
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager

import httpx
import edge_tts
from groq import Groq
from dotenv import load_dotenv
from fastapi import FastAPI, Request, BackgroundTasks, HTTPException
from fastapi.responses import PlainTextResponse, JSONResponse

# ============================================================
# 1. ENVIRONMENT CONFIGURATION
# ============================================================
# Load variables from .env file in the project root.
# Create a .env file with the following keys:
#
#   WHATSAPP_TOKEN=EAAxxxxxxx        ← Meta permanent access token
#   PHONE_NUMBER_ID=123456789012345  ← Your WhatsApp phone number ID
#   VERIFY_TOKEN=my_custom_secret    ← Any string you choose for webhook verification
#   GROQ_API_KEY=gsk_xxxxxxx        ← Groq Cloud API key
#
load_dotenv()

WHATSAPP_TOKEN  = os.environ.get("WHATSAPP_TOKEN", "")
PHONE_NUMBER_ID = os.environ.get("PHONE_NUMBER_ID", "")
VERIFY_TOKEN    = os.environ.get("VERIFY_TOKEN", "")
GROQ_API_KEY    = os.environ.get("GROQ_API_KEY", "")

# Edge TTS voice — "en-US-AriaNeural" is a natural, warm female voice.
# Other options: "en-US-GuyNeural", "en-US-JennyNeural", "en-GB-SoniaNeural"
EDGE_TTS_VOICE = os.environ.get("EDGE_TTS_VOICE", "en-US-AriaNeural")

# Groq LLM model for conversational replies
GROQ_LLM_MODEL = os.environ.get("GROQ_LLM_MODEL", "llama-3.3-70b-versatile")

# Groq Whisper model for speech-to-text
GROQ_STT_MODEL = os.environ.get("GROQ_STT_MODEL", "whisper-large-v3")

# Meta Graph API base URL
META_API_BASE = "https://graph.facebook.com/v21.0"

# ============================================================
# 2. LOGGING
# ============================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)-7s │ %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("whatsapp-voice-agent")

# ============================================================
# 3. SYSTEM PROMPT — Customize the assistant's personality
# ============================================================
SYSTEM_PROMPT = """You are a friendly, helpful voice assistant responding to WhatsApp voice messages on behalf of the user. Keep your responses:
- Concise and conversational (2-4 sentences ideal for voice)
- Warm and natural — you're speaking, not writing an essay
- Helpful and clear — answer questions directly
- If someone greets you, greet them back warmly

Important: Your response will be converted to speech audio, so avoid markdown formatting, bullet points, code blocks, or special characters. Write naturally as if you're talking to a friend."""

# ============================================================
# 4. IN-MEMORY CONVERSATION HISTORY (per sender)
# ============================================================
# Stores the last N exchanges per user for contextual replies.
# Key: WhatsApp phone number, Value: list of message dicts.
MAX_HISTORY_TURNS = 10
conversation_history: dict[str, list[dict]] = {}


def get_history(sender: str) -> list[dict]:
    """Retrieve or initialize conversation history for a sender."""
    if sender not in conversation_history:
        conversation_history[sender] = []
    return conversation_history[sender]


def append_history(sender: str, role: str, content: str):
    """Append a message to the sender's history, trimming if needed."""
    history = get_history(sender)
    history.append({"role": role, "content": content})
    # Keep only the last N turns (each turn = 2 messages)
    if len(history) > MAX_HISTORY_TURNS * 2:
        conversation_history[sender] = history[-(MAX_HISTORY_TURNS * 2):]


# ============================================================
# 5. DEDUPLICATION GUARD
# ============================================================
# WhatsApp sometimes delivers the same webhook event multiple times.
# Track recent message IDs to avoid processing duplicates.
processed_messages: set[str] = set()
MAX_PROCESSED_CACHE = 1000


def is_duplicate(message_id: str) -> bool:
    """Check if this message was already processed."""
    if message_id in processed_messages:
        return True
    processed_messages.add(message_id)
    # Prevent unbounded memory growth
    if len(processed_messages) > MAX_PROCESSED_CACHE:
        # Remove oldest entries (sets are unordered, so just clear half)
        to_remove = list(processed_messages)[:MAX_PROCESSED_CACHE // 2]
        for item in to_remove:
            processed_messages.discard(item)
    return False


# ============================================================
# 6. GROQ CLIENT INITIALIZATION
# ============================================================
groq_client: Groq | None = None


# ============================================================
# 7. APPLICATION LIFESPAN (startup / shutdown)
# ============================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize resources on startup, clean up on shutdown."""
    global groq_client

    # --- Startup ---
    log.info("=" * 60)
    log.info("  WhatsApp Voice Agent — Starting Up")
    log.info("=" * 60)

    # Validate required environment variables
    missing = []
    if not WHATSAPP_TOKEN:  missing.append("WHATSAPP_TOKEN")
    if not PHONE_NUMBER_ID: missing.append("PHONE_NUMBER_ID")
    if not VERIFY_TOKEN:    missing.append("VERIFY_TOKEN")
    if not GROQ_API_KEY:    missing.append("GROQ_API_KEY")

    if missing:
        log.warning(f"⚠️  Missing environment variables: {', '.join(missing)}")
        log.warning("   The server will start, but voice processing will fail.")
        log.warning("   Add them to your .env file and restart.")
    else:
        log.info("✅ All environment variables loaded successfully.")

    # Initialize Groq client
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
        log.info(f"✅ Groq client initialized (LLM: {GROQ_LLM_MODEL}, STT: {GROQ_STT_MODEL})")
    else:
        log.warning("⚠️  Groq client not initialized — GROQ_API_KEY missing.")

    log.info(f"🎤 Edge TTS voice: {EDGE_TTS_VOICE}")
    log.info(f"📱 Phone Number ID: {PHONE_NUMBER_ID or '(not set)'}")
    log.info("🚀 Server ready — waiting for WhatsApp webhooks...\n")

    yield  # App is running

    # --- Shutdown ---
    log.info("👋 WhatsApp Voice Agent shutting down.")


# ============================================================
# 8. FASTAPI APPLICATION
# ============================================================
app = FastAPI(
    title="WhatsApp Voice Agent",
    description="AI voice assistant that responds to WhatsApp voice notes",
    version="1.0.0",
    lifespan=lifespan,
)


# ============================================================
# 9. HEALTH CHECK ENDPOINT
# ============================================================
@app.get("/health")
async def health_check():
    """Quick health check with configuration status."""
    return {
        "status": "ok",
        "service": "whatsapp-voice-agent",
        "config": {
            "whatsapp_token": "✅ set" if WHATSAPP_TOKEN else "❌ missing",
            "phone_number_id": "✅ set" if PHONE_NUMBER_ID else "❌ missing",
            "verify_token": "✅ set" if VERIFY_TOKEN else "❌ missing",
            "groq_api_key": "✅ set" if GROQ_API_KEY else "❌ missing",
            "llm_model": GROQ_LLM_MODEL,
            "stt_model": GROQ_STT_MODEL,
            "tts_voice": EDGE_TTS_VOICE,
        },
        "active_conversations": len(conversation_history),
    }


# ============================================================
# 10. WEBHOOK VERIFICATION (GET)
# ============================================================
# Meta sends a GET request to verify your webhook URL during
# setup in the Meta Developer Console. It includes:
#   - hub.mode: should be "subscribe"
#   - hub.verify_token: must match YOUR chosen VERIFY_TOKEN
#   - hub.challenge: a random string you must echo back
# ============================================================
@app.get("/webhook")
async def verify_webhook(request: Request):
    """
    Handle Meta's webhook verification challenge.

    Meta Developer Console → WhatsApp → Configuration → Webhook URL
    Enter your URL (e.g., https://yourdomain.com/webhook) and your
    VERIFY_TOKEN string. Meta will send a GET request here to confirm.
    """
    params = request.query_params
    mode = params.get("hub.mode", "")
    token = params.get("hub.verify_token", "")
    challenge = params.get("hub.challenge", "")

    if mode == "subscribe" and token == VERIFY_TOKEN:
        log.info(f"✅ Webhook verified successfully (challenge: {challenge[:20]}...)")
        # CRITICAL: Return the challenge as plain text, not JSON
        return PlainTextResponse(content=challenge, status_code=200)
    else:
        log.warning(f"❌ Webhook verification failed — token mismatch or bad mode")
        log.warning(f"   Received mode='{mode}', token='{token[:10]}...'")
        raise HTTPException(status_code=403, detail="Verification failed")


# ============================================================
# 11. WEBHOOK MESSAGE INGESTION (POST)
# ============================================================
# This is the main entry point for all WhatsApp events.
# CRITICAL: WhatsApp requires a fast 200 OK response within
# a few seconds, or it will retry (and eventually disable
# the webhook). We immediately return 200 and process
# the voice note in a background task.
# ============================================================
@app.post("/webhook")
async def receive_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Receive incoming WhatsApp messages and dispatch processing
    as a background task to avoid blocking the 200 OK response.
    """
    try:
        body = await request.json()
    except Exception:
        log.warning("⚠️  Received non-JSON webhook payload, ignoring.")
        return JSONResponse(content={"status": "ok"}, status_code=200)

    # ---- Extract message data from the nested WhatsApp payload ----
    # The WhatsApp Cloud API nests messages deeply:
    #   body.entry[].changes[].value.messages[]
    try:
        entry = body.get("entry", [])
        if not entry:
            return JSONResponse(content={"status": "ok"}, status_code=200)

        changes = entry[0].get("changes", [])
        if not changes:
            return JSONResponse(content={"status": "ok"}, status_code=200)

        value = changes[0].get("value", {})
        messages = value.get("messages", [])

        if not messages:
            # This might be a status update (delivered, read, etc.) — not a message.
            # Acknowledge silently.
            log.debug("Received non-message event (status update), acknowledged.")
            return JSONResponse(content={"status": "ok"}, status_code=200)

        message = messages[0]
        sender = message.get("from", "unknown")          # Sender's WhatsApp number
        message_id = message.get("id", "")                # Unique message ID
        message_type = message.get("type", "unknown")     # "audio", "text", "image", etc.
        timestamp = message.get("timestamp", "")          # Unix timestamp

    except (IndexError, KeyError, TypeError) as e:
        log.warning(f"⚠️  Malformed webhook payload: {e}")
        return JSONResponse(content={"status": "ok"}, status_code=200)

    # ---- Deduplication check ----
    if is_duplicate(message_id):
        log.debug(f"Duplicate message {message_id} — skipping.")
        return JSONResponse(content={"status": "ok"}, status_code=200)

    log.info(f"📩 Incoming {message_type} message from +{sender} (ID: {message_id})")

    # ---- Route by message type ----
    if message_type == "audio":
        # 🎤 Voice note — trigger the full voice pipeline
        audio_info = message.get("audio", {})
        media_id = audio_info.get("id", "")

        if not media_id:
            log.error("❌ Audio message received but no media_id found.")
            return JSONResponse(content={"status": "ok"}, status_code=200)

        log.info(f"🎤 Voice note detected — media_id: {media_id}")

        # Dispatch to background task so we can return 200 immediately
        background_tasks.add_task(
            process_voice_pipeline,
            sender=sender,
            media_id=media_id,
            message_id=message_id,
        )

    elif message_type == "text":
        # 📝 Text message — respond with a helpful nudge to use voice
        text_body = message.get("text", {}).get("body", "")
        log.info(f"📝 Text message from +{sender}: \"{text_body[:80]}\"")

        # Process text messages through LLM too (as a nice fallback)
        background_tasks.add_task(
            process_text_pipeline,
            sender=sender,
            text=text_body,
            message_id=message_id,
        )

    else:
        # Unsupported type (image, video, sticker, location, etc.)
        log.info(f"⏭️  Unsupported message type '{message_type}' from +{sender}, sending hint.")
        background_tasks.add_task(
            send_text_message,
            recipient=sender,
            text="👋 Hey! I'm a voice assistant — send me a *voice note* 🎤 and I'll reply with one! You can also type a text message and I'll respond.",
        )

    # CRITICAL: Return 200 immediately so WhatsApp doesn't retry
    return JSONResponse(content={"status": "ok"}, status_code=200)


# ============================================================
# 12. VOICE PIPELINE — The Core Processing Chain
# ============================================================
# This is the background task that handles the full pipeline:
#   Download audio → STT → LLM → TTS → Upload → Send
# ============================================================
async def process_voice_pipeline(sender: str, media_id: str, message_id: str):
    """
    Complete voice-to-voice pipeline:
      1. Download .ogg voice note from Meta
      2. Transcribe with Groq Whisper (STT)
      3. Generate reply with Groq LLM
      4. Synthesize speech with edge-tts (TTS)
      5. Upload audio to Meta
      6. Send audio message back to user
    """
    pipeline_start = time.time()

    try:
        # ---- Step 1: Download the voice note from Meta ----
        log.info(f"⬇️  [1/6] Downloading voice note (media_id: {media_id})...")
        audio_bytes = await download_whatsapp_media(media_id)
        if not audio_bytes:
            log.error("❌ Failed to download voice note. Sending error message.")
            await send_text_message(sender, "Sorry, I couldn't download your voice note. Please try sending it again! 🔄")
            return
        log.info(f"   ✅ Downloaded {len(audio_bytes):,} bytes")

        # ---- Step 2: Transcribe with Groq Whisper ----
        log.info(f"👂 [2/6] Transcribing audio with Groq Whisper ({GROQ_STT_MODEL})...")
        stt_start = time.time()
        transcribed_text = await transcribe_audio(audio_bytes)
        stt_duration = time.time() - stt_start

        if not transcribed_text:
            log.error("❌ Transcription returned empty. Sending error message.")
            await send_text_message(sender, "I couldn't understand that voice note — it might be too short or too noisy. Try again? 🎤")
            return
        log.info(f"   ✅ Transcribed in {stt_duration:.2f}s: \"{transcribed_text[:100]}\"")

        # Save user's transcribed message to history
        append_history(sender, "user", transcribed_text)

        # ---- Step 3: Generate LLM reply ----
        log.info(f"🧠 [3/6] Generating reply with Groq LLM ({GROQ_LLM_MODEL})...")
        llm_start = time.time()
        reply_text = await generate_llm_reply(sender, transcribed_text)
        llm_duration = time.time() - llm_start

        if not reply_text:
            log.error("❌ LLM returned empty response. Sending fallback.")
            await send_text_message(sender, "Sorry, I had trouble thinking of a response. Please try again! 🤔")
            return
        log.info(f"   ✅ LLM replied in {llm_duration:.2f}s: \"{reply_text[:100]}\"")

        # Save assistant's reply to history
        append_history(sender, "assistant", reply_text)

        # ---- Step 4: Synthesize speech with edge-tts ----
        log.info(f"🔊 [4/6] Synthesizing speech with edge-tts ({EDGE_TTS_VOICE})...")
        tts_start = time.time()
        tts_audio_path = await synthesize_speech(reply_text)
        tts_duration = time.time() - tts_start

        if not tts_audio_path:
            log.error("❌ TTS synthesis failed. Sending text reply as fallback.")
            await send_text_message(sender, f"🤖 {reply_text}")
            return
        tts_size = os.path.getsize(tts_audio_path)
        log.info(f"   ✅ Synthesized in {tts_duration:.2f}s ({tts_size:,} bytes)")

        # ---- Step 5: Upload audio to Meta ----
        log.info(f"⬆️  [5/6] Uploading audio to Meta...")
        upload_start = time.time()
        new_media_id = await upload_media_to_whatsapp(tts_audio_path)
        upload_duration = time.time() - upload_start

        if not new_media_id:
            log.error("❌ Media upload failed. Sending text reply as fallback.")
            await send_text_message(sender, f"🤖 {reply_text}")
            return
        log.info(f"   ✅ Uploaded in {upload_duration:.2f}s (new media_id: {new_media_id})")

        # ---- Step 6: Send audio message back ----
        log.info(f"📤 [6/6] Sending audio reply to +{sender}...")
        success = await send_audio_message(sender, new_media_id)

        pipeline_total = time.time() - pipeline_start
        if success:
            log.info(f"🎉 Pipeline complete! Total: {pipeline_total:.2f}s "
                     f"(STT: {stt_duration:.2f}s, LLM: {llm_duration:.2f}s, "
                     f"TTS: {tts_duration:.2f}s, Upload: {upload_duration:.2f}s)")
        else:
            log.error("❌ Failed to send audio message. Sending text fallback.")
            await send_text_message(sender, f"🤖 {reply_text}")

    except Exception as e:
        log.exception(f"💥 Pipeline crashed for +{sender}: {e}")
        try:
            await send_text_message(
                sender,
                "Oops! Something went wrong processing your voice note. Please try again in a moment. 🙏"
            )
        except Exception:
            log.exception("💥 Even the error message failed to send!")

    finally:
        # Clean up temporary TTS file
        if 'tts_audio_path' in locals() and tts_audio_path and os.path.exists(tts_audio_path):
            try:
                os.remove(tts_audio_path)
            except OSError:
                pass


# ============================================================
# 13. TEXT MESSAGE PIPELINE (Fallback for text inputs)
# ============================================================
async def process_text_pipeline(sender: str, text: str, message_id: str):
    """Process a text message through the LLM and reply with text + audio."""
    try:
        append_history(sender, "user", text)

        reply_text = await generate_llm_reply(sender, text)
        if not reply_text:
            await send_text_message(sender, "Sorry, I couldn't generate a response. Please try again! 🤔")
            return

        append_history(sender, "assistant", reply_text)

        # Try to send an audio reply for a premium voice experience
        tts_audio_path = await synthesize_speech(reply_text)
        if tts_audio_path:
            new_media_id = await upload_media_to_whatsapp(tts_audio_path)
            if new_media_id:
                await send_audio_message(sender, new_media_id)
                # Clean up temp file
                try:
                    os.remove(tts_audio_path)
                except OSError:
                    pass
                return
            # Clean up temp file on upload failure
            try:
                os.remove(tts_audio_path)
            except OSError:
                pass

        # Fallback: send text if TTS/upload failed
        await send_text_message(sender, f"🤖 {reply_text}")

    except Exception as e:
        log.exception(f"💥 Text pipeline crashed for +{sender}: {e}")
        try:
            await send_text_message(sender, "Oops! Something went wrong. Please try again. 🙏")
        except Exception:
            pass


# ============================================================
# 14. META API: Download WhatsApp Media
# ============================================================
# Two-step process:
#   1. GET /media_id → returns a JSON with a "url" field
#   2. GET that url → returns the actual binary audio data
# Both requests require the Bearer token in the header.
# ============================================================
async def download_whatsapp_media(media_id: str) -> bytes | None:
    """
    Download a media file from WhatsApp Cloud API.

    Step 1: Retrieve the download URL from the media ID.
    Step 2: Download the actual file bytes from that URL.
    Both steps require the Bearer token.
    """
    headers = {"Authorization": f"Bearer {WHATSAPP_TOKEN}"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # Step 1: Get the media download URL
            url_response = await client.get(
                f"{META_API_BASE}/{media_id}",
                headers=headers,
            )
            url_response.raise_for_status()
            media_url = url_response.json().get("url")

            if not media_url:
                log.error(f"❌ No 'url' field in media metadata: {url_response.json()}")
                return None

            # Step 2: Download the actual audio file
            # IMPORTANT: Must pass the Bearer token again for the download URL
            file_response = await client.get(media_url, headers=headers)
            file_response.raise_for_status()

            return file_response.content

        except httpx.HTTPStatusError as e:
            log.error(f"❌ Meta API HTTP error downloading media: {e.response.status_code} — {e.response.text[:200]}")
            return None
        except httpx.RequestError as e:
            log.error(f"❌ Network error downloading media: {e}")
            return None


# ============================================================
# 15. GROQ: Speech-to-Text Transcription
# ============================================================
# Uses Groq's hosted Whisper model for ultra-fast transcription.
# The Groq SDK's audio.transcriptions.create() expects a file
# tuple: (filename, file_bytes, mime_type).
# ============================================================
async def transcribe_audio(audio_bytes: bytes) -> str | None:
    """
    Transcribe audio bytes using Groq Whisper (whisper-large-v3).
    Returns the transcribed text or None on failure.
    """
    if not groq_client:
        log.error("❌ Groq client not initialized — cannot transcribe.")
        return None

    try:
        # Run the synchronous Groq SDK call in a thread pool
        # to avoid blocking the async event loop
        transcription = await asyncio.to_thread(
            groq_client.audio.transcriptions.create,
            file=("voice_note.ogg", audio_bytes, "audio/ogg"),
            model=GROQ_STT_MODEL,
            language="en",  # Hint for better accuracy; Whisper auto-detects anyway
        )

        text = transcription.text.strip()
        return text if text else None

    except Exception as e:
        log.exception(f"❌ Groq STT error: {e}")
        return None


# ============================================================
# 16. GROQ: LLM Conversational Reply
# ============================================================
# Sends the transcribed text (with conversation history)
# to a Groq-hosted LLM for a conversational reply.
# ============================================================
async def generate_llm_reply(sender: str, user_text: str) -> str | None:
    """
    Generate a conversational reply using Groq LLM.
    Includes conversation history for context.
    """
    if not groq_client:
        log.error("❌ Groq client not initialized — cannot generate reply.")
        return None

    try:
        # Build message list: system prompt + conversation history
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]

        # Add conversation history (excluding the current message,
        # which we already appended before calling this function)
        history = get_history(sender)
        # Include all history except the last entry (which is the current user message)
        if len(history) > 1:
            messages.extend(history[:-1])

        # Add the current user message
        messages.append({"role": "user", "content": user_text})

        # Run the synchronous Groq SDK call in a thread pool
        completion = await asyncio.to_thread(
            groq_client.chat.completions.create,
            model=GROQ_LLM_MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=300,  # Keep responses concise for voice
        )

        reply = completion.choices[0].message.content.strip()
        return reply if reply else None

    except Exception as e:
        log.exception(f"❌ Groq LLM error: {e}")
        return None


# ============================================================
# 17. EDGE-TTS: Text-to-Speech Synthesis
# ============================================================
# Uses Microsoft Edge's free TTS engine via the edge-tts library.
# Generates an MP3 file saved to a temp directory.
# Completely free — no API key required.
# ============================================================
async def synthesize_speech(text: str) -> str | None:
    """
    Synthesize text to speech using edge-tts.
    Returns the path to the generated MP3 file, or None on failure.
    """
    try:
        # Generate a unique filename in the system temp directory
        output_path = os.path.join(
            tempfile.gettempdir(),
            f"wa_tts_{uuid.uuid4().hex[:12]}.mp3"
        )

        # edge-tts Communicate is fully async
        communicate = edge_tts.Communicate(text=text, voice=EDGE_TTS_VOICE)
        await communicate.save(output_path)

        # Verify the file was actually created and has content
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return output_path
        else:
            log.error("❌ edge-tts produced an empty or missing file.")
            return None

    except Exception as e:
        log.exception(f"❌ edge-tts synthesis error: {e}")
        return None


# ============================================================
# 18. META API: Upload Media to WhatsApp
# ============================================================
# Upload the synthesized audio file to WhatsApp Cloud API
# so we get a media_id we can reference in a message.
# ============================================================
async def upload_media_to_whatsapp(file_path: str) -> str | None:
    """
    Upload an audio file to WhatsApp Cloud API.
    Returns the new media_id, or None on failure.
    """
    headers = {"Authorization": f"Bearer {WHATSAPP_TOKEN}"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            with open(file_path, "rb") as f:
                file_data = f.read()

            # Upload as multipart form data
            files = {
                "file": ("voice_reply.mp3", file_data, "audio/mpeg"),
            }
            data = {
                "messaging_product": "whatsapp",
                "type": "audio/mpeg",
            }

            response = await client.post(
                f"{META_API_BASE}/{PHONE_NUMBER_ID}/media",
                headers=headers,
                files=files,
                data=data,
            )
            response.raise_for_status()

            result = response.json()
            media_id = result.get("id")

            if not media_id:
                log.error(f"❌ Upload response missing 'id': {result}")
                return None

            return media_id

        except httpx.HTTPStatusError as e:
            log.error(f"❌ Meta API upload error: {e.response.status_code} — {e.response.text[:200]}")
            return None
        except httpx.RequestError as e:
            log.error(f"❌ Network error uploading media: {e}")
            return None


# ============================================================
# 19. META API: Send Audio Message
# ============================================================
# Send a WhatsApp audio message using an uploaded media_id.
# ============================================================
async def send_audio_message(recipient: str, media_id: str) -> bool:
    """
    Send an audio message to a WhatsApp user.
    Returns True on success, False on failure.
    """
    headers = {
        "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        "Content-Type": "application/json",
    }

    payload = {
        "messaging_product": "whatsapp",
        "to": recipient,
        "type": "audio",
        "audio": {
            "id": media_id,
        },
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                f"{META_API_BASE}/{PHONE_NUMBER_ID}/messages",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            log.info(f"✅ Audio message sent to +{recipient}")
            return True

        except httpx.HTTPStatusError as e:
            log.error(f"❌ Failed to send audio message: {e.response.status_code} — {e.response.text[:200]}")
            return False
        except httpx.RequestError as e:
            log.error(f"❌ Network error sending audio message: {e}")
            return False


# ============================================================
# 20. META API: Send Text Message (Fallback / Utility)
# ============================================================
async def send_text_message(recipient: str, text: str) -> bool:
    """
    Send a plain text message to a WhatsApp user.
    Used as a fallback when audio fails, or for system messages.
    """
    headers = {
        "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        "Content-Type": "application/json",
    }

    payload = {
        "messaging_product": "whatsapp",
        "to": recipient,
        "type": "text",
        "text": {
            "body": text,
        },
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                f"{META_API_BASE}/{PHONE_NUMBER_ID}/messages",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            log.info(f"✅ Text message sent to +{recipient}")
            return True

        except httpx.HTTPStatusError as e:
            log.error(f"❌ Failed to send text message: {e.response.status_code} — {e.response.text[:200]}")
            return False
        except httpx.RequestError as e:
            log.error(f"❌ Network error sending text message: {e}")
            return False


# ============================================================
# 21. ENTRY POINT
# ============================================================
# Run directly with: python main.py
# Or with uvicorn: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
