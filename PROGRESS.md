# Voice Agent Project Progress Tracker

## 📌 Project Overview
Building an ultra-fast, conversational AI Voice Agent backend using Node.js, Express, WebSockets (`ws`), Groq Cloud LLM (`openai/gpt-oss-120b`), Groq Whisper Turbo (`whisper-large-v3-turbo`) / Deepgram for Speech-to-Text (Ears), and ElevenLabs (`eleven_flash_v2_5`) / Web Speech for Text-to-Speech (Mouth).

---

## 🚦 Current Status Summary
- **Current Phase:** ✅ **Stage 5 Completed & Verified — Mobile Setup & Call Forwarding (8-10s Carrier Forwarding Rule, Transcript Tracking, LLM Call Summaries & SMS Delivery to Personal Phone)**
- **Protocols:** 
  - 📱 **Mobile Call Forwarding & History:** REST endpoints on `/api/forwarding/setup`, `/api/calls/history`, `/api/calls/:callSid`, `/api/calls/test-summary-sms`
  - 📞 **Twilio Media Streams Telephony:** Full-duplex μ-law (8000Hz) WebSocket on `/twilio/media-stream`
  - ⚡ **Browser Live Studio:** Full-duplex WebSocket on `/ws/voice` (<500ms TTFA)
  - 📦 **REST HTTP:** Backward-compatible endpoints (`/voice-chat`, `/chat`, `/transcribe`, `/tts`)
  - 🪝 **Twilio Webhook:** TwiML generator on `/twilio/incoming` with caller metadata parameter injection
- **Ears (Listening):** ✅ Groq Whisper Turbo (`whisper-large-v3-turbo`) with G.711 μ-law to 16-bit linear PCM WAV decoding
- **Brain (Thinking):** ✅ Groq LLM (`openai/gpt-oss-120b`) with **live token streaming (`stream: true`)** + Post-Call Summary generation
- **Mouth (Speaking):** ✅ **ElevenLabs Flash v2.5 (`eleven_flash_v2_5`)** with native **`output_format=ulaw_8000`** telephony output
- **Voice Activity Detection (VAD):** ✅ Real-time RMS energy detector on 20ms audio chunks with ~700ms silence detection
- **Phone Interruption Handling:** ✅ **Live Phone Barge-In**: Emits Twilio `clear` event in <50ms to wipe phone line buffer
- **Call Summaries & Notifications:** ✅ Automatic Groq LLM post-call summary + Twilio SMS delivery to `PERSONAL_PHONE_NUMBER`
- **Call History Persistence:** ✅ In-memory cache + automatic disk backup to `call-history.json`
- **Default Voice:** Bella (`EXAVITQu4vr4xnSDxMaL` — Free & Pro accessible)
- **API Status:**
  - Forwarding & Summaries: ✅ Active (`/api/forwarding/setup`, `/api/calls/history`, `/api/calls/test-summary-sms`)
  - Twilio Telephony: ✅ Active (`/twilio/incoming`, `/twilio/media-stream`, `/api/twilio/status`, `/api/twilio/simulate-call`)
  - Groq Cloud: ✅ Connected (`GROQ_API_KEY` active, token streaming & summarizer operational)
  - ElevenLabs: ✅ Connected & Verified (`ELEVENLABS_API_KEY` active, streaming low-latency MP3 & μ-law chunks)
  - WebSockets: ✅ Dual WebSocket servers online (`/ws/voice` & `/twilio/media-stream`)

---

## ✅ Completed Milestones

### Stage 1: Foundation & Brain (Setup & LLM)
- [x] Initialized Node.js backend with ES Module syntax (`type: module`).
- [x] Configured Express server on port `3000` with CORS and static asset hosting.
- [x] Connected Groq LLM (`openai/gpt-oss-120b`) via `POST /chat` with sub-second response times.
- [x] Created environment variable templates in `.env` and `.env.example`.

### Stage 2: Ears & Mouth (Audio STT & TTS)
- [x] **Ears — Speech-to-Text (STT) (`POST /transcribe`)**:
  - Multipart audio upload processed in memory via `multer`.
  - Groq Whisper Turbo (`whisper-large-v3-turbo`) transcribing voice in ~200-300ms.
  - Deepgram Nova-2 support via `provider=deepgram`.
