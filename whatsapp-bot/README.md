# 🤖 WhatsApp Voice Agent — Stage 6

> **AI voice assistant that responds to WhatsApp voice notes with voice notes.**

## Pipeline Architecture

```
📱 User sends voice note on WhatsApp
        │
        ▼
[Meta Cloud API Webhook — POST /webhook]
        │  (Immediate 200 OK → Background Task)
        │
        ▼  Step 1: Download .ogg
[Meta Graph API — GET /media/{id}]
        │
        ▼  Step 2: Speech-to-Text
[Groq Whisper (whisper-large-v3) — ~200ms]
        │
        ▼  Step 3: LLM Reply
[Groq LLM (llama-3.3-70b-versatile) — ~300ms]
        │
        ▼  Step 4: Text-to-Speech
[edge-tts (AriaNeural) — ~400ms, FREE]
        │
        ▼  Step 5: Upload .mp3
[Meta Graph API — POST /media]
        │
        ▼  Step 6: Send audio reply
[Meta Messages API — POST /messages]
        │
        ▼
📱 User receives voice note reply!
```

## Quick Start

### 1. Install Dependencies
```bash
cd whatsapp-bot
pip install -r requirements.txt
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your actual credentials
```

| Variable | Where to Get It |
|---|---|
| `WHATSAPP_TOKEN` | [Meta Business Settings → System Users](https://business.facebook.com/settings/system-users) → Generate Permanent Token |
| `PHONE_NUMBER_ID` | [Meta Developer Console](https://developers.facebook.com) → Your App → WhatsApp → API Setup |
| `VERIFY_TOKEN` | Any string you choose (e.g., `my_voice_bot_secret`) |
| `GROQ_API_KEY` | Already in your root `.env`! Copy it over. |

### 3. Start the Server
```bash
cd whatsapp-bot
python main.py
# Or: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Expose with a Tunnel
```bash
# Using localtunnel (matches your existing setup):
npx localtunnel --port 8000 --subdomain wa-voice-agent
# Or ngrok:
ngrok http 8000
```

### 5. Configure Meta Webhook
1. Go to [Meta Developer Console](https://developers.facebook.com) → Your App → WhatsApp → Configuration
2. Set **Webhook URL**: `https://your-tunnel-url.com/webhook`
3. Set **Verify Token**: same string as your `VERIFY_TOKEN` in `.env`
4. Subscribe to the `messages` field

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/webhook` | Meta webhook verification (hub.challenge) |
| `POST` | `/webhook` | Incoming WhatsApp messages |
| `GET` | `/health` | Health check with config status |

## Features

- **Voice-to-Voice**: Receives voice notes, replies with voice notes
- **Text Fallback**: Also handles text messages through the LLM
- **Conversation Memory**: Remembers last 10 exchanges per user
- **Deduplication**: Ignores duplicate webhook deliveries from Meta
- **Graceful Degradation**: Falls back to text if TTS/upload fails
- **Zero-Cost TTS**: Uses Microsoft Edge TTS (completely free, no API key)
- **Comprehensive Logging**: Every pipeline step is timed and logged

## File Structure

```
whatsapp-bot/
├── main.py          ← Complete FastAPI application (single file)
├── requirements.txt ← Python dependencies
├── .env             ← Your credentials (create from .env.example)
└── .env.example     ← Template with documentation
```
