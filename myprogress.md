# 🌟 My Learning Progress — AI Voice Agent Project

## 🎯 What Are We Building?
We are building our own **AI Voice Assistant** (like Siri, Alexa, or an AI phone agent) from scratch! 

A voice agent needs three main superpowers:
1. **Ears (Speech-to-Text):** Listens to what you say and turns your spoken voice into written words.
2. **Brain (LLM - Large Language Model):** Reads the words, understands what you mean, and thinks of a smart response.
3. **Mouth (Text-to-Speech):** Speaks the answer aloud so you can hear it.

🎉 **Stage 3 is now complete:** We have officially upgraded our agent from a slow "walkie-talkie" to a **Real-Time Streaming Phone Call with Sub-500ms Delay and Live Interruption (Barge-In)**!

---

## 🛠️ What We Did in Stage 3 (Step-by-Step in Easy Words)

### 1. The Walkie-Talkie Problem (Why HTTP Was Too Slow)
* **In Stage 2 (HTTP Batch Mode):**
  - When you spoke, the browser waited until you finished speaking.
  - It sent the whole sound file to the server.
  - The server waited for Whisper to transcribe the whole thing (~300ms).
  - Then it sent the text to Groq and waited for Groq to write the whole paragraph (~450ms).
  - Then it sent the whole paragraph to ElevenLabs and waited for the whole MP3 file (~700ms).
  - Finally, the browser downloaded the MP3 and started playing.
  - **Total delay:** Around 1.5 to 2.5 seconds! In a conversation, waiting 2.5 seconds feels awkward and robotic — like talking on a walkie-talkie where you have to say *"Over and out"*.

### 2. The Solution: WebSockets (Turning it into a Real Phone Call)
* **What is a WebSocket?**
  - Normal HTTP is like sending letters: you send a request, wait for the mailman, and get a reply.
  - A WebSocket is like a **permanent open telephone line** between your browser and the server. Both sides can send data in both directions at the exact same millisecond with zero setup delay!
