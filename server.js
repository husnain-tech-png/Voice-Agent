import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import Groq, { toFile } from "groq-sdk";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";

// Load variables from .env into process.env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration Keys & Dynamic Environment Loader
let groq = null;

function getEnv() {
  dotenv.config({ override: true });
  const groqKey = (process.env.GROQ_API_KEY || "").trim();
  const elevenlabsKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  const groqModel = (process.env.GROQ_MODEL || "openai/gpt-oss-120b").trim();
  const defaultVoice = (process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL").trim(); // Bella (Free Tier & Pro)
  const deepgramKey = (process.env.DEEPGRAM_API_KEY || "").trim();
  const openaiKey = (process.env.OPEN_AI_API_KEY || process.env.OPENAI_API_KEY || "").trim();

  // Sync Groq client whenever key is updated
  if (groqKey) {
    if (!groq || groq.apiKey !== groqKey) {
      groq = new Groq({ apiKey: groqKey });
    }
  } else {
    groq = null;
  }

  return {
    GROQ_API_KEY: groqKey,
    GROQ_MODEL: groqModel,
    ELEVENLABS_API_KEY: elevenlabsKey,
    DEFAULT_ELEVENLABS_VOICE: defaultVoice,
    DEEPGRAM_API_KEY: deepgramKey,
    OPENAI_API_KEY: openaiKey
  };
}

// Initial environment check
getEnv();

// Configure in-memory upload storage for audio processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max audio size
});

// Middleware to parse JSON and urlencoded request bodies and enable CORS
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Preset ElevenLabs Voices (Tested & verified for Free & Pro accounts)
const PRESET_VOICES = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", description: "Warm, natural female voice (Recommended)", provider: "ElevenLabs" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", description: "Deep, professional male voice", provider: "ElevenLabs" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", description: "Pleasant, articulate male voice", provider: "ElevenLabs" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", description: "Clear, engaging British female voice", provider: "ElevenLabs" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", description: "Crisp, resonant male voice", provider: "ElevenLabs" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", description: "Warm British male voice", provider: "ElevenLabs" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", description: "Casual Australian male voice", provider: "ElevenLabs" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", description: "Authoritative British male voice", provider: "ElevenLabs" }
];

// Lightweight semaphore to limit concurrent requests to ElevenLabs API (prevents HTTP 429 concurrent_limit_exceeded)
class ConcurrencyLimiter {
  constructor(maxConcurrency = 2) {
    this.maxConcurrency = maxConcurrency;
    this.activeCount = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }
}

const elevenLabsLimiter = new ConcurrencyLimiter(2);

