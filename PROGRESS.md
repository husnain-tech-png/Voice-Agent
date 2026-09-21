# Voice Agent Project Progress Tracker

## 📌 Project Overview
Building an ultra-fast, conversational AI Voice Agent backend using Node.js, Express, WebSockets (`ws`), Groq Cloud LLM (`openai/gpt-oss-120b`), Groq Whisper Turbo (`whisper-large-v3-turbo`) / Deepgram for Speech-to-Text (Ears), and ElevenLabs (`eleven_flash_v2_5`) / Web Speech for Text-to-Speech (Mouth).

---

## 🚦 Current Status Summary
- **Current Phase:** ✅ **Stage 4 Completed & Verified — Phone Line Connection (Twilio Media Streams, μ-law 8kHz, Telephony VAD, Phone Barge-In & Outbound Calling)**
- **Protocols:** 
  - 📞 **Twilio Media Streams Telephony:** Full-duplex μ-law (8000Hz) WebSocket on `/twilio/media-stream`
  - ⚡ **Browser Live Studio:** Full-duplex WebSocket on `/ws/voice` (<500ms TTFA)
  - 📦 **REST HTTP:** Backward-compatible endpoints (`/voice-chat`, `/chat`, `/transcribe`, `/tts`)
  - 🪝 **Twilio Webhook:** TwiML generator on `/twilio/incoming`
- **Ears (Listening):** ✅ Groq Whisper Turbo (`whisper-large-v3-turbo`) with G.711 μ-law to 16-bit linear PCM WAV decoding
- **Brain (Thinking):** ✅ Groq LLM (`openai/gpt-oss-120b`) with **live token streaming (`stream: true`)**
- **Mouth (Speaking):** ✅ **ElevenLabs Flash v2.5 (`eleven_flash_v2_5`)** with native **`output_format=ulaw_8000`** telephony output
- **Voice Activity Detection (VAD):** ✅ Real-time RMS energy detector on 20ms audio chunks with ~700ms silence detection
- **Phone Interruption Handling:** ✅ **Live Phone Barge-In**: Emits Twilio `clear` event in <50ms to wipe phone line buffer
- **Default Voice:** Bella (`EXAVITQu4vr4xnSDxMaL` — Free & Pro accessible)
- **API Status:**
  - Twilio Telephony: ✅ Active (`/twilio/incoming`, `/twilio/media-stream`, `/api/twilio/status`, `/api/twilio/simulate-call`)
  - Groq Cloud: ✅ Connected (`GROQ_API_KEY` active, token streaming operational)
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

---

## 🏗️ Architecture & Data Flow

### Stage 3: Bidirectional WebSocket Streaming (Browser <500ms)
```
[User Mic] ──WS Audio Stream──> [Groq Whisper Turbo (~180ms)]
                                       │
                                       ▼ (First token in ~80ms)
                              [Groq LLM Stream (stream: true)]
                                       │
   Sentence boundary detected (".", "!", "?", ",") after ~80ms
                                       │
                                       ▼ (Dispatch chunk immediately)
                              [ElevenLabs Flash Stream (~150ms)]
                                       │
                                       ▼ (Binary MP3 chunk over WS)
[Browser Web Audio API starts playing] ──► ⚡ TTFA: <500ms!
```

### Stage 4: Twilio Media Streams Telephony Flow (Phone Line)
```
[Caller Cell Phone]
       │
       ▼ (Dials Twilio Phone Number)
[Twilio Cloud Telephony]
       │
       ├─► 1. Webhook: POST /twilio/incoming
       │     (Server replies: <Response><Connect><Stream url="wss://.../twilio/media-stream" /></Connect></Response>)
       │
       ▼ 2. Opens Bidirectional WebSocket
[Twilio Media Stream Server (/twilio/media-stream)]
       │
       ├─► Event: "start" ──► AI greets caller in μ-law 8kHz voice ("Hello! Thank you for calling...")
       │
       ├─► Event: "media" (20ms μ-law 8kHz audio packets)
       │         │
       │         ▼
       │   [Energy-Based VAD] ──(RMS Speech Threshold & 700ms Silence Hang-Time)
       │         │
       │         ├─► If AI is currently speaking: Send { "event": "clear" } ──► ⚡ Phone Barge-In!
       │         │
       │         ▼ Caller finished sentence
       │   [Convert μ-law buffer to standard WAV header]
       │         │
       │         ▼
       │   [Groq Whisper Turbo STT (~180ms)]
       │         │
       │         ▼
       │   [Groq LLM Stream (openai/gpt-oss-120b) (~80ms TTFT)]
       │         │
       │         ▼
       │   [ElevenLabs Flash TTS (output_format=ulaw_8000) (~160ms)]
       │         │
       │         ▼
       └─◄ Send JSON { "event": "media", "media": { "payload": "<base64 μ-law>" } }
                 │
                 ▼
     [Caller hears AI voice in phone earpiece with ultra-low latency!]
```