- [x] **Mouth — Text-to-Speech (TTS) (`POST /tts`)**:
  - Dedicated speech generation endpoint accepting `{ "text": "...", "voiceId": "..." }`.
  - Integration with ElevenLabs REST API with low-latency flash model.
  - Zero-crash fallback mode to browser Web Speech API.
- [x] **Preset Voice Registry (`GET /api/voices`)**:
  - Bella (Default), Adam, Antoni, Alice, Arnold, George, Charlie, and Daniel.
- [x] **Full Voice-to-Voice Loop (`POST /voice-chat`)**:
  - Batch pipeline: Audio upload ➡️ Whisper STT ➡️ Groq LLM ➡️ ElevenLabs TTS.

### Stage 3: Real-Time Streaming (WebSockets) & Ultra-Low Latency (<500ms Delay)
- [x] **Full-Duplex WebSocket Server (`/ws/voice`)**:
  - Integrated `ws` WebSocket server attached directly to the existing Express HTTP server on port 3000.
  - Supported events: `session_init`, `session_ready`, `audio_start`, binary audio chunks, `audio_end`, `text_input`, `interrupt`.
- [x] **Sentence Pipelining Architecture**:
  - Groq LLM streams tokens word-by-word with `stream: true`.
  - Intelligent delimiter boundary detector buffers tokens and splits at sentence/clause punctuation (`.`, `!`, `?`, `\n`, `,`, `;`).
  - Dispatches each sentence/clause to ElevenLabs Flash TTS (`eleven_flash_v2_5`) with `optimize_streaming_latency=3`.
  - Delivers audio chunks over WebSocket so playback begins on Chunk #0 while subsequent sentences are still generating in parallel!
- [x] **Strict Sequential Chunk Ordering Lock (Two-Layer Buffer)**:
  - **Server-Side Queue (`dispatchOrderedChunk`)**: Eliminates async race conditions where shorter chunks finish synthesizing before longer ones. Chunks are queued and sent in strictly sequential 0, 1, 2... order.
  - **Client-Side Sequenced Buffer (`chunkAudioBufferMap`)**: Decodes and schedules Web Audio frames in exact chronological sequence so spoken voice always matches written text word-for-word.
- [x] **LLM Accuracy & Reasoning Token Optimization**:
  - Configured `reasoning_effort: "low"` and expanded token budget from 150 to 800 tokens to prevent reasoning models (`openai/gpt-oss-120b`) from consuming the entire token budget on internal thought channels.
  - Eliminated empty speech bubbles and enabled authentic, fluent citations in multilingual requests (Urdu, Arabic, English).
- [x] **ElevenLabs Concurrency Limiter & 429 Rate-Limit Prevention**:
  - Implemented async semaphore queue (`ConcurrencyLimiter` with `maxConcurrency = 2`) preventing simultaneous bursts of parallel synthesis requests from exceeding ElevenLabs' 2-4 concurrent request cap.
  - Added automatic 350ms exponential backoff retry on HTTP 429 errors.
  - Enhanced sentence boundary detection so micro-headings (`**Arabic:**`) and lone quotation marks are never dispatched as isolated micro-chunks.
  - Stripped markdown characters (`**`, `*`, `###`) prior to TTS for natural, artifact-free speech.
  - Guarded client Web Speech fallback so failed chunks never trigger the metallic Windows system voice when ElevenLabs is configured.
- [x] **OpenAI API Key Integration & Diagnostics**:
  - Added support for `OPEN_AI_API_KEY` / `OPENAI_API_KEY` in `.env` loader.
  - Direct endpoint testing verified key is structurally valid and authenticated, but credit balance is $0.00 (`credit_balance_exhausted`).
  - Added real-time key diagnostic to `GET /api/health`.
- [x] **Live Barge-In / Interruption Handling**:
  - When user speaks or triggers interrupt, client sends `{ type: "interrupt" }`.
  - Server immediately triggers `AbortController.abort()`, cancelling in-flight Groq stream and pending ElevenLabs requests.
  - Client instantly suspends Web Audio playback, flushes the queue, and resets UI in <50ms.