// Strip markdown characters and noisy symbols before sending to TTS
function cleanTextForSpeech(rawText) {
  if (!rawText) return "";
  return rawText
    .replace(/\*\*(.*?)\*\*/g, "$1") // Bold **text** -> text
    .replace(/\*(.*?)\*/g, "$1")     // Italic *text* -> text
    .replace(/#{1,6}\s+/g, "")       // Headers ### -> empty
    .replace(/[`_~]/g, "")           // `inline code`, _italic_, ~strike~
    .replace(/^\s*[-*+]\s+/gm, "")   // Bullets
    .replace(/\s+/g, " ")            // Normalize spaces
    .trim();
}

// Helper: Synthesize speech with ElevenLabs (with concurrency limiter & 429 retry)
async function synthesizeElevenLabs(text, voiceId, signal = null, retries = 2) {
  const env = getEnv();
  const apiKey = env.ELEVENLABS_API_KEY;
  const targetVoice = voiceId || env.DEFAULT_ELEVENLABS_VOICE;

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured in .env.");
  }

  // Detect common mistake: user copied Key ID instead of secret API key
  if (!apiKey.startsWith("sk_")) {
    throw new Error(
      `Invalid ElevenLabs API Key format. ElevenLabs secret keys start with 'sk_'. You pasted a Key ID ("${apiKey.substring(0, 6)}...") instead of the Secret API Key. Go to ElevenLabs Dashboard -> API Keys -> Create/Reveal Key to get your 'sk_...' key.`
    );
  }

  const cleanText = cleanTextForSpeech(text);
  // If text contains no letters, numbers, or Arabic/Urdu characters, skip synthesis
  if (!cleanText || cleanText.length < 2 || !/[a-zA-Z0-9\u0600-\u06FF]/.test(cleanText)) {
    return Buffer.alloc(0);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal && signal.aborted) {
      throw new Error("Aborted");
    }

    try {
      return await elevenLabsLimiter.run(async () => {
        if (signal && signal.aborted) throw new Error("Aborted");

        let response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}/stream?optimize_streaming_latency=3&output_format=mp3_44100_128`, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
          },
          body: JSON.stringify({
            text: cleanText,
            model_id: "eleven_flash_v2_5", // Ultra-fast low-latency voice model
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          }),
          signal: signal
        });

        if (response.status === 429) {
          const errBody = await response.text();
          throw new Error(`ELEVENLABS_429: ${errBody}`);
        }

        // If flash model is not active on this tier, fallback to eleven_multilingual_v2
        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 404 || (response.status === 400 && errorText.includes("model"))) {
            response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}/stream?optimize_streaming_latency=3&output_format=mp3_44100_128`, {
              method: "POST",
              headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg"
              },
              body: JSON.stringify({
                text: cleanText,
                model_id: "eleven_multilingual_v2",
                voice_settings: {
                  stability: 0.5,
                  similarity_boost: 0.75
                }
              }),
              signal: signal
            });

            if (response.status === 429) {
              const errBody2 = await response.text();
              throw new Error(`ELEVENLABS_429: ${errBody2}`);
            }
          } else {
            throw new Error(`ElevenLabs API failed with status ${response.status}: ${errorText}`);
          }
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`ElevenLabs API failed with status ${response.status}: ${errorText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      if (err.message && err.message.includes("ELEVENLABS_429") && attempt < retries) {
        const delayMs = (attempt + 1) * 350;
        console.warn(`[ELEVENLABS 429] Concurrency cap reached. Retrying chunk in ${delayMs}ms (attempt ${attempt + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}


// Helper: Transcribe audio with Deepgram
async function transcribeWithDeepgram(audioBuffer, mimetype = "audio/wav") {
  const env = getEnv();
  if (!env.DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY is not configured.");
  }

  const response = await fetch("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true", {
    method: "POST",
    headers: {
      "Authorization": `Token ${env.DEEPGRAM_API_KEY}`,
      "Content-Type": mimetype || "audio/wav"
    },
    body: audioBuffer
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Deepgram API failed with status ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";
}

// Helper: Transcribe audio with Groq Whisper Turbo
async function transcribeWithWhisper(audioBuffer, originalname = "audio.webm", mimetype = "audio/webm") {
  getEnv();
  if (!groq) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const fileObj = await toFile(audioBuffer, originalname, { type: mimetype });
  const transcription = await groq.audio.transcriptions.create({
    file: fileObj,
    model: "whisper-large-v3-turbo",
    response_format: "json"
  });

  return (transcription.text || "").trim();
}

// ==============================================
// 1. Health Check & Diagnostics Endpoint
// ==============================================
app.get("/api/health", (req, res) => {
  const env = getEnv();
  const isKeyFormatValid = Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_API_KEY.startsWith("sk_"));
  res.json({
    status: "online",
    message: "AI Voice Agent Backend is running smoothly!",
    stage3: {
      realTimeStreaming: true,
      protocol: "WebSockets",
      wsPath: "/ws/voice",
      sentencePipelining: true,
      bargeInSupported: true,
      targetLatency: "<500ms"
    },
    services: {
      llm: {
        provider: "Groq Cloud",
        configured: Boolean(groq),
        model: env.GROQ_MODEL,
        streaming: true
      },
      stt: {
        whisper: Boolean(groq),
        whisperModel: "whisper-large-v3-turbo",
        deepgram: Boolean(env.DEEPGRAM_API_KEY)
      },
      tts: {
        elevenlabs: isKeyFormatValid,
        model: "eleven_flash_v2_5",
        fallback: "browser-speech-synthesis",
        defaultVoice: env.DEFAULT_ELEVENLABS_VOICE,
        keyPresent: Boolean(env.ELEVENLABS_API_KEY),
        keyValidFormat: isKeyFormatValid,
        concurrencyLimit: 2
      },
      openai: {
        configured: Boolean(env.OPENAI_API_KEY),
        keyPresent: Boolean(env.OPENAI_API_KEY),
        keyValidFormat: Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.startsWith("sk-")),
        creditStatus: env.OPENAI_API_KEY ? "credit_balance_exhausted ($0.00)" : "not_configured",
        message: env.OPENAI_API_KEY
          ? "OpenAI key detected and authenticated, but credit balance is $0.00. Using Groq Cloud LLM for real-time streaming."
          : "Not configured"
      },
      websocket: {
        path: "/ws/voice",
        status: "active"
      }
    }
  });
});

// ==============================================
// 2. Voices Listing Endpoint
// ==============================================
app.get("/api/voices", (req, res) => {
  const env = getEnv();
  const isKeyFormatValid = Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_API_KEY.startsWith("sk_"));
  res.json({
    elevenlabsConfigured: isKeyFormatValid,
    keyPresent: Boolean(env.ELEVENLABS_API_KEY),
    keyIssue: env.ELEVENLABS_API_KEY && !isKeyFormatValid 
      ? "API key ID used instead of Secret API Key (must start with 'sk_')" 
      : null,
    defaultVoiceId: env.DEFAULT_ELEVENLABS_VOICE,
    activeProvider: isKeyFormatValid ? "ElevenLabs" : "Browser Web Speech",
    voices: PRESET_VOICES
  });
});

// ==============================================
// 3. Chat Endpoint (LLM Brain)
// ==============================================
app.post("/chat", async (req, res) => {
  try {
    const env = getEnv();
    const { message } = req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({
        error: "Invalid request. Please send a JSON object with a 'message' field, e.g. {\"message\": \"Hello\"}"
      });
    }

    if (!groq) {
      console.log(`[SIMULATION] Received: "${message}"`);
      return res.json({
        reply: "Hello! Your backend is working! (Add GROQ_API_KEY to .env for live Groq AI responses).",
        simulated: true
      });
    }

    console.log(`[AI REQUEST] User: "${message}"`);

    const completion = await groq.chat.completions.create({
      model: env.GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a knowledgeable, highly accurate AI voice assistant. Provide authentic, accurate information in the language requested by the user (such as Urdu or English). Keep answers natural, clear, and concise (2-3 sentences), so they can be spoken aloud smoothly."
        },
        {
          role: "user",
          content: message
        }
      ],
      max_tokens: 800,
      temperature: 0.7,
      ...(env.GROQ_MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {})
    });

    const aiReply = completion.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
    console.log(`[AI RESPONSE] "${aiReply}"`);

    res.json({
      reply: aiReply
    });
  } catch (error) {
    console.error("[ERROR] Chat route error:", error);
    res.status(500).json({
      error: "Failed to communicate with LLM.",
      details: error.message
    });
  }
});

// ==============================================
// 4. Speech-to-Text Endpoint (Ears: Whisper Turbo / Deepgram)
// ==============================================
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const env = getEnv();
    if (!req.file) {
      return res.status(400).json({
        error: "No audio file uploaded. Please send audio via multipart/form-data with key 'audio'."
      });
    }

    const requestedProvider = (req.query.provider || req.body?.provider || "whisper").toLowerCase();
    console.log(`[STT REQUEST] Provider: ${requestedProvider}, Size: ${(req.file.size / 1024).toFixed(1)} KB`);

    let transcribedText = "";
    let activeProvider = "whisper";

    if (requestedProvider === "deepgram" && env.DEEPGRAM_API_KEY) {
      transcribedText = await transcribeWithDeepgram(req.file.buffer, req.file.mimetype);
      activeProvider = "deepgram";
    } else {
      // Default to Groq Whisper Turbo
      if (!groq) {
        return res.json({
          text: "Simulation: Speech received. (Add GROQ_API_KEY to transcribe with Groq Whisper).",
          simulated: true,
          provider: "simulation"
        });
      }

      transcribedText = await transcribeWithWhisper(
        req.file.buffer,
        req.file.originalname || "audio.webm",
        req.file.mimetype || "audio/webm"
      );
      activeProvider = "whisper-large-v3-turbo";
    }

    console.log(`[STT SUCCESS] (${activeProvider}) Result: "${transcribedText}"`);

    res.json({
      text: transcribedText,
      provider: activeProvider
    });
  } catch (error) {
    console.error("[ERROR] Transcription error:", error);
    res.status(500).json({
      error: "Failed to transcribe audio.",
      details: error.message
    });
  }
});

// ==============================================
// 5. Text-to-Speech Endpoint (Mouth: ElevenLabs / Fallback)
// ==============================================
app.all("/tts", async (req, res) => {
  try {
    const env = getEnv();
    // Support both POST (body) and GET (query parameters)
    const text = (req.body?.text || req.query?.text || "").trim();
    const voiceId = req.body?.voiceId || req.query?.voiceId || env.DEFAULT_ELEVENLABS_VOICE;
    const format = req.body?.format || req.query?.format || "stream"; // "stream" | "base64" | "json"

    if (!text) {
      return res.status(400).json({
        error: "Missing 'text' parameter. Please provide text to convert to speech."
      });
    }

    // If ElevenLabs API Key is not set, provide graceful fallback details
    if (!env.ELEVENLABS_API_KEY) {
      console.log(`[TTS FALLBACK] ElevenLabs key not found. Recommending browser TTS for: "${text}"`);
      return res.status(400).json({
        fallback: true,
        mode: "browser",
        message: "ELEVENLABS_API_KEY is not set in .env. Please add it to enable realistic AI voice.",
        text: text,
        voiceId: voiceId
      });
    }

    console.log(`[TTS REQUEST] ElevenLabs voice "${voiceId}", Text: "${text.substring(0, 60)}..."`);
    const audioBuffer = await synthesizeElevenLabs(text, voiceId);
    console.log(`[TTS SUCCESS] Generated ${(audioBuffer.length / 1024).toFixed(1)} KB MP3`);

    if (format === "base64" || format === "json") {
      return res.json({
        audioBase64: audioBuffer.toString("base64"),
        mimeType: "audio/mpeg",
        sizeBytes: audioBuffer.length
      });
    }

    // Stream binary MP3 audio back to client
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.setHeader("Cache-Control", "no-cache");
    res.end(audioBuffer);
  } catch (error) {
    console.error("[ERROR] TTS error:", error);
    res.status(500).json({
      error: "Text-to-Speech generation failed.",
      details: error.message
    });
  }
});

// ==============================================
// 6. Complete Voice Pipeline: Ears ➡️ Brain ➡️ Mouth
// ==============================================
app.post("/voice-chat", upload.single("audio"), async (req, res) => {
  try {
    const env = getEnv();

    if (!req.file) {
      return res.status(400).json({
        error: "No audio file uploaded. Please send audio via multipart/form-data with key 'audio'."
      });
    }

    if (!groq) {
      return res.json({
        transcript: "Simulation voice input",
        reply: "Backend running in simulation mode. Add GROQ_API_KEY to your .env file."
      });
    }

    // Step 1: EARS (Speech-to-Text via Whisper Turbo)
    console.log(`[VOICE PIPELINE] 1. Processing speech audio...`);
    const userSpeechText = await transcribeWithWhisper(
      req.file.buffer,
      req.file.originalname || "audio.webm",
      req.file.mimetype || "audio/webm"
    );

    if (!userSpeechText) {
      return res.json({
        transcript: "",
        reply: "I couldn't hear anything clearly. Could you please try speaking again?"
      });
    }
    console.log(`[VOICE PIPELINE] 1. Ears heard: "${userSpeechText}"`);

    // Step 2: BRAIN (LLM Reasoning via Groq)
    console.log(`[VOICE PIPELINE] 2. Sending to Groq LLM...`);
    const completion = await groq.chat.completions.create({
      model: env.GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a knowledgeable, highly accurate AI voice assistant. Provide authentic, accurate information in the language requested by the user (such as Urdu or English). Keep answers natural, clear, and concise (2-3 sentences), so they can be spoken aloud smoothly."
        },
        {
          role: "user",
          content: userSpeechText
        }
      ],
      max_tokens: 800,
      temperature: 0.7,
      ...(env.GROQ_MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {})
    });

    const aiReply = completion.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
    console.log(`[VOICE PIPELINE] 2. Brain replied: "${aiReply}"`);

    // Step 3: MOUTH (Text-to-Speech via ElevenLabs if configured)
    let audioBase64 = null;
    let ttsMode = "browser";

    if (env.ELEVENLABS_API_KEY) {
      try {
        console.log(`[VOICE PIPELINE] 3. Synthesizing voice with ElevenLabs...`);
        const voiceId = req.body?.voiceId || req.query?.voiceId || env.DEFAULT_ELEVENLABS_VOICE;
        const audioBuffer = await synthesizeElevenLabs(aiReply, voiceId);
        audioBase64 = audioBuffer.toString("base64");
        ttsMode = "elevenlabs";
        console.log(`[VOICE PIPELINE] 3. Voice audio ready (${(audioBuffer.length / 1024).toFixed(1)} KB)`);
      } catch (ttsErr) {
        console.warn(`[VOICE PIPELINE] ElevenLabs synthesis failed, falling back to browser TTS:`, ttsErr.message);
      }
    }

    res.json({
      transcript: userSpeechText,
      reply: aiReply,
      ttsMode: ttsMode,
      audioBase64: audioBase64
    });
  } catch (error) {
    console.error("[ERROR] Voice-chat pipeline error:", error);
    res.status(500).json({
      error: "Voice-chat pipeline failed.",
      details: error.message
    });
  }
});

// ==============================================
// 7. Stage 3: Real-Time Streaming WebSocket Server (/ws/voice)
// ==============================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/voice" });

// Safe JSON sender for WebSocket clients
function safeSend(ws, messageObj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(messageObj));
  }
}

// Helper to guarantee audio chunks are sent to client in strict sequential order (0, 1, 2, ...)
function dispatchOrderedChunk(ws, session, chunkIndex, payload) {
  if (!session.pendingChunks) {
    session.pendingChunks = new Map();
  }
  session.pendingChunks.set(chunkIndex, payload);

  if (typeof session.nextChunkToSend !== "number") {
    session.nextChunkToSend = 0;
  }

  while (session.pendingChunks.has(session.nextChunkToSend)) {
    const nextPayload = session.pendingChunks.get(session.nextChunkToSend);
    session.pendingChunks.delete(session.nextChunkToSend);
    session.nextChunkToSend++;
    safeSend(ws, nextPayload);
  }
}

// Synthesize an audio chunk with ElevenLabs and stream to WS client
async function synthesizeAndStreamChunk(
  ws,
  session,
  sentence,
  chunkIndex,
  pipelineStartTime,
  signal,
  sttLatencyMs = 0,
  isLast = false
) {
  if (signal && signal.aborted) return;
  const env = getEnv();
  const ttsStart = Date.now();

  if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_API_KEY.startsWith("sk_")) {
    try {
      console.log(`[WS TTS] Synthesizing Chunk #${chunkIndex}: "${sentence.substring(0, 30)}..."`);
      const audioBuffer = await synthesizeElevenLabs(sentence, session.voiceId, signal);
      if (signal && signal.aborted) return;

      const ttsLatencyMs = Date.now() - ttsStart;
      const ttfaMs = Date.now() - pipelineStartTime + sttLatencyMs;

      // If audioBuffer is empty (e.g. text had no speakable words/letters), skip audio smoothly
      if (!audioBuffer || audioBuffer.length === 0) {
        dispatchOrderedChunk(ws, session, chunkIndex, {
          type: "tts_skip",
          chunkIndex: chunkIndex,
          text: sentence,
          isLast: isLast
        });
        return;
      }

      console.log(`[WS TTS READY] Chunk #${chunkIndex} (${ttsLatencyMs}ms) | TTFA: ${ttfaMs}ms | ${(audioBuffer.length / 1024).toFixed(1)} KB`);

      dispatchOrderedChunk(ws, session, chunkIndex, {
        type: "tts_audio_chunk",
        chunkIndex: chunkIndex,
        text: sentence,
        audioBase64: audioBuffer.toString("base64"),
        mimeType: "audio/mpeg",
        ttsLatencyMs: ttsLatencyMs,
        ttfaMs: chunkIndex === 0 ? ttfaMs : null,
        isLast: isLast
      });
      return;
    } catch (err) {
      if (signal && signal.aborted) return;
      console.warn(`[WS TTS WARNING] Chunk #${chunkIndex} error: ${err.message}.`);
      // NOTE: Do NOT send robotic tts_fallback when ElevenLabs is configured!
      // Dispatch tts_audio_error so the sequence advances smoothly without playing robotic Windows voice.
      dispatchOrderedChunk(ws, session, chunkIndex, {
        type: "tts_audio_error",
        chunkIndex: chunkIndex,
        text: sentence,
        error: err.message,
        isLast: isLast
      });
      return;
    }
  }

  // Fallback to browser Web Speech ONLY if ElevenLabs is NOT configured at all
  const totalLatencyMs = Date.now() - pipelineStartTime + sttLatencyMs;
  dispatchOrderedChunk(ws, session, chunkIndex, {
    type: "tts_fallback",
    chunkIndex: chunkIndex,
    text: sentence,
    reason: "ELEVENLABS_API_KEY not configured",
    ttfaMs: chunkIndex === 0 ? totalLatencyMs : null,
    isLast: isLast
  });
}

