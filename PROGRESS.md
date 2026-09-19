# Voice Agent Project Progress Tracker

## 📌 Project Overview
Building an ultra-fast, interactive AI Voice Agent backend using Node.js, Express, Groq Cloud LLM (`openai/gpt-oss-120b`), Groq Whisper Turbo (`whisper-large-v3-turbo`) / Deepgram for Speech-to-Text (Ears), and ElevenLabs / Web Speech for Text-to-Speech (Mouth).

---

## 🚦 Current Status Summary
- **Current Phase:** ✅ **Stage 2 Completed & Verified — Ears & Mouth (Audio STT & TTS)**
- **Ears (Listening):** ✅ Groq Whisper Turbo (`whisper-large-v3-turbo`) + Deepgram support
- **Brain (Thinking):** ✅ Groq LLM (`openai/gpt-oss-120b`)
- **Mouth (Speaking):** ✅ **ElevenLabs Cloud TTS Active** (`eleven_flash_v2_5` / `eleven_multilingual_v2`)
- **Default Voice:** Bella (`EXAVITQu4vr4xnSDxMaL` — Free & Pro accessible)
- **Active Persona:** Friendly, concise AI Voice Assistant
- **API Status:**
  - Groq Cloud: ✅ Connected (`GROQ_API_KEY` active)
  - ElevenLabs: ✅ Connected & Verified (`ELEVENLABS_API_KEY` active, streaming real MP3 audio)

---

## ✅ Completed Milestones

### Stage 1: Foundation & Brain (Setup & LLM)
- [x] Initialized Node.js backend with ES Module syntax (`type: module`).
- [x] Configured Express server on port `3000` with CORS and static asset hosting.
- [x] Connected Groq LLM (`openai/gpt-oss-120b`) via `POST /chat` with sub-second response times.
- [x] Created environment variable templates in `.env` and `.env.example`.

### Stage 2: Ears & Mouth (Audio STT & TTS)
- [x] **Ears — Speech-to-Text (STT) (`POST /transcribe`)**:
  - Multipart audio upload (`audio` field) processed in memory via `multer`.
  - Primary engine: **Groq Whisper Turbo** (`whisper-large-v3-turbo`) transcribing voice in ~200-300ms.
  - Secondary engine: **Deepgram Nova-2** support via `provider=deepgram` when `DEEPGRAM_API_KEY` is provided.
- [x] **Mouth — Text-to-Speech (TTS) (`POST /tts`)**:
  - Dedicated speech generation endpoint accepting `{ "text": "...", "voiceId": "..." }`.
  - Integration with **ElevenLabs REST API** (`eleven_turbo_v2_5` low-latency model).
  - Streams binary `audio/mpeg` audio directly to browser or API clients.
  - Zero-crash fallback mode: if `ELEVENLABS_API_KEY` is not configured, returns a fallback payload allowing seamless browser speech synthesis.
- [x] **Preset Voice Registry (`GET /api/voices`)**:
  - Exposes preset voice personalities: Rachel (Default/Calm), Adam (Deep/Professional), Nicole (Warm), Josh (Friendly).
- [x] **Full Voice-to-Voice Loop (`POST /voice-chat`)**:
  - Accepts speech audio ➡️ Whisper transcribes ➡️ Groq LLM reasons ➡️ ElevenLabs speaks response back.
- [x] **Health & Diagnostics (`GET /api/health`)**:
  - Detailed service health reporting for Brain (LLM), Ears (STT), and Mouth (TTS).
- [x] **Enhanced Frontend Interface (`public/index.html`)**:
  - Real-time service status badges for LLM, Whisper STT, and ElevenLabs/Browser TTS.
  - Pipeline diagnostics grid showing current STT, LLM, and TTS providers.
  - Interactive **🎙️ Microphone Button** with animated recording waveforms and timer.
  - Dynamic **Agent Speaking visualizer banner** with purple sound waves.
  - Voice selector dropdown (Rachel, Adam, Nicole, Josh).
  - Voice Replay button on bot chat messages.
