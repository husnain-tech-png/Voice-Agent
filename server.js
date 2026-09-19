import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq, { toFile } from "groq-sdk";
import multer from "multer";

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
    DEEPGRAM_API_KEY: deepgramKey
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

// Helper: Synthesize speech with ElevenLabs
async function synthesizeElevenLabs(text, voiceId) {
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

  let response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg"
    },
    body: JSON.stringify({
      text: text,
      model_id: "eleven_flash_v2_5", // Ultra-fast low-latency voice model
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    })
  });

  // If flash model is not active on this tier, fallback to eleven_multilingual_v2
  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 404 || (response.status === 400 && errorText.includes("model"))) {
      response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        body: JSON.stringify({
          text: text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      });
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
    services: {
      llm: {
        provider: "Groq Cloud",
        configured: Boolean(groq),
        model: env.GROQ_MODEL
      },
      stt: {
        whisper: Boolean(groq),
        whisperModel: "whisper-large-v3-turbo",
        deepgram: Boolean(env.DEEPGRAM_API_KEY)
      },
      tts: {
        elevenlabs: isKeyFormatValid,
        fallback: "browser-speech-synthesis",
        defaultVoice: env.DEFAULT_ELEVENLABS_VOICE,
        keyPresent: Boolean(env.ELEVENLABS_API_KEY),
        keyValidFormat: isKeyFormatValid
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
            "You are a friendly, concise AI voice assistant. Respond naturally and keep answers short (1-3 sentences), since your response will be spoken aloud to a caller over the phone."
        },
        {
          role: "user",
          content: message
        }
      ],
      max_tokens: 150,
      temperature: 0.7
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
            "You are a friendly, concise AI voice assistant. Respond naturally and keep answers short (1-3 sentences), since your response will be spoken aloud to a caller over the phone."
        },
        {
          role: "user",
          content: userSpeechText
        }
      ],
      max_tokens: 150,
      temperature: 0.7
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

// Start the server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 AI Voice Agent Backend is live on http://localhost:${PORT}`);
  console.log(`📡 Health Check : GET  http://localhost:${PORT}/api/health`);
  console.log(`🎭 Voices List  : GET  http://localhost:${PORT}/api/voices`);
  console.log(`💬 Text Chat    : POST http://localhost:${PORT}/chat`);
  console.log(`👂 Ears (STT)   : POST http://localhost:${PORT}/transcribe`);
  console.log(`👄 Mouth (TTS)  : POST http://localhost:${PORT}/tts`);
  console.log(`⚡ Voice Loop   : POST http://localhost:${PORT}/voice-chat`);
  const env = getEnv();
  console.log(`------------------------------------------------------`);
  console.log(`🧠 Brain (LLM)  : ${groq ? "✅ Groq (" + env.GROQ_MODEL + ")" : "⚠️  Simulation Mode"}`);
  console.log(`👂 Ears (STT)   : ${groq ? "✅ Groq Whisper Turbo" : "⚠️  Simulation"}${env.DEEPGRAM_API_KEY ? " + Deepgram" : ""}`);
  console.log(`👄 Mouth (TTS)  : ${env.ELEVENLABS_API_KEY ? (env.ELEVENLABS_API_KEY.startsWith("sk_") ? "✅ ElevenLabs Active" : "⚠️  Invalid Key (Key ID entered instead of sk_...)") : "ℹ️  Browser Speech Fallback"}`);
  console.log(`======================================================\n`);
});