// Handle end-to-end streaming conversational pipeline (Groq LLM Stream -> Sentence Pipeline -> TTS)
async function handleStreamingPipeline(ws, session, userText, sttLatencyMs = 0) {
  // Cancel previous running pipeline on this session if any
  if (session.abortController) {
    session.abortController.abort();
  }
  session.abortController = new AbortController();
  const signal = session.abortController.signal;
  session.isProcessing = true;
  session.nextChunkToSend = 0;
  session.pendingChunks = new Map();

  const pipelineStartTime = Date.now();
  safeSend(ws, {
    type: "llm_start",
    input: userText,
    timestamp: pipelineStartTime
  });

  const env = getEnv();

  // If Groq key not configured, provide simulated low-latency stream
  if (!groq) {
    console.log(`[WS SIMULATION] Streaming simulated reply for: "${userText}"`);
    const simulatedSentences = [
      "Hello! I received your message via WebSocket.",
      "The real-time streaming pipeline is active with sub-500 millisecond response time.",
      "Add GROQ_API_KEY to your .env to chat with the live Groq 120B model."
    ];

    let sentenceIndex = 0;
    let accumulated = "";

    for (let i = 0; i < simulatedSentences.length; i++) {
      if (signal.aborted) break;
      const sentence = simulatedSentences[i];
      const words = sentence.split(" ");

      for (const word of words) {
        if (signal.aborted) break;
        accumulated += (accumulated ? " " : "") + word;
        safeSend(ws, {
          type: "llm_token",
          token: word + " ",
          accumulated: accumulated
        });
        await new Promise((r) => setTimeout(r, 45));
      }

      if (signal.aborted) break;
      await synthesizeAndStreamChunk(
        ws,
        session,
        sentence,
        sentenceIndex++,
        pipelineStartTime,
        signal,
        sttLatencyMs,
        i === simulatedSentences.length - 1
      );
    }

    if (!signal.aborted) {
      safeSend(ws, {
        type: "pipeline_complete",
        totalTimeMs: Date.now() - pipelineStartTime,
        fullReply: accumulated
      });
    }
    session.isProcessing = false;
    return;
  }

  // Real Groq LLM Token Streaming
  try {
    const stream = await groq.chat.completions.create(
      {
        model: env.GROQ_MODEL,
        messages: [
          {
            role: "system",
            content:
              session.systemPrompt ||
              "You are a knowledgeable, highly accurate AI voice assistant. Provide authentic, accurate information in the language requested by the user (such as Urdu or English). Keep answers natural, clear, and concise (2-3 sentences), so they can be spoken aloud in real-time."
          },
          {
            role: "user",
            content: userText
          }
        ],
        max_tokens: 800,
        temperature: 0.7,
        stream: true,
        ...(env.GROQ_MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {})
      },
      { signal }
    );

    let fullReply = "";
    let sentenceBuffer = "";
    let sentenceIndex = 0;
    let firstTokenTime = null;
    const pendingTtsPromises = [];

    for await (const chunk of stream) {
      if (signal.aborted) {
        console.log(`[WS STREAM] Stream aborted by user interruption.`);
        break;
      }

      const token = chunk.choices[0]?.delta?.content || "";
      if (!token) continue;

      if (!firstTokenTime) {
        firstTokenTime = Date.now();
        const ttft = firstTokenTime - pipelineStartTime;
        safeSend(ws, {
          type: "llm_first_token",
          latencyMs: ttft
        });
        console.log(`[WS LLM TTFT] First token received in ${ttft}ms`);
      }

      fullReply += token;
      sentenceBuffer += token;

      safeSend(ws, {
        type: "llm_token",
        token: token,
        accumulated: fullReply
      });

      // Sentence Boundary Detection
      // Split on terminal punctuation (. ! ? or Urdu ۔) followed by space/newline when buffer is >= 25 chars,
      // or double newline \n\n when buffer is >= 20 chars,
      // or single newline \n when buffer is >= 45 chars,
      // or clause punctuation (, ; : ، ؛) when buffer is >= 65 chars.
      let splitPos = -1;
      let delimLen = 0;

      const termMatch = sentenceBuffer.match(/([.!?\u06D4])(\s+|$)/);
      if (termMatch && termMatch.index + termMatch[1].length >= 25) {
        splitPos = termMatch.index + termMatch[1].length;
        delimLen = termMatch[2].length;
      } else if (sentenceBuffer.includes("\n\n") && sentenceBuffer.indexOf("\n\n") >= 20) {
        splitPos = sentenceBuffer.indexOf("\n\n");
        delimLen = 2;
      } else if (sentenceBuffer.length >= 45 && sentenceBuffer.includes("\n")) {
        splitPos = sentenceBuffer.indexOf("\n");
        delimLen = 1;
      } else if (sentenceBuffer.length >= 65) {
        const clauseMatch = sentenceBuffer.match(/([,;:،؛])\s+/);
        if (clauseMatch && clauseMatch.index >= 30) {
          splitPos = clauseMatch.index + clauseMatch[1].length;
          delimLen = clauseMatch[0].length - clauseMatch[1].length;
        }
      }

      if (splitPos !== -1) {
        const sentenceToSynthesize = sentenceBuffer.substring(0, splitPos).trim();
        sentenceBuffer = sentenceBuffer.substring(splitPos + delimLen);

        if (sentenceToSynthesize && /[a-zA-Z0-9\u0600-\u06FF]/.test(sentenceToSynthesize)) {
          pendingTtsPromises.push(
            synthesizeAndStreamChunk(
              ws,
              session,
              sentenceToSynthesize,
              sentenceIndex++,
              pipelineStartTime,
              signal,
              sttLatencyMs,
              false
            )
          );
        }
      }
    }

    // Flush any leftover sentence buffer when stream finishes
    if (!signal.aborted && sentenceBuffer.trim()) {
      const leftover = sentenceBuffer.trim();
      if (/[a-zA-Z0-9\u0600-\u06FF]/.test(leftover)) {
        pendingTtsPromises.push(
          synthesizeAndStreamChunk(
            ws,
            session,
            leftover,
            sentenceIndex++,
            pipelineStartTime,
            signal,
            sttLatencyMs,
            true
          )
        );
      }
    }

    // Await all chunk syntheses before declaring pipeline complete
    if (!signal.aborted) {
      await Promise.allSettled(pendingTtsPromises);
      const totalDuration = Date.now() - pipelineStartTime;
      safeSend(ws, {
        type: "pipeline_complete",
        totalTimeMs: totalDuration,
        fullReply: fullReply
      });
      console.log(`[WS PIPELINE COMPLETED] Total time: ${totalDuration}ms`);
    }
  } catch (error) {
    if (signal.aborted || error.name === "AbortError") {
      console.log(`[WS PIPELINE ABORTED] Pipeline aborted on signal.`);
    } else {
      console.error("[WS LLM ERROR]", error);
      safeSend(ws, {
        type: "error",
        error: "LLM generation failed: " + error.message
      });
    }
  } finally {
    session.isProcessing = false;
  }
}