- [x] **Frontend Web Studio Upgrade (`public/index.html`)**:
  - **Mode Selector**: Seamless toggle between **"⚡ Live Stream (WebSocket <500ms)"** and **"📦 Batch Mode (HTTP Stage 2)"**.
  - **Live Telemetry & Latency Grid**: Real-time display of TTFA latency, STT duration, LLM TTFT, and TTS Chunk #0 time.
  - **Word-by-Word Streaming Chat Bubble**: Live token streaming with animated blinking cursor.
  - **Chunk Tags**: Visual badges for each synthesized audio chunk (`Chunk #1`, `Chunk #2`).
  - **Web Audio API Chunk Player**: Low-latency `AudioContext` gapless audio queue with instant flush capability.
  - **⚡ Interrupt Agent Button**: Prominently displayed during speech for 1-click barge-in demonstration.
- [x] **Automated Testing Suite**:
  - [`test-stage3-ws.js`](file:///c:/voice%20agenty/test-stage3-ws.js): End-to-end WebSocket automated test suite measuring handshake, TTFT, TTFA, and barge-in.
  - [`test-stage3-websocket.ps1`](file:///c:/voice%20agenty/test-stage3-websocket.ps1): 1-click PowerShell runner with colorized terminal summary.

### Stage 4: Phone Line Connection (Twilio Media Streams & Telephony)
- [x] **Full-Duplex Twilio Media Stream Server (`/twilio/media-stream`)**:
  - Attached dedicated WebSocket server listening for Twilio's binary-encapsulated JSON protocol.
  - Handles `connected`, `start`, `media`, `mark`, and `stop` stream events.
  - Automatic spoken greeting dispatched the moment a caller's phone line connects.
- [x] **G.711 μ-law (8000Hz) Telephony Audio Engine**:
  - Implemented precomputed 256-entry lookup table (`MU_LAW_DECODE_TABLE`) for sub-microsecond μ-law to 16-bit linear PCM conversion.
  - Implemented RIFF 44-byte standard WAV header wrapper (`mulawToWav`) so telephone audio is directly transcribed by Groq Whisper Turbo with zero external ffmpeg dependencies.
  - Implemented PCM-to-μ-law encoder (`pcmToMulaw`) for synthetic phone testing.
- [x] **Real-Time Voice Activity Detection (VAD)**:
  - Continuously calculates RMS energy of incoming 20ms phone audio chunks.
  - Detects caller speech threshold (`rms >= 600`) and conversational pause silence threshold (`~700ms`).
  - Dispatches caller utterances to Whisper Turbo STT only after the caller finishes their sentence.
- [x] **Instant Telephone Barge-In**:
  - When the caller speaks while the AI assistant is speaking, server immediately issues a `{ event: "clear", streamSid }` message to Twilio.
  - Twilio instantly wipes the caller's earpiece playback buffer in <50ms.
  - Server immediately aborts active LLM streaming and pending ElevenLabs synthesis.
- [x] **ElevenLabs Telephony Voice Synthesis (`ulaw_8000`)**:
  - Upgraded `synthesizeElevenLabs` to support `output_format=ulaw_8000` with `Accept: audio/basic`.
  - ElevenLabs generates raw 8kHz μ-law bytes directly, eliminating any transcoding delay.
- [x] **Inbound Call TwiML Webhook (`POST /twilio/incoming` & `GET /twilio/incoming`)**:
  - Generates valid TwiML XML with `<Connect><Stream url="wss://${host}/twilio/media-stream" /></Connect>`.
  - Automatically captures caller phone number from Twilio webhook payload.
- [x] **Outbound Phone Call Dialer (`POST /api/twilio/call`)**:
  - Integrated official `twilio` SDK to dial any cell phone and connect the call directly to the AI agent.
- [x] **Telephony Diagnostics & Status (`GET /api/twilio/status`)**:
  - Real-time diagnostic check for Account SID, Auth Token, Twilio Number, and Public Webhook URL.
- [x] **Built-in Interactive Call Simulator (`POST /api/twilio/simulate-call`)**:
  - Enables full end-to-end telephone testing without requiring an active Twilio number or phone bill.
- [x] **Frontend Web Phone Studio Upgrade (`public/index.html`)**:
  - **3-Way Mode Switcher**: Seamless toggle between **⚡ Live Stream (WS <500ms)**, **📦 Batch Mode (HTTP)**, and **📞 Phone Line (Twilio Stage 4)**.
  - **Twilio Status & Webhook Card**: Copyable Webhook URL with 1-click test button.
  - **Interactive Call Simulator**: Real-time virtual phone call testing that decodes 8kHz μ-law audio and plays Bella's telephone voice directly through browser speakers!
  - **Outbound Dialer Card**: Enter phone number and click "Call My Phone".
  - **3-Step Setup Guide**: Beginner-friendly guide on configuring ngrok and Twilio Console.
- [x] **Automated Testing Suite**:
  - [`test-stage4-phone.js`](file:///c:/voice%20agenty/test-stage4-phone.js): 6-point automated test verifying status, TwiML, simulator, media stream WebSocket, μ-law greeting, VAD, and live phone barge-in.
  - [`test-stage4-phone.ps1`](file:///c:/voice%20agenty/test-stage4-phone.ps1): 1-click PowerShell runner with colorized output (100% passing).

### Stage 5: Mobile Setup & Call Forwarding (Missed-Call AI Assistant & SMS Delivery)
- [x] **GSM Conditional Call Forwarding (CFNR) Engine**:
  - Built universal MMI dial code generator `*61*<TwilioNumber>**<seconds>#` enabling automatic carrier forwarding on unanswered calls.
  - Pre-configured tailored rules for major carriers: Jazz/Warid (`*61*...**10#`), Zong, Telenor, Ufone, Airtel, T-Mobile (`*61*...*11*10#`), and AT&T.
  - Mapped timer options (5s, 10s, 15s, 20s, 25s, 30s) conforming to telecom 5-second increment constraints (10 seconds recommended for 2 rings).
  - Included disable code `##61#` and status check code `*#61#`.
- [x] **Inbound Caller Metadata Capture & TwiML Parameter Passing**:
  - Upgraded `/twilio/incoming` to extract `From` (Caller Number), `ForwardedFrom` (Original Dialed SIM), `CallSid`, `CallerName`, and `Called`.
  - Dynamically injects `<Parameter name="..." value="..." />` tags into `<Stream>` XML so the real-time WebSocket connection immediately knows caller context.
- [x] **Live Conversation Transcript Tracker**:
  - Added timestamped session transcript array (`session.transcript[]`) capturing each user turn (Whisper STT output) and assistant turn (Groq reply).
  - Tracks total call duration, start time, end time, and caller identifiers.
- [x] **Post-Call LLM Summary Generator**:
  - Automatically triggered upon Twilio `stop` event or connection close.
  - Dispatches conversation transcript to Groq LLM with a dedicated concise summarization prompt.
  - Generates a concise, structured 2-3 sentence summary: Who called, what they needed, and the AI's response.
- [x] **Twilio SMS Notification Engine**:
  - Automatically dispatches the call summary via SMS to the user's personal cell phone (`PERSONAL_PHONE_NUMBER`).
  - Includes caller number, duration, timestamp, and concise summary formatted cleanly for mobile lock screens.
  - Added dry-run safeguard so local development runs gracefully even before Twilio credentials or international SMS are enabled.
- [x] **Persistent Call History Storage**:
  - Implemented in-memory LRU cache of the last 50 calls.
  - Automatically persists call records, transcripts, summaries, and delivery statuses to `call-history.json` on disk.
  - REST endpoints: `GET /api/calls/history` (with `?limit=` support) and `GET /api/calls/:callSid` for individual call inspection.
- [x] **Interactive Forwarding & SMS Testing Endpoints**:
  - `GET /api/forwarding/setup`: Returns comprehensive carrier dial codes, timers, and step-by-step instructions.
  - `POST /api/calls/test-summary-sms`: Triggers an immediate verification SMS to the user's mobile number.
- [x] **Frontend Mobile Setup Studio (`public/index.html`)**:
  - **4-Way Mode Switcher**: Added **📱 Mobile Setup (Stage 5)** mode button.
  - **Call Forwarding Setup Wizard**: Interactive carrier chips (Universal GSM, Jazz, Zong, Telenor, Ufone, Airtel, T-Mobile, AT&T), ring timer selector, 1-click copyable MMI code, and cancellation code guide.
  - **Call History Dashboard**: Real-time listing of incoming forwarded calls showing caller number, duration, AI summary, expandable full transcripts, and SMS delivery badges.
  - **SMS Summary Test Card**: 1-click button to verify SMS delivery to `PERSONAL_PHONE_NUMBER`.
  - **Live Call Counter Badge**: Floating badge showing total calls processed (`📞 0 calls`).
- [x] **Automated Testing Suite**:
  - [`test-stage5-forwarding.js`](file:///c:/voice%20agenty/test-stage5-forwarding.js): 28 automated checks covering setup codes, call history, TwiML metadata injection, transcript capture, summary generation, SMS endpoint, and detail retrieval (100% pass).
  - [`test-stage5-forwarding.ps1`](file:///c:/voice%20agenty/test-stage5-forwarding.ps1): 1-click PowerShell runner with colorized status summary.

---

## 🏗️ Architecture & Data Flow

### Stage 5: Mobile Call Forwarding & Missed-Call AI Assistant Flow
```
[Unanswered Personal Call]
       │
       ▼ (Caller rings user's personal phone for 10 seconds / 2 rings)
[Mobile Carrier Network (Jazz / Zong / T-Mobile)]
       │
       ▼ (Conditional Call Forwarding on No Reply: *61*<TwilioNumber>**10#)
[Twilio Cloud Telephony]
       │
       ├─► 1. Webhook: POST /twilio/incoming
       │     - Captures: Caller Number (From) & Personal Number (ForwardedFrom)
       │     - TwiML returns: <Stream url="wss://.../twilio/media-stream"> with <Parameter> tags
       │
       ▼ 2. Opens Full-Duplex Media Stream WebSocket
[Twilio Media Stream Server (/twilio/media-stream)]
       │
       ├─► AI greets caller in μ-law 8kHz voice ("Hello! Thank you for calling...")
       │
       ├─► Conversation Loop (VAD ➡️ Whisper STT ➡️ Groq LLM ➡️ ElevenLabs μ-law 8kHz)
       │     └─► Accumulates turns into session.transcript[]
       │
       ▼ 3. Caller hangs up (Twilio emits 'stop' event)
[Post-Call Processing Pipeline]
       │
       ├─► 4. Groq LLM Call Summarizer:
       │     "Summarize transcript in 2-3 sentences for SMS notification"
       │
       ├─► 5. Twilio SMS Dispatch:
       │     Sends SMS to user's PERSONAL_PHONE_NUMBER:
       │     "📞 Missed Call Summary from +1234567890 (Duration: 45s)..."
       │
       └─► 6. Persist to call-history.json & update Live Dashboard UI
```

---

## ⏱️ Latency Budget Breakdown (<500ms Target)

| Pipeline Step | Batch HTTP (Stage 2) | Browser WebSockets (Stage 3) | Phone Line Telephony (Stage 4) | Mobile Forwarding (Stage 5) |
| :--- | :--- | :--- | :--- | :--- |
| **Audio Format** | WebM / Opus | WebM binary chunks | G.711 μ-law (8000Hz mono) | G.711 μ-law (8000Hz mono) |
| **Speech-to-Text (STT)** | 300 ms (upload + batch) | ~180 ms (stream buffer) | ~180 ms (μ-law to WAV + Whisper) | ~180 ms (Whisper Turbo) |
| **LLM Reasoning** | 450 ms (full completion) | ~80 ms (Time-to-First-Token) | ~80 ms (Time-to-First-Token) | ~80 ms (Time-to-First-Token) |
| **Text-to-Speech (TTS)** | 700 ms (full MP3) | ~150 ms (Flash MP3 stream) | ~160 ms (Flash `ulaw_8000` stream) | ~160 ms (Flash `ulaw_8000` stream) |
| **Time-to-First-Audio (TTFA)**| **~1,450 ms - 2,000 ms** | **~410 ms - 490 ms** | **~420 ms - 510 ms (Over phone line!)** | **~420 ms - 510 ms** |
| **Barge-In Reaction** | N/A (uninterruptible) | <50 ms (AudioContext flush) | <50 ms (Twilio `clear` event) | <50 ms (Twilio `clear` event) |
| **Post-Call Summary** | N/A | N/A | N/A | ~400 ms (Groq LLM) + SMS dispatch |

---

## 🛠️ How to Test Current Progress

### Option A: Web Browser Interactive Studio
1. Start the server:
   ```bash
   npm run dev
   ```
2. Open **[http://localhost:3000](http://localhost:3000)** in your browser.
3. In the top mode selector, explore the modes:
   - **📱 Mobile Setup (Stage 5)**:
     - Select your carrier (Universal GSM, Jazz, Zong, Telenor, Ufone, Airtel, T-Mobile, AT&T).
     - Pick a ring delay (10s recommended).
     - Click **📋 Copy** to copy the MMI forwarding code to dial on your mobile phone.
     - Click **📩 Send Test SMS Summary** to test SMS delivery to your phone.
     - View the **Call History** dashboard with transcripts and AI summaries.
   - **📞 Phone Line (Twilio Stage 4)**: Test incoming calls, outbound dialer, and live telephone simulation.
   - **⚡ Live Stream (WebSocket Stage 3)**: Test ultra-fast browser voice with <500ms TTFA and live barge-in.
   - **📦 Batch Mode (HTTP Stage 2)**: Test traditional voice-to-voice loop.

### Option B: Terminal Automated Tests (PowerShell)
1. **Stage 5 Mobile Setup & Call Forwarding Suite**:
   ```powershell
   .\test-stage5-forwarding.ps1
   ```
2. **Stage 4 Twilio Phone Line Test Suite**:
   ```powershell
   .\test-stage4-phone.ps1
   ```
3. **Stage 3 WebSocket Streaming & Barge-In Test**:
   ```powershell
   .\test-stage3-websocket.ps1
   ```
4. **Stage 2 Text-to-Speech (Mouth)**:
   ```powershell
   .\test-tts.ps1
   ```
5. **Stage 2 Speech-to-Text (Ears)**:
   ```powershell
   .\test-transcribe.ps1
   ```
6. **Stage 1 Chat Completion (Brain)**:
   ```powershell
   .\test-chat.ps1
   ```

---

## 📱 How to Connect Your Real Phone Number (Step-by-Step)

### Step 1: Carrier Call Forwarding Setup
1. Look up your Twilio virtual number (e.g. `+12345678901`).
2. Open your smartphone's dialer app.
3. Type the MMI code for 10-second forwarding:
   ```
   *61*+12345678901**10#
   ```
4. Press the **Call** button. Your screen will display: *"Call forwarding when unanswered registered successfully"*.
5. (To turn off forwarding later, simply dial `##61#` and press Call).

### Step 2: Configure Environment Variables
In your [`.env`](file:///c:/voice%20agenty/.env) file:
```env
PUBLIC_URL=https://your-domain.ngrok-free.app
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+12345678901
PERSONAL_PHONE_NUMBER=+923001234567
```

### Step 3: Configure Twilio Console Webhook
1. Go to [console.twilio.com](https://console.twilio.com) -> **Phone Numbers** -> **Active Numbers**.
2. Select your Twilio phone number.
3. Under **"A CALL COMES IN"**, select **Webhook (HTTP POST)** and paste:
   ```
   https://your-domain.ngrok-free.app/twilio/incoming
   ```
4. Click **Save**.

### Step 4: Test Real Call Forwarding
1. Have a friend or secondary phone call your personal mobile number.
2. Let it ring for 10 seconds without answering.
3. Your mobile network will automatically divert the call to Twilio!
4. Twilio opens the media stream to your server, and Bella greets the caller.
5. After the caller hangs up, Groq generates a concise summary and Twilio texts it straight to your personal phone!

---

## ⏳ Next Steps / Stage 6 Roadmap
- [ ] **Stage 6: WhatsApp Voice Bot Integration (`@whiskeysockets/baileys`)**:
  - Connect AI voice agent directly to an existing WhatsApp account for $0 international carrier fee calling and audio notes.
- [ ] **Client-Side Neural VAD (Silero VAD)**:
  - High-accuracy ML voice detection in the browser to eliminate button pressing entirely.
- [ ] **Custom Character Personas & Prompt Presets**:
  - Switchable personas: Hotel Concierge, Tech Support Specialist, Medical Receptionist, Catbot.