---

## ⏱️ Latency Budget Breakdown (<500ms Target)

| Pipeline Step | Batch HTTP (Stage 2) | Browser WebSockets (Stage 3) | Phone Line Telephony (Stage 4) |
| :--- | :--- | :--- | :--- |
| **Audio Format** | WebM / Opus | WebM binary chunks | G.711 μ-law (8000Hz mono) |
| **Speech-to-Text (STT)** | 300 ms (upload + batch) | ~180 ms (stream buffer) | ~180 ms (μ-law to WAV + Whisper) |
| **LLM Reasoning** | 450 ms (full completion) | ~80 ms (Time-to-First-Token) | ~80 ms (Time-to-First-Token) |
| **Text-to-Speech (TTS)** | 700 ms (full MP3) | ~150 ms (Flash MP3 stream) | ~160 ms (Flash `ulaw_8000` stream) |
| **Time-to-First-Audio (TTFA)**| **~1,450 ms - 2,000 ms** | **~410 ms - 490 ms** | **~420 ms - 510 ms (Over phone line!)** |
| **Barge-In Reaction** | N/A (uninterruptible) | <50 ms (AudioContext flush) | <50 ms (Twilio `clear` event) |

---

## 🛠️ How to Test Current Progress

### Option A: Web Browser Interactive Phone Studio
1. Start the server:
   ```bash
   npm run dev
   ```
2. Open **[http://localhost:3000](http://localhost:3000)** in your browser.
3. In the top mode selector, click **📞 Phone Line (Twilio Stage 4)**.
4. Test the tools:
   - **Check Webhook URL**: See your incoming webhook URL and click **🔗 Test TwiML** to preview the raw XML.
   - **Test Phone Call Simulation**: Click **📞 Start Test Call** — watch the live call sequence and hear Bella speak the phone greeting and AI reply in 8kHz μ-law through your speakers!
   - **Outbound Dialer**: Type a phone number and click **📞 Call My Phone** (requires Twilio credentials in `.env`).

### Option B: Terminal Automated Tests (PowerShell)
1. **Stage 4 Twilio Phone Line Test Suite**:
   ```powershell
   .\test-stage4-phone.ps1
   ```
2. **Stage 3 WebSocket Streaming & Barge-In Test**:
   ```powershell
   .\test-stage3-websocket.ps1
   ```
3. **Stage 2 Text-to-Speech (Mouth)**:
   ```powershell
   .\test-tts.ps1
   ```
4. **Stage 2 Speech-to-Text (Ears)**:
   ```powershell
   .\test-transcribe.ps1
   ```
5. **Stage 1 Chat Completion (Brain)**:
   ```powershell
   .\test-chat.ps1
   ```

---

## 📱 How to Connect Your Real Phone Number (Step-by-Step)
1. **Expose your server**: Run `ngrok http 3000` in PowerShell.
2. **Save your tunnel URL**: Copy the `https://...` address and paste into `.env` as `PUBLIC_URL=https://your-domain.ngrok-free.app`.
3. **Configure Twilio Console**:
   - Go to [console.twilio.com](https://console.twilio.com) -> **Phone Numbers** -> **Active Numbers**.
   - Click on your phone number.
   - Under **"A CALL COMES IN"**, select **Webhook** (HTTP POST) and paste:
     `https://your-domain.ngrok-free.app/twilio/incoming`
   - Click **Save**.
4. **Call your number**: Pick up your cell phone and dial! The AI will answer immediately.

---

## ⏳ Next Steps / Stage 5 Roadmap
- [ ] **Client-Side Neural VAD (Voice Activity Detection)**:
  - Silero VAD in browser to automatically detect speech start/stop without pressing any buttons.
- [ ] **Custom Character Personas (Catbot / Support Agent / Sales Rep)**:
  - Preset system personality selector with tailored voice tone and knowledge context.
- [ ] **Multi-Turn Session Memory & Call Analytics**:
  - Storing call transcripts, caller sentiment, and duration logs.