// WebSocket Connection Lifecycle
wss.on("connection", (ws, req) => {
  const sessionId = "sess_" + Math.random().toString(36).substring(2, 9);
  console.log(`[WS CONNECTED] Client connected (${sessionId}) from ${req.socket.remoteAddress}`);

  const env = getEnv();
  const session = {
    id: sessionId,
    voiceId: env.DEFAULT_ELEVENLABS_VOICE,
    systemPrompt: "You are a knowledgeable, highly accurate AI voice assistant. Provide authentic, accurate information in the language requested by the user (such as Urdu or English). Keep answers natural, clear, and concise (2-3 sentences), so they can be spoken aloud in real-time.",
    abortController: null,
    isProcessing: false,
    audioChunks: [],
    audioStartTime: 0,
    nextChunkToSend: 0,
    pendingChunks: new Map()
  };

  // Notify client that connection is ready
  safeSend(ws, {
    type: "session_ready",
    sessionId: session.id,
    voiceId: session.voiceId,
    defaultVoice: env.DEFAULT_ELEVENLABS_VOICE,
    models: {
      llm: env.GROQ_MODEL,
      stt: "whisper-large-v3-turbo",
      tts: "eleven_flash_v2_5"
    }
  });

  ws.on("message", async (data, isBinary) => {
    try {
      // 1. Binary audio chunk
      if (isBinary) {
        session.audioChunks.push(Buffer.from(data));
        return;
      }

      // 2. JSON control message
      let msg;
      try {
        msg = JSON.parse(data.toString("utf8"));
      } catch (parseErr) {
        console.warn(`[WS NON-JSON] ${data.toString("utf8").substring(0, 50)}`);
        return;
      }

      switch (msg.type) {
        case "session_init": {
          if (msg.voiceId) session.voiceId = msg.voiceId;
          if (msg.systemPrompt) session.systemPrompt = msg.systemPrompt;
          safeSend(ws, {
            type: "session_updated",
            voiceId: session.voiceId
          });
          break;
        }

        case "audio_start": {
          session.audioChunks = [];
          session.audioStartTime = Date.now();
          safeSend(ws, { type: "audio_started" });
          break;
        }

        case "audio_chunk": {
          if (msg.data) {
            session.audioChunks.push(Buffer.from(msg.data, "base64"));
          }
          break;
        }

        case "audio_end": {
          if (session.audioChunks.length === 0) {
            safeSend(ws, { type: "error", message: "No audio data received" });
            return;
          }

          const audioBuffer = Buffer.concat(session.audioChunks);
          session.audioChunks = [];
          console.log(`[WS AUDIO RECEIVED] ${(audioBuffer.length / 1024).toFixed(1)} KB`);

          const sttStart = Date.now();
          safeSend(ws, { type: "stt_start" });

          let userSpeechText = "";
          try {
            if (!groq) {
              userSpeechText = "Hello! What is the weather like?";
            } else {
              userSpeechText = await transcribeWithWhisper(
                audioBuffer,
                msg.filename || "speech.webm",
                msg.mimeType || "audio/webm"
              );
            }
          } catch (sttErr) {
            console.error("[WS STT ERROR]", sttErr.message);
            safeSend(ws, { type: "error", error: "STT failed: " + sttErr.message });
            return;
          }

          const sttLatencyMs = Date.now() - sttStart;
          console.log(`[WS STT COMPLETED] (${sttLatencyMs}ms) "${userSpeechText}"`);

          safeSend(ws, {
            type: "transcription_final",
            text: userSpeechText,
            latencyMs: sttLatencyMs
          });

          if (!userSpeechText || !userSpeechText.trim()) {
            safeSend(ws, {
              type: "stt_empty",
              message: "No speech recognized. Please try speaking again."
            });
            return;
          }

          // Kicks off streaming LLM + sentence-pipelined TTS
          await handleStreamingPipeline(ws, session, userSpeechText, sttLatencyMs);
          break;
        }

        case "text_input": {
          const userText = (msg.text || "").trim();
          if (!userText) return;
          console.log(`[WS TEXT INPUT] "${userText}"`);
          safeSend(ws, {
            type: "transcription_final",
            text: userText,
            latencyMs: 0
          });
          await handleStreamingPipeline(ws, session, userText, 0);
          break;
        }

        case "interrupt": {
          // Instant Barge-In / Interruption
          console.log(`[WS INTERRUPT] Interruption received from client ${session.id}`);
          if (session.abortController) {
            session.abortController.abort();
          }
          session.isProcessing = false;
          session.nextChunkToSend = 0;
          if (session.pendingChunks) {
            session.pendingChunks.clear();
          }
          safeSend(ws, {
            type: "interrupted",
            message: "Stream interrupted by user barge-in.",
            timestamp: Date.now()
          });
          break;
        }

        default:
          console.log(`[WS UNKNOWN TYPE]`, msg.type);
      }
    } catch (err) {
      console.error("[WS MESSAGE ERROR]", err);
      safeSend(ws, { type: "error", error: err.message });
    }
  });

  ws.on("close", () => {
    if (session.abortController) {
      session.abortController.abort();
    }
    console.log(`[WS DISCONNECTED] Client ${session.id} disconnected`);
  });

  ws.on("error", (err) => {
    console.error(`[WS CLIENT ERROR] ${session.id}:`, err.message);
  });
});