- [x] **Automated Testing Suite**:
  - [`test-chat.ps1`](file:///c:/voice%20agenty/test-chat.ps1): Verifies LLM chat completion.
  - [`test-transcribe.ps1`](file:///c:/voice%20agenty/test-transcribe.ps1): Synthesizes audio and verifies Whisper STT & voice loop.
  - [`test-tts.ps1`](file:///c:/voice%20agenty/test-tts.ps1): Verifies speech generation and fallback behavior.

### Stage 2.1: ElevenLabs Verification & System Voice Fallback Resolution
- [x] **Root-Cause Analysis of System Voice Fallback**:
  - Identified that the app was playing Windows' built-in system voice because ElevenLabs was returning errors on synthesis requests.
  - Resolved two distinct blockers:
    1. **Key Format**: Differentiated between ElevenLabs internal **Key ID** (hex string) and actual **Secret API Key** (`sk_...`).
    2. **Free Tier Voice Policy**: Discovered that ElevenLabs blocks library voices like Rachel (`21m00Tcm4TlvDq8ikWAM`) on free accounts via API with HTTP 402 ("Free users cannot use library voices via the API").
- [x] **Compatibility Voice Audit**:
  - Ran comprehensive automated API checks against ElevenLabs voice catalog.
  - Identified and verified 8 fully-accessible voices for both Free and Pro accounts: **Bella**, **Adam**, **Antoni**, **Alice**, **Arnold**, **George**, **Charlie**, and **Daniel**.
  - Updated the backend default voice from Rachel to **Bella** (`EXAVITQu4vr4xnSDxMaL`).
- [x] **Hot Dynamic `.env` Reloading**:
  - Integrated `dotenv.config({ override: true })` inside request lifecycle in [`server.js`](file:///c:/voice%20agenty/server.js).
  - API keys and environment changes take effect instantly without restarting the server.
- [x] **Transparent UI Diagnostics & Testing (`public/index.html`)**:
  - Added dedicated **`▶ Test Voice`** button for 1-click preview of realistic AI speech.
  - Replaced silent fallback with explicit chat alerts explaining API errors if they occur.
  - Verified live MP3 generation: HTTP 200 with ~38 KB binary audio.

---

## 🏗️ Architecture & Data Flow

```
[ User Speaks into Mic ]
          │
          ▼  (Audio stream / FormData)
[ POST /transcribe  or  POST /voice-chat ]
          │
          ▼  EARS (Speech-to-Text)
┌──────────────────────────────────────────────┐
│  Groq Whisper Turbo (whisper-large-v3-turbo)  │
│  Deepgram Nova-2 (Alternative)              │
└──────────────────────────────────────────────┘
          │
          ▼  (Transcribed Text: "What's the weather?")
┌──────────────────────────────────────────────┐
│  BRAIN (LLM Reasoning)                       │
│  Groq Cloud: openai/gpt-oss-120b             │
└──────────────────────────────────────────────┘
          │
          ▼  (AI Reply: "It's sunny and 72 degrees.")
┌──────────────────────────────────────────────┐
│  MOUTH (Text-to-Speech)                      │
│  ElevenLabs REST API (eleven_turbo_v2_5)     │
│  Browser Web Speech API (Local Fallback)     │
└──────────────────────────────────────────────┘
          │
          ▼  (Audio Output / Voice playback)
[ User Hears Voice Response ]
```

---

## 🛠️ How to Test Current Progress

### Option A: Web Browser Interactive Test
1. Start the server:
   ```bash
   npm run dev
   ```
2. Open **[http://localhost:3000](http://localhost:3000)** in your browser.
3. Look at the top status badges:
   - `Groq LLM Active` (Green)
   - `Whisper STT` (Blue)
   - `Mouth: ElevenLabs TTS` or `Browser TTS`
4. Click the **🎙️ Mic button** and ask a question.
5. Watch the animated listening wave, see the transcription appear, and listen to the voice response!

### Option B: Terminal Automated Tests (PowerShell)
1. **Test Text-to-Speech (Mouth)**:
   ```powershell
   .\test-tts.ps1
   ```
2. **Test Speech-to-Text & Voice Pipeline (Ears & Brain)**:
   ```powershell
   .\test-transcribe.ps1
   ```
3. **Test Text Chat (Brain)**:
   ```powershell
   .\test-chat.ps1
   ```

---

## ⏳ Next Steps / Stage 3 Roadmap
- [ ] **Custom Personality (Catbot / Persona)**:
  - System prompt tuning in [`server.js`](file:///c:/voice%20agenty/server.js) for specific character roles.
- [ ] **Real-time WebSockets & Streaming**:
  - Full-duplex WebSocket streaming for immediate interruption handling (barge-in).
- [ ] **Telephony Integration**:
  - Twilio / SIP inbound and outbound phone calls.