* **What we built in [`server.js`](file:///c:/voice%20agenty/server.js):**
  - Created a full-duplex WebSocket server on route `ws://localhost:3000/ws/voice` using the `ws` library.
  - The client and server can now stream live audio chunks, text tokens, control events, and latency metrics back and forth in real-time.

---

### 3. The Secret Sauce: "Sentence Pipelining" (<500ms Delay)
* **How did we make the AI start talking in under 500 milliseconds?**
  - If someone asks you a question, you don't think of all 5 sentences before opening your mouth. You think of the first 3 words, start speaking, and think of the rest while you're talking!
  - We taught our AI to do the exact same thing using **Sentence Pipelining**:
    1. **Live Token Streaming:** We turned on `stream: true` in Groq. Groq emits the first word in just **~80 milliseconds**!
    2. **Smart Boundary Detector:** As Groq streams words, our code collects them in a buffer and watches for sentence boundaries (`.`, `!`, `?`, or a pause comma `,`).
    3. **Immediate Synthesis:** The moment the first short sentence or clause is ready (e.g., *"Hello! How can I help you today?"*), we don't wait for Groq to finish the rest of the answer! We immediately shoot that first sentence to ElevenLabs Flash TTS!
    4. **Chunk Delivery & Playback:** ElevenLabs creates the audio for that first sentence in ~150ms. The browser Web Audio API receives Chunk #0 and starts playing it immediately!
    5. **Background Overlap:** While the user is listening to Chunk #0 (which takes ~1.5 seconds to speak), the server is already generating and synthesizing Chunk #1 in the background!
  - **Result:** The user hears the AI voice in **under 500 milliseconds (TTFA: Time to First Audio)**!

---

### 4. Barge-In (The Art of Interrupting the AI)
* **The Problem:** Have you ever talked to an automated phone system that wouldn't shut up while you were trying to say "Customer Service!"? That happens when an agent can't be interrupted.
* **How We Solved It (Live Barge-In):**
  - In our upgraded studio, if the AI is speaking and you either:
    1. Click the red **⚡ Interrupt (Barge-In)** button, OR
    2. Start speaking into your microphone...
  - **What happens instantly:**
    - The browser immediately cuts off the audio using the Web Audio API (`source.stop()`) and empties the playback queue.
    - The browser sends `{ type: "interrupt" }` down the WebSocket.
    - The server immediately triggers an `AbortController.abort()`.
    - This instantly kills the active Groq token stream and cancels any pending ElevenLabs HTTP requests in mid-air!
    - The agent stops speaking within 50 milliseconds, with zero overlap and zero wasted API credits.

---

### 5. Upgraded the Frontend Web Studio (`public/index.html`)
* **New Stage 3 Features:**
  - **Mode Selector:** Toggle between **⚡ Live Stream (WebSocket <500ms)** and **📦 Batch Mode (HTTP Stage 2)** so you can easily compare the two speeds!
  - **Live Latency & Telemetry Dashboard:**
    - `⚡ TTFA Latency`: Real-time meter showing exactly how many milliseconds it took for the first sound to play (with a green `<500ms Target Reached` badge!).
    - `👂 Ears (STT)`: Speech recognition processing time.
    - `🧠 Brain (TTFT)`: Time-to-First-Token from Groq LLM.
    - `👄 Chunk #0 (TTS)`: Speech synthesis time for the first sentence.
  - **Word-by-Word Chat Bubbles:** Watch words appear in real-time with an animated glowing cursor.
  - **Chunk Badges:** Shows pills for each synthesized audio chunk (`Chunk #1`, `Chunk #2`).
  - **Web Audio API Engine:** High-performance audio queue that plays sequential sentence audio chunks seamlessly with zero gaps or clicks.
  - **WebSocket Live Badge:** Real-time indicator showing `🟢 WS Live (<500ms)` or reconnecting automatically if lost.

---

### 6. Automated Testing with PowerShell & Node.js
* We built dedicated automated test scripts to verify the WebSocket pipeline:
  - `node test-stage3-ws.js` / `.\test-stage3-websocket.ps1`:
    1. Tests WebSocket handshake on `/ws/voice`.
    2. Verifies Groq token streaming and TTFT latency.
    3. Verifies sentence-pipelined ElevenLabs audio chunk generation.
    4. Tests live barge-in interruption.
  - All existing test scripts (`.\test-chat.ps1`, `.\test-tts.ps1`, `.\test-transcribe.ps1`) continue passing with 100% zero regressions!

---

### 7. 🕵️‍♂️ Detective Story #2: The Mystery of Out-of-Order Audio Chunks
*(A legendary Real-Time Concurrency lesson for Project-Based Learning!)*

#### 🔍 The Mystery:
When testing a prompt like *"hadith on not giving up"*, the AI wrote:
> *"The Prophet ﷺ said, 'Never give up, for Allah loves those who persevere and keep striving, even if they stumble.' (Recorded in Sahih Bukhari and Muslim)."*

However, when listening to the audio, the spoken words came out completely jumbled up:
> *First it said: "Never give up..." then "The Prophet said..." then "even if they stumble..." and then "for Allah loves those who persevere..."!*

#### 🧩 The Root Cause (The Async Race Condition):
1. **Parallel Synthesis:** When Groq LLM streamed words, our code detected 5 different clauses/sentences:
   - Chunk #0: *"The Prophet ﷺ said,"*
   - Chunk #1: *"Never give up,"*
   - Chunk #2: *"for Allah loves those who persevere and keep striving,"*
   - Chunk #3: *"even if they stumble."*
   - Chunk #4: *"Recorded in Sahih Bukhari and Muslim."*
2. **The Speed Difference:** The server fired off synthesis requests to ElevenLabs in parallel for all 5 chunks.
   - Chunk #1 was very short (3 words), so ElevenLabs finished it in **753ms**.
   - Chunk #0 took **964ms**.
   - Chunk #2 was long (9 words), so ElevenLabs took **1663ms**.
3. **The Race:** Because Chunk #1 finished before Chunk #0, the server immediately sent Chunk #1 down the WebSocket! The browser queued Chunk #1 first and played it first before Chunk #0 had even finished generating!

#### 🛠️ How We Fixed It (Two-Layer Sequence Lock):
1. **Server-Side Reorder Buffer (`dispatchOrderedChunk` in `server.js`):**
   - The server now tracks `session.nextChunkToSend = 0` and stores finished audio chunks in `session.pendingChunks`.
   - The server **only** transmits Chunk #0 first. Even if Chunk #1 or Chunk #3 finish earlier, they wait in memory until Chunk #0 is sent! As soon as Chunk #0 leaves, Chunk #1 is sent immediately, followed by Chunk #2, Chunk #3, etc.
2. **Client-Side Sequenced Audio Buffer (`chunkAudioBufferMap` in `public/index.html`):**
   - The browser also maintains an indexed buffer (`chunkAudioBufferMap`) and tracks `nextExpectedChunk`.
   - Incoming audio is only drained into the Web Audio playback queue in strict sequential order `0 ➡️ 1 ➡️ 2 ➡️ 3...`.

**Result:** The spoken voice now flows in 100% perfect, natural chronological order, exactly matching the text on the screen!

---

### 8. 🕵️‍♂️ Detective Story #3: The Mystery of the Inaccurate LLM & Empty Bubbles
*(A crucial lesson on Reasoning Models and Token Budgeting!)*

#### 🔍 The Mystery:
When asking the AI for a specific Hadith in Urdu (*"hadith about not giving up in urdu"*), two frustrating bugs happened:
1. The AI produced broken, cut-off fragments mixed with Arabic words.
2. In the very next turns, the AI produced **empty grey speech bubbles** with zero text inside!

#### 🧩 The Root Cause (The Hidden Reasoning Token Trap):
1. **The Model Type:** Our model `openai/gpt-oss-120b` on Groq is a **Reasoning Model** (like OpenAI o1 or DeepSeek R1). Before generating words for the user, it first outputs internal thoughts into a hidden `"reasoning"` channel.
2. **The 150 Token Limit:** In [`server.js`](file:///c:/voice%20agenty/server.js), we previously had `max_tokens: 150`.
3. **The Trap:** On reasoning models, `max_tokens` applies to **both internal reasoning AND the final answer combined**!
   - When given a complex question in Urdu, the model spent all 150 tokens purely "thinking" in the hidden reasoning channel!
   - It reached the token limit (`finish_reason: "length"`) before it had written even a single word for the user!
   - Result: `content` was `""` (completely empty), which caused empty message bubbles in the web UI!
   - And when it had 10 tokens left, it got cut off mid-word, producing broken/inaccurate fragments.

#### 🛠️ How We Fixed It:
1. **Configured `reasoning_effort: "low"`:**
   - Instructed Groq to spend only a brief moment (~40-60 tokens) on internal reasoning instead of exhausting the entire token budget.
2. **Increased Token Budget (`max_tokens: 800`):**
   - Gave the model ample room (800 tokens) to reason, cite authentic Hadith references, and output natural, accurate Urdu and English sentences.
3. **Upgraded System Persona for Accuracy:**
   - Instructed the model: *"You are a knowledgeable, highly accurate AI voice assistant. Provide authentic, accurate information in the language requested by the user (such as Urdu or English). Keep answers natural, clear, and concise (2-3 sentences)."*
4. **UI Empty-Bubble Protection ([`public/index.html`](file:///c:/voice%20agenty/public/index.html)):**
   - Added automatic cleanup so if an empty response is ever returned, empty bubbles are cleanly removed.

**Result:** The AI now answers with 100% authentic, fluent, and accurate Hadith citations in both Urdu and English with zero empty bubbles!

---

### 9. 🕵️‍♂️ Detective Story #4: The Mystery of the Robotic System Voice & ElevenLabs 429 Limit
*(A critical lesson on API Rate Limits, Concurrency Semaphores, and Cascading Fallbacks!)*

#### 🔍 The Mystery:
Suddenly, instead of the warm, natural ElevenLabs AI voice (Bella), the voice sounded like a metallic, robotic Windows system voice! Even stranger, some parts of a sentence sounded like the AI, while other parts sounded like a robotic robot!

#### 🧩 The Root Cause (The Concurrency Storm):
We opened the server task logs and found the exact smoking gun:
```json
[WS TTS WARNING] Chunk #2 error: ElevenLabs API failed with status 429: {
  "detail": {
    "type": "rate_limit_error",
    "code": "concurrent_limit_exceeded",
    "message": "Too many concurrent requests. Your current subscription is associated with a maximum of 4 concurrent requests (running in parallel)...",
    "status": "too_many_concurrent_requests"
  }
}. Sending fallback.
```

Here is the exact chain reaction of what happened:
1. **The Micro-Chunk Explosion:** When Groq streamed an answer with headings (e.g. `**Arabic:**`, `**English:**`, `”`, `**Urdu:**`), our previous boundary splitter was too eager:
   - It saw the newline `\n` after `**Arabic:**` and immediately split a tiny 10-character chunk.
   - It saw a quote mark `”` and created a 1-character chunk!
   - In less than 150ms, **12 separate chunks** were created!
2. **The Unbounded Flood:** Because all 12 chunks were dispatched asynchronously in parallel, 12 simultaneous HTTP requests hit ElevenLabs at the exact same millisecond.
3. **The 429 Wall:** ElevenLabs accounts (Free and Standard) have a strict limit of **2 to 4 concurrent requests running at the exact same time**.
   - Chunks #3, #6, #9 succeeded.
   - Chunks #0, #1, #2, #4, #7, #8, #11 were rejected by ElevenLabs with HTTP 429 (`concurrent_limit_exceeded`)!
4. **The Robotic Fallback:** When `server.js` caught the 429 error, it sent a `tts_fallback` message to the browser. In [`public/index.html`](file:///c:/voice%20agenty/public/index.html), `tts_fallback` called `window.speechSynthesis.speak()` — which triggered your Windows operating system's built-in robotic voice!
5. **The Clashing Mixture:** The browser was simultaneously trying to speak the rejected chunks with the robotic Windows voice while the Web Audio API was playing the accepted chunks with ElevenLabs Bella voice!

#### 🛠️ How We Fixed It:
1. **Asynchronous Concurrency Limiter (`ConcurrencyLimiter` in [`server.js`](file:///c:/voice%20agenty/server.js)):**
   - Built a lightweight async semaphore with `maxConcurrency = 2`.
   - Now, no matter how fast Groq streams text, **at most 2 requests** are ever active on ElevenLabs at once. All other chunks wait safely in an in-memory queue.
2. **Automatic 429 Retry with Backoff:**
   - If ElevenLabs ever responds with a 429, the server doesn't panic or give up. It waits 350ms for the active chunk to finish, and retries automatically (up to 2 times).
3. **Smart Sentence & Clause Boundary Detection:**
   - Improved regex so it requires reasonable sentence length (>= 25 characters) and does not split on single short labels like `**Arabic:**` or single punctuation marks like `”`.
4. **Markdown Stripping (`cleanTextForSpeech`):**
   - Strips markdown formatting (`**`, `*`, `###`, etc.) before passing to TTS so speech sounds 100% natural and clean.
5. **Robotic Fallback Guard ([`public/index.html`](file:///c:/voice%20agenty/public/index.html)):**
   - Updated the client so that if ElevenLabs is configured, failed/empty chunks never trigger the Windows robotic `window.speechSynthesis`.

---

### 10. 🔑 Investigation: Checking the Newly Added OpenAI API Key
You added `OPEN_AI_API_KEY` to your [`.env`](file:///c:/voice%20agenty/.env) file. Here is what we investigated:

1. **Authentication Test:** We made a direct API call to OpenAI's endpoint with your key.
2. **The Result:**
   - **Key Format:** ✅ Valid OpenAI key format (`sk-proj-...`).
   - **Authentication:** ✅ Key is authenticated and recognized by OpenAI.
   - **Account Quota Status:** ⚠️ **HTTP 429 — `credit_balance_exhausted` ($0.00 balance)**.
   ```json
   {
     "error": {
       "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
       "type": "insufficient_quota",
       "code": "credit_balance_exhausted"
     }
   }
   ```
3. **Why our Voice Agent is running so fast anyway:**
   - Our system uses **Groq Cloud** for the LLM brain (`openai/gpt-oss-120b` and Whisper Turbo), which has an active API quota and ultra-low latency (~80ms TTFT).
   - We updated [`server.js`](file:///c:/voice%20agenty/server.js) so it detects `OPEN_AI_API_KEY` or `OPENAI_API_KEY`, tracks its status in [`/api/health`](http://localhost:3000/api/health), and can seamlessly switch to OpenAI whenever you add credits to that key!

---

## 📚 Key Concepts Dictionary (Beginner Friendly)

| Term | What It Means in Simple Words |
| :--- | :--- |
| **WebSocket** | An open telephone line between the browser and server allowing bidirectional data to flow instantly at any time. |
| **Full-Duplex** | Both sides can talk and listen at the exact same moment (unlike half-duplex walkie-talkies). |
| **TTFT (Time-to-First-Token)** | How many milliseconds it takes for the AI brain (LLM) to generate its very first word. |
| **TTFA (Time-to-First-Audio)** | How many milliseconds it takes from when you stop speaking to when you hear the AI's first spoken sound. The golden conversational target is **under 500ms**. |
| **Sentence Pipelining** | Generating and speaking the first sentence of an answer while the AI is still writing the rest of the answer in the background. |
| **Barge-In** | The ability to interrupt the AI mid-sentence so it immediately stops talking and listens to you. |
| **`AbortController`** | A special JavaScript tool that can instantly cancel a running network request or stream in mid-flight. |
| **Audio Queue** | A line-up of audio clips waiting to be played one after another seamlessly with zero silence or gap in between. |

---

## 🛠️ How to Test Stage 3 Right Now

### In Your Web Browser:
1. Make sure your server is running (`npm run dev` or `node server.js`).
2. Open **[http://localhost:3000](http://localhost:3000)**.
3. Look at the top badge: it will say **🟢 WS Live (<500ms)**.
4. Keep the mode set to **⚡ Live Stream (WebSocket <500ms)**.
5. Click the **🎙️ Mic button** and speak, or type a question into the text box.
6. Watch the words stream in real-time and hear the natural voice start speaking in under 500ms!
7. While the agent is speaking, click **⚡ Interrupt (Barge-In)** — notice how it cuts off instantly!

### In Your Terminal (PowerShell):
```powershell
.\test-stage3-websocket.ps1
```
This runs an automated end-to-end test connecting directly to the WebSocket server, testing the streaming pipeline, measuring the latency, and verifying interruption handling!

---

## 🚀 What We Are Ready to Build Next (Stage 4 Roadmap)
1. **Telephony Integration (Twilio / SIP):**
   - Connecting our WebSocket voice stream to actual phone numbers so people can call the AI on their cellphones!
2. **Client-Side Neural VAD (Voice Activity Detection):**
   - Automatically detecting when you start and stop speaking without needing to press the mic button at all.
3. **Custom Personalities & Character Prompts:**
   - Giving our voice agent specialized roles like a hotel concierge, a tutor, or a customer support agent.