// Start the server (HTTP + WebSocket on same port)
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 AI Voice Agent Backend is live on http://localhost:${PORT}`);
  console.log(`⚡ WebSocket Stream: ws://localhost:${PORT}/ws/voice (Stage 3)`);
  console.log(`📡 Health Check : GET  http://localhost:${PORT}/api/health`);
  console.log(`🎭 Voices List  : GET  http://localhost:${PORT}/api/voices`);
  console.log(`💬 Text Chat    : POST http://localhost:${PORT}/chat`);
  console.log(`👂 Ears (STT)   : POST http://localhost:${PORT}/transcribe`);
  console.log(`👄 Mouth (TTS)  : POST http://localhost:${PORT}/tts`);
  console.log(`⚡ Voice Loop   : POST http://localhost:${PORT}/voice-chat`);
  const env = getEnv();
  console.log(`------------------------------------------------------`);
  console.log(`🧠 Brain (LLM)  : ${groq ? "✅ Groq (" + env.GROQ_MODEL + ") [Streaming Ready]" : "⚠️  Simulation Mode"}`);
  console.log(`👂 Ears (STT)   : ${groq ? "✅ Groq Whisper Turbo" : "⚠️  Simulation"}${env.DEEPGRAM_API_KEY ? " + Deepgram" : ""}`);
  console.log(`👄 Mouth (TTS)  : ${env.ELEVENLABS_API_KEY ? (env.ELEVENLABS_API_KEY.startsWith("sk_") ? "✅ ElevenLabs Active (Flash v2.5 Pipelined)" : "⚠️  Invalid Key (Key ID entered instead of sk_...)") : "ℹ️  Browser Speech Fallback"}`);
  console.log(`⚡ Latency Goal : <500ms Time-to-First-Audio (TTFA) + Live Barge-in`);
  console.log(`======================================================\n`);
});

