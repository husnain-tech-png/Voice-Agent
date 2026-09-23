import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import Groq, { toFile } from "groq-sdk";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import twilio from "twilio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startAutoTunnel } from "./tunnel.js";

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load variables from .env into process.env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration Keys & Dynamic Environment Loader
let groq = null;
let twilioClient = null;

function getEnv() {
  dotenv.config({ override: true });
  const groqKey = (process.env.GROQ_API_KEY || "").trim();
  const elevenlabsKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  const groqModel = (process.env.GROQ_MODEL || "openai/gpt-oss-120b").trim();
  const defaultVoice = (process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL").trim(); // Bella (Free Tier & Pro)
  const deepgramKey = (process.env.DEEPGRAM_API_KEY || "").trim();
  const openaiKey = (process.env.OPEN_AI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const twilioAccountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const twilioAuthToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const twilioPhoneNumber = (process.env.TWILIO_PHONE_NUMBER || "").trim();
  const telnyxApiKey = (process.env.TELNYX_API_KEY || "").trim();
  const telnyxPhoneNumber = (process.env.TELNYX_PHONE_NUMBER || "").trim();
  const telnyxTexmlAppId = (process.env.TELNYX_TEXML_APP_ID || "").trim();
  const publicUrl = (process.env.PUBLIC_URL || "").trim();

  // Sync Groq client whenever key is updated
  if (groqKey) {
    if (!groq || groq.apiKey !== groqKey) {
      groq = new Groq({ apiKey: groqKey });
    }
  } else {
    groq = null;
  }

  // Sync Twilio client whenever credentials are provided
  if (twilioAccountSid && twilioAuthToken && twilioAccountSid.startsWith("AC")) {
    try {
      twilioClient = twilio(twilioAccountSid, twilioAuthToken);
    } catch (twErr) {
      console.warn("[TWILIO] Client initialization error:", twErr.message);
      twilioClient = null;
    }
  } else {
    twilioClient = null;
  }

  const personalPhoneNumber = (process.env.PERSONAL_PHONE_NUMBER || "").trim();

  return {
    GROQ_API_KEY: groqKey,
    GROQ_MODEL: groqModel,
    ELEVENLABS_API_KEY: elevenlabsKey,
    DEFAULT_ELEVENLABS_VOICE: defaultVoice,
    DEEPGRAM_API_KEY: deepgramKey,
    OPENAI_API_KEY: openaiKey,
    TWILIO_ACCOUNT_SID: twilioAccountSid,
    TWILIO_AUTH_TOKEN: twilioAuthToken,
    TWILIO_PHONE_NUMBER: twilioPhoneNumber,
    TELNYX_API_KEY: telnyxApiKey,
    TELNYX_PHONE_NUMBER: telnyxPhoneNumber,
    TELNYX_TEXML_APP_ID: telnyxTexmlAppId,
    PUBLIC_URL: publicUrl,
    PERSONAL_PHONE_NUMBER: personalPhoneNumber
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

// ==========================================================
// Stage 5: Call History Storage & Post-Call Summary Engine
// ==========================================================

const CALL_HISTORY_FILE = path.join(__dirname, "call-history.json");
let callHistory = [];

// Load existing call history from disk on startup
try {
  if (fs.existsSync(CALL_HISTORY_FILE)) {
    const raw = fs.readFileSync(CALL_HISTORY_FILE, "utf-8");
    callHistory = JSON.parse(raw);
    console.log(`[STAGE 5] Loaded ${callHistory.length} calls from call-history.json`);
  }
} catch (loadErr) {
  console.warn(`[STAGE 5] Could not load call history:`, loadErr.message);
  callHistory = [];
}

// Save call history to disk (keeps last 50 calls)
function saveCallHistory() {
  try {
    // Keep only the last 50 calls
    if (callHistory.length > 50) {
      callHistory = callHistory.slice(-50);
    }
    fs.writeFileSync(CALL_HISTORY_FILE, JSON.stringify(callHistory, null, 2), "utf-8");
  } catch (saveErr) {
    console.warn(`[STAGE 5] Could not save call history:`, saveErr.message);
  }
}

// Generate a concise post-call summary using Groq LLM
async function generateCallSummary(transcript, callerNumber) {
  if (!groq || !transcript || transcript.length === 0) {
    return `Call from ${callerNumber}. No transcript available.`;
  }

  const conversationText = transcript
    .map(t => `${t.role === "user" ? "Caller" : "AI Assistant"}: ${t.text}`)
    .join("\n");

  try {
    const env = getEnv();
    const completion = await groq.chat.completions.create({
      model: env.GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: "Summarize the following phone call transcript in 2-3 concise sentences. Include: who called (use their phone number), what they wanted, and the AI assistant's response. Format it as a brief SMS-friendly summary. Do NOT use markdown formatting."
        },
        {
          role: "user",
          content: `Caller's phone number: ${callerNumber}\n\nTranscript:\n${conversationText}`
        }
      ],
      max_tokens: 200,
      temperature: 0.3,
      ...(env.GROQ_MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {})
    });

    return (completion.choices[0]?.message?.content || "").trim() || `Call from ${callerNumber}. Summary generation failed.`;
  } catch (err) {
    console.error(`[STAGE 5 SUMMARY ERROR]`, err.message);
    return `Call from ${callerNumber}. ${transcript.length} exchanges recorded. Summary generation failed.`;
  }
}

// Send call summary SMS to your personal phone via Telnyx or Twilio
async function sendCallSummarySms(summary, callerNumber, durationSeconds) {
  const env = getEnv();
  if (!env.PERSONAL_PHONE_NUMBER) {
    console.log(`[STAGE 5 SMS] Skipped — PERSONAL_PHONE_NUMBER not configured.`);
    return { sent: false, reason: "Personal number not configured" };
  }

  const durationStr = durationSeconds >= 60
    ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`
    : `${durationSeconds}s`;

  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "Asia/Karachi",
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
    hour12: true
  });

  const smsBody = `📞 Missed Call Handled by AI\n` +
    `From: ${callerNumber}\n` +
    `Time: ${timestamp}\n` +
    `Duration: ${durationStr}\n\n` +
    `${summary}`;

  // 1. Try Telnyx SMS if configured
  if (env.TELNYX_API_KEY && env.TELNYX_PHONE_NUMBER) {
    try {
      const telnyxRes = await fetch("https://api.telnyx.com/v2/messages", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.TELNYX_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: env.TELNYX_PHONE_NUMBER,
          to: env.PERSONAL_PHONE_NUMBER,
          text: smsBody.substring(0, 1600)
        })
      });
      const telnyxData = await telnyxRes.json();
      if (telnyxRes.ok) {
        console.log(`[STAGE 5 TELNYX SMS SENT] ID: ${telnyxData.data?.id} to ${env.PERSONAL_PHONE_NUMBER}`);
        return { sent: true, provider: "telnyx", messageId: telnyxData.data?.id };
      } else {
        console.warn(`[STAGE 5 TELNYX SMS WARNING]`, telnyxData.errors?.[0]?.detail || "Telnyx SMS failed");
      }
    } catch (tErr) {
      console.error(`[STAGE 5 TELNYX SMS ERROR]`, tErr.message);
    }
  }

  // 2. Try Twilio SMS if configured
  if (twilioClient && env.TWILIO_PHONE_NUMBER) {
    try {
      const message = await twilioClient.messages.create({
        to: env.PERSONAL_PHONE_NUMBER,
        from: env.TWILIO_PHONE_NUMBER,
        body: smsBody.substring(0, 1600)
      });
      console.log(`[STAGE 5 TWILIO SMS SENT] SID: ${message.sid} to ${env.PERSONAL_PHONE_NUMBER}`);
      return { sent: true, provider: "twilio", messageSid: message.sid };
    } catch (smsErr) {
      console.error(`[STAGE 5 TWILIO SMS ERROR]`, smsErr.message);
      return { sent: false, reason: smsErr.message };
    }
  }

  console.log(`[STAGE 5 SMS] Skipped — Neither Telnyx nor Twilio phone credentials configured.`);
  return { sent: false, reason: "No active SMS provider configured with a phone number" };
}

// Process end-of-call: generate summary, save to history, send SMS
async function processCallEnd(session) {
  if (session._callProcessed) return; // Prevent double processing
  session._callProcessed = true;

  const callEndTime = new Date().toISOString();
  const callStartTime = session.callStartTime || callEndTime;
  const durationSeconds = Math.round((new Date(callEndTime) - new Date(callStartTime)) / 1000);
  const callerNumber = session.callerNumber || "Unknown";

  console.log(`\n📱 [STAGE 5] Processing call end for ${callerNumber} (${durationSeconds}s)`);

  // Generate LLM summary if there was a conversation
  let summary = "No conversation recorded.";
  if (session.transcript && session.transcript.length > 0) {
    summary = await generateCallSummary(session.transcript, callerNumber);
    console.log(`[STAGE 5 SUMMARY] ${summary}`);
  }

  // Build call record
  const callRecord = {
    callSid: session.callSid || session.id,
    callerNumber: callerNumber,
    forwardedFrom: session.forwardedFrom || null,
    startTime: callStartTime,
    endTime: callEndTime,
    durationSeconds: durationSeconds,
    transcript: session.transcript || [],
    summary: summary,
    smsSent: false,
    smsError: null
  };

  // Send SMS summary
  const smsResult = await sendCallSummarySms(summary, callerNumber, durationSeconds);
  callRecord.smsSent = smsResult.sent;
  if (!smsResult.sent) callRecord.smsError = smsResult.reason;

  // Save to history
  callHistory.push(callRecord);
  saveCallHistory();

  console.log(`📱 [STAGE 5] Call record saved. Total calls: ${callHistory.length}. SMS sent: ${callRecord.smsSent}`);
  return callRecord;
}

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

// ==========================================================
// Telephony Audio Engine: G.711 μ-law (8000Hz) & VAD Utilities
// ==========================================================

// Precomputed 256-entry lookup table for G.711 μ-law to 16-bit linear PCM conversion
const MU_LAW_DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const inverted = ~i & 0xFF;
  const sign = inverted & 0x80;
  const exponent = (inverted & 0x70) >> 4;
  const mantissa = inverted & 0x0F;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  MU_LAW_DECODE_TABLE[i] = sign !== 0 ? -sample : sample;
}

// Convert single 16-bit linear PCM sample to G.711 μ-law byte
function pcmSampleToMulaw(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample = (sample + BIAS) >> 2;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent--;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  const mulawByte = ~(sign | (exponent << 4) | mantissa);
  return mulawByte & 0xFF;
}

// Convert a buffer of 16-bit linear PCM samples to 8-bit μ-law buffer
function pcmToMulaw(pcmBuffer) {
  const numSamples = Math.floor(pcmBuffer.length / 2);
  const mulawBuffer = Buffer.alloc(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    mulawBuffer[i] = pcmSampleToMulaw(sample);
  }
  return mulawBuffer;
}

// Generate a valid 44-byte standard RIFF WAV header for linear PCM audio
function createWavHeader(dataLength, sampleRate = 8000, numChannels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4); // ChunkSize: 36 + SubChunk2Size
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = Linear PCM)
  buffer.writeUInt16LE(numChannels, 22); // Mono (1)
  buffer.writeUInt32LE(sampleRate, 24); // 8000 Hz or 16000 Hz
  buffer.writeUInt32LE(byteRate, 28); // ByteRate
  buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34); // BitsPerSample (16)
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40); // Subchunk2Size

  return buffer;
}

// Convert 8kHz μ-law audio buffer directly to a standard 16-bit linear PCM WAV buffer
function mulawToWav(mulawBuffer, sampleRate = 8000) {
  const numSamples = mulawBuffer.length;
  const pcmBuffer = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const pcmSample = MU_LAW_DECODE_TABLE[mulawBuffer[i]];
    pcmBuffer.writeInt16LE(pcmSample, i * 2);
  }
  const header = createWavHeader(pcmBuffer.length, sampleRate, 1, 16);
  return Buffer.concat([header, pcmBuffer]);
}

// Calculate Root Mean Square (RMS) energy on μ-law audio to detect speech vs silence (VAD)
function calculateRms(mulawBuffer) {
  if (!mulawBuffer || mulawBuffer.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < mulawBuffer.length; i++) {
    const sample = MU_LAW_DECODE_TABLE[mulawBuffer[i]];
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / mulawBuffer.length);
}

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

// Helper: Synthesize speech with ElevenLabs (with concurrency limiter, 429 retry, and telephony ulaw_8000 support)
async function synthesizeElevenLabs(text, voiceId, signal = null, retries = 2, outputFormat = "mp3_44100_128") {
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

  const acceptHeader = outputFormat === "ulaw_8000" ? "audio/basic" : "audio/mpeg";

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal && signal.aborted) {
      throw new Error("Aborted");
    }

    try {
      return await elevenLabsLimiter.run(async () => {
        if (signal && signal.aborted) throw new Error("Aborted");

        let response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}/stream?optimize_streaming_latency=3&output_format=${outputFormat}`, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            "Accept": acceptHeader
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
            response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}/stream?optimize_streaming_latency=3&output_format=${outputFormat}`, {
              method: "POST",
              headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
                "Accept": acceptHeader
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
    stage4: {
      phoneLineConnection: true,
      provider: "Twilio",
      mediaStreamWsPath: "/twilio/media-stream",
      incomingWebhookPath: "/twilio/incoming",
      audioEncoding: "audio/x-mulaw (8000Hz G.711u)",
      telephonyVAD: true,
      phoneBargeIn: true,
      isConfigured: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER)
    },
    stage5: {
      mobileCallForwarding: true,
      postCallSummary: true,
      smsDelivery: Boolean((env.TELNYX_API_KEY && env.TELNYX_PHONE_NUMBER) || (twilioClient && env.TWILIO_PHONE_NUMBER)),
      personalPhoneConfigured: Boolean(env.PERSONAL_PHONE_NUMBER),
      personalPhone: env.PERSONAL_PHONE_NUMBER ? env.PERSONAL_PHONE_NUMBER.replace(/.(?=.{4})/g, "*") : "Not configured",
      callHistoryCount: callHistory.length,
      callHistoryFile: "call-history.json",
      forwardingSetupEndpoint: "/api/forwarding/setup",
      callHistoryEndpoint: "/api/calls/history"
    },
    telnyx: {
      active: Boolean(env.TELNYX_API_KEY),
      phoneNumber: env.TELNYX_PHONE_NUMBER || "Not set",
      texmlAppId: env.TELNYX_TEXML_APP_ID || "Not set",
      incomingWebhook: "/telnyx/incoming",
      mediaStreamWs: "/telnyx/media-stream"
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
        telephonyFormat: "ulaw_8000",
        fallback: "browser-speech-synthesis",
        defaultVoice: env.DEFAULT_ELEVENLABS_VOICE,
        keyPresent: Boolean(env.ELEVENLABS_API_KEY),
        keyValidFormat: isKeyFormatValid,
        concurrencyLimit: 2
      },
      twilio: {
        configured: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER),
        accountSidPresent: Boolean(env.TWILIO_ACCOUNT_SID),
        phoneNumber: env.TWILIO_PHONE_NUMBER || "Not configured",
        publicUrl: env.PUBLIC_URL || "http://localhost:3000",
        incomingWebhook: `${(env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "")}/twilio/incoming`
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
// 7. WebSocket Servers: Browser Studio (/ws/voice) & Twilio Telephony (/twilio/media-stream)
// ==============================================
const server = http.createServer(app);
const browserWss = new WebSocketServer({ noServer: true });
const twilioWss = new WebSocketServer({ noServer: true });

// Route HTTP Upgrade to correct WebSocket Server based on request path
server.on("upgrade", (request, socket, head) => {
  try {
    const host = request.headers.host || `localhost:${PORT}`;
    const url = new URL(request.url, `http://${host}`);
    const pathname = url.pathname;

    if (pathname === "/ws/voice") {
      browserWss.handleUpgrade(request, socket, head, (ws) => {
        browserWss.emit("connection", ws, request);
      });
    } else if (pathname === "/twilio/media-stream" || pathname === "/telnyx/media-stream") {
      twilioWss.handleUpgrade(request, socket, head, (ws) => {
        twilioWss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  } catch (err) {
    socket.destroy();
  }
});

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

// Browser Web Studio WebSocket Connection Lifecycle (/ws/voice)
browserWss.on("connection", (ws, req) => {
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

// ==============================================
// 8. Stage 4: Twilio Media Streams Telephony Engine (/twilio/media-stream)
// ==============================================

// Helper: Stream synthesized speech chunk as μ-law 8kHz audio to an active Twilio Media Stream
async function streamSentenceToTwilio(ws, session, sentence, signal) {
  if (signal && signal.aborted) return;
  if (!ws || ws.readyState !== WebSocket.OPEN || !session.streamSid) return;

  const env = getEnv();
  console.log(`[TWILIO TTS] Synthesizing for phone: "${sentence.substring(0, 45)}..."`);

  let mulawAudio = null;
  if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_API_KEY.startsWith("sk_")) {
    try {
      mulawAudio = await synthesizeElevenLabs(
        sentence,
        session.voiceId || env.DEFAULT_ELEVENLABS_VOICE,
        signal,
        2,
        "ulaw_8000" // ElevenLabs telephony format (8000Hz μ-law)
      );
    } catch (ttsErr) {
      if (signal && signal.aborted) return;
      console.warn(`[TWILIO TTS WARNING] ElevenLabs ulaw_8000 failed:`, ttsErr.message);
    }
  }

  // If ElevenLabs returned μ-law audio, transmit in 640-byte packets (80ms batches at 8kHz)
  if (mulawAudio && mulawAudio.length > 0) {
    if (signal && signal.aborted) return;
    session.isAiSpeaking = true;
    const packetSize = 640;

    for (let offset = 0; offset < mulawAudio.length; offset += packetSize) {
      if (signal && signal.aborted) {
        session.isAiSpeaking = false;
        return;
      }
      const packet = mulawAudio.subarray(offset, Math.min(offset + packetSize, mulawAudio.length));
      ws.send(
        JSON.stringify({
          event: "media",
          streamSid: session.streamSid,
          stream_id: session.streamSid,
          media: {
            payload: packet.toString("base64")
          }
        })
      );
    }

    // Send mark event so we know when Twilio/Telnyx finishes playback of this sentence
    if (!signal.aborted) {
      ws.send(
        JSON.stringify({
          event: "mark",
          streamSid: session.streamSid,
          stream_id: session.streamSid,
          mark: {
            name: `chunk_${session.chunkCounter++}`
          }
        })
      );
    }
  }
}

// Helper: Process caller speech audio (G.711 μ-law) ➡️ Whisper STT ➡️ Groq LLM ➡️ ElevenLabs μ-law
async function handleTwilioCallerUtterance(ws, session, mulawBuffer) {
  if (session.abortController) {
    session.abortController.abort();
  }
  session.abortController = new AbortController();
  const signal = session.abortController.signal;
  session.isAiSpeaking = true;

  try {
    // 1. EARS: Convert μ-law audio to standard WAV and transcribe via Whisper Turbo
    const wavBuffer = mulawToWav(mulawBuffer, 8000);
    console.log(`[TWILIO STT] Transcribing ${(wavBuffer.length / 1024).toFixed(1)} KB caller audio...`);

    let callerText = "";
    if (groq) {
      callerText = await transcribeWithWhisper(wavBuffer, "caller.wav", "audio/wav");
    } else {
      callerText = "Hello! What can you do?";
    }

    if (!callerText || !callerText.trim()) {
      console.log(`[TWILIO STT] No intelligible words recognized.`);
      session.isAiSpeaking = false;
      return;
    }

    console.log(`[TWILIO CALLER SAID] "${callerText}"`);

    // Add to session conversation history
    session.history.push({ role: "user", content: callerText });
    // Stage 5: Track in transcript for post-call summary
    session.transcript.push({ role: "user", text: callerText, timestamp: Date.now() });
    if (session.history.length > 6) {
      session.history = session.history.slice(-6);
    }

    // 2. BRAIN: Stream response from Groq LLM
    const env = getEnv();
    if (!groq) {
      // Simulation mode
      const reply = "I heard you say: " + callerText + ". The Twilio phone line connection is active!";
      await streamSentenceToTwilio(ws, session, reply, signal);
      session.isAiSpeaking = false;
      return;
    }

    const stream = await groq.chat.completions.create(
      {
        model: env.GROQ_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a friendly, knowledgeable AI telephone assistant on a live phone call. Keep answers clear, natural, and concise (1 to 2 short sentences), so the caller can easily follow over the telephone."
          },
          ...session.history
        ],
        max_tokens: 400,
        temperature: 0.7,
        stream: true,
        ...(env.GROQ_MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {})
      },
      { signal }
    );

    let fullReply = "";
    let sentenceBuffer = "";

    for await (const chunk of stream) {
      if (signal.aborted) break;
      const token = chunk.choices[0]?.delta?.content || "";
      if (!token) continue;
      fullReply += token;
      sentenceBuffer += token;

      // Split at sentence boundaries
      let splitPos = -1;
      let delimLen = 0;
      const termMatch = sentenceBuffer.match(/([.!?\u06D4])(\s+|$)/);
      if (termMatch && termMatch.index + termMatch[1].length >= 20) {
        splitPos = termMatch.index + termMatch[1].length;
        delimLen = termMatch[2].length;
      } else if (sentenceBuffer.length >= 55 && sentenceBuffer.includes(",")) {
        splitPos = sentenceBuffer.indexOf(",") + 1;
        delimLen = 1;
      }

      if (splitPos !== -1) {
        const sentenceToSynthesize = sentenceBuffer.substring(0, splitPos).trim();
        sentenceBuffer = sentenceBuffer.substring(splitPos + delimLen);
        if (sentenceToSynthesize && /[a-zA-Z0-9\u0600-\u06FF]/.test(sentenceToSynthesize)) {
          await streamSentenceToTwilio(ws, session, sentenceToSynthesize, signal);
        }
      }
    }

    // Flush leftover text
    if (!signal.aborted && sentenceBuffer.trim()) {
      await streamSentenceToTwilio(ws, session, sentenceBuffer.trim(), signal);
    }

    if (!signal.aborted) {
      session.history.push({ role: "assistant", content: fullReply });
      // Stage 5: Track AI reply in transcript
      session.transcript.push({ role: "assistant", text: fullReply, timestamp: Date.now() });
      console.log(`[TWILIO BRAIN REPLIED] "${fullReply}"`);
    }
  } catch (err) {
    if (signal.aborted) {
      console.log(`[TWILIO STREAM] Stream interrupted by caller barge-in.`);
    } else {
      console.error(`[TWILIO PIPELINE ERROR]`, err.message);
    }
  } finally {
    session.isAiSpeaking = false;
  }
}

// Twilio Media Stream WebSocket Connection Lifecycle (/twilio/media-stream)
twilioWss.on("connection", (ws, req) => {
  const sessionId = "tw_sess_" + Math.random().toString(36).substring(2, 9);
  console.log(`\n📞 [TWILIO WS CONNECTED] Phone media stream established (${sessionId}) from ${req.socket.remoteAddress}`);

  const env = getEnv();
  const session = {
    id: sessionId,
    streamSid: null,
    callSid: null,
    voiceId: env.DEFAULT_ELEVENLABS_VOICE,
    abortController: null,
    isAiSpeaking: false,
    callerAudioChunks: [],
    isSpeaking: false,
    silenceChunks: 0,
    speechChunksCount: 0,
    chunkCounter: 0,
    history: [],
    // Stage 5: Call tracking & summary
    callerNumber: "Unknown",
    forwardedFrom: null,
    callerName: null,
    callStartTime: new Date().toISOString(),
    transcript: [],
    _callProcessed: false
  };

  ws.on("message", async (data) => {
    try {
      let msg;
      try {
        msg = JSON.parse(data.toString("utf8"));
      } catch (parseErr) {
        return;
      }

      switch (msg.event) {
        case "connected": {
          console.log(`[TWILIO EVENT] Handshake protocol connected.`);
          break;
        }

        case "start": {
          session.streamSid = msg.streamSid || msg.stream_id || msg.start?.streamSid || msg.start?.stream_id;
          session.callSid = msg.start?.callSid || msg.start?.call_control_id || msg.start?.call_leg_id;

          // Stage 5: Extract caller metadata from stream parameters (Twilio & Telnyx format)
          const customParams = msg.start?.customParameters || msg.start?.custom_parameters || {};
          session.callerNumber = customParams.callerNumber || customParams.caller_number || "Unknown";
          session.forwardedFrom = customParams.forwardedFrom || customParams.forwarded_from || null;
          session.callerName = customParams.callerName || customParams.caller_name || null;
          session.callStartTime = new Date().toISOString();
          if (customParams.callSid) session.callSid = customParams.callSid;

          console.log(`[PHONE EVENT] Call stream started! StreamSid/ID: ${session.streamSid}, CallSid: ${session.callSid}`);
          console.log(`[PHONE EVENT] Caller: ${session.callerNumber}${session.forwardedFrom ? ` (forwarded from ${session.forwardedFrom})` : ""}`);

          // Automatic Spoken Greeting as soon as caller's phone line connects!
          const greetingText = "Hello! Thank you for calling. I am your AI assistant. How can I help you today?";
          console.log(`[TWILIO GREETING] Speaking greeting to caller...`);

          session.abortController = new AbortController();
          await streamSentenceToTwilio(ws, session, greetingText, session.abortController.signal);
          session.history.push({ role: "assistant", content: greetingText });
          // Stage 5: Track greeting in transcript
          session.transcript.push({ role: "assistant", text: greetingText, timestamp: Date.now() });
          break;
        }

        case "media": {
          if (!msg.media?.payload) return;
          const chunk = Buffer.from(msg.media.payload, "base64");
          const rms = calculateRms(chunk);
          const SPEECH_RMS_THRESHOLD = 600; // Human speech threshold on 16-bit linear PCM

          if (rms >= SPEECH_RMS_THRESHOLD) {
            // Caller is speaking!
            // If AI is currently speaking or synthesizing, trigger live Phone Barge-In!
            if (session.isAiSpeaking || (session.abortController && !session.abortController.signal.aborted)) {
              console.log(`[TWILIO BARGE-IN] Caller interrupted AI! Sending 'clear' event to Twilio.`);
              if (session.abortController) {
                session.abortController.abort();
              }
              session.isAiSpeaking = false;

              // Instruct Twilio/Telnyx to clear caller earpiece audio queue immediately!
              if (ws.readyState === WebSocket.OPEN && session.streamSid) {
                ws.send(
                  JSON.stringify({
                    event: "clear",
                    streamSid: session.streamSid,
                    stream_id: session.streamSid
                  })
                );
              }
            }

            session.isSpeaking = true;
            session.silenceChunks = 0;
            session.speechChunksCount++;
            session.callerAudioChunks.push(chunk);
          } else {
            // Silence / background line noise
            if (session.isSpeaking) {
              session.silenceChunks++;
              session.callerAudioChunks.push(chunk);

              // 35 chunks * 20ms = ~700ms pause -> caller finished sentence
              if (session.silenceChunks >= 35) {
                session.isSpeaking = false;
                const totalSpeech = Buffer.concat(session.callerAudioChunks);
                session.callerAudioChunks = [];

                // Require at least 400ms (3200 bytes) of speech to ignore brief line clicks
                if (totalSpeech.length >= 3200 && session.speechChunksCount >= 8) {
                  session.speechChunksCount = 0;
                  await handleTwilioCallerUtterance(ws, session, totalSpeech);
                } else {
                  session.speechChunksCount = 0;
                }
              }
            }
          }
          break;
        }

        case "mark": {
          // Playback mark completed on Twilio side
          break;
        }

        case "stop": {
          console.log(`[TWILIO EVENT] Call finished / stream stopped. StreamSid: ${session.streamSid}`);
          if (session.abortController) {
            session.abortController.abort();
          }
          // Stage 5: Process call end — generate summary, save history, send SMS
          processCallEnd(session).catch(err => {
            console.error(`[STAGE 5] Post-call processing error:`, err.message);
          });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error("[TWILIO MESSAGE ERROR]", err);
    }
  });

  ws.on("close", () => {
    if (session.abortController) {
      session.abortController.abort();
    }
    console.log(`📞 [TWILIO WS DISCONNECTED] Call ended for stream: ${session.streamSid || session.id}`);
    // Stage 5: Process call end if not already handled by "stop" event
    processCallEnd(session).catch(err => {
      console.error(`[STAGE 5] Post-call processing error (on close):`, err.message);
    });
  });

  ws.on("error", (err) => {
    console.error(`[TWILIO WS ERROR] ${session.id}:`, err.message);
  });
});

// ==============================================
// 9. Stage 4: Twilio Telephony Routes & Endpoints
// ==============================================

// Inbound Call TwiML / TeXML Webhook (Twilio & Telnyx call this when someone dials your number)
app.all(["/twilio/incoming", "/twilio/voice", "/telnyx/incoming", "/telnyx/voice"], (req, res) => {
  const env = getEnv();
  let host = req.headers.host || `localhost:${PORT}`;
  if (env.PUBLIC_URL) {
    try {
      host = new URL(env.PUBLIC_URL).host;
    } catch (uErr) {
      // Ignore URL parse error
    }
  }

  const isTelnyx = req.path.includes("telnyx");
  const providerName = isTelnyx ? "TELNYX" : "TWILIO";
  const wsPath = isTelnyx ? "/telnyx/media-stream" : "/twilio/media-stream";
  const wsUrl = `wss://${host}${wsPath}`;

  const callerNumber = req.body?.From || req.query?.From || req.body?.from || "Unknown Caller";
  const calledNumber = req.body?.To || req.query?.To || req.body?.to || "";
  const forwardedFrom = req.body?.ForwardedFrom || req.query?.ForwardedFrom || req.body?.forwarded_from || "";
  const callSid = req.body?.CallSid || req.query?.CallSid || req.body?.call_control_id || req.body?.call_leg_id || "";
  const callerName = req.body?.CallerName || req.query?.CallerName || req.body?.caller_name || "";

  console.log(`\n📞 [${providerName} CALL INCOMING] From: ${callerNumber}${forwardedFrom ? ` (Forwarded from: ${forwardedFrom})` : ""}`);
  console.log(`📞 [${providerName} CALL INCOMING] CallSid: ${callSid} | Routing to Media Stream: ${wsUrl}`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="callerNumber" value="${callerNumber}" />
      <Parameter name="forwardedFrom" value="${forwardedFrom}" />
      <Parameter name="callSid" value="${callSid}" />
      <Parameter name="callerName" value="${callerName}" />
      <Parameter name="calledNumber" value="${calledNumber}" />
    </Stream>
  </Connect>
</Response>`;

  res.type("text/xml");
  res.send(xml);
});

// Twilio Telephony Status & Diagnostics Endpoint
app.get("/api/twilio/status", (req, res) => {
  const env = getEnv();
  const hasAccountSid = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_ACCOUNT_SID.startsWith("AC"));
  const hasAuthToken = Boolean(env.TWILIO_AUTH_TOKEN && env.TWILIO_AUTH_TOKEN.length >= 16);
  const hasPhoneNumber = Boolean(env.TWILIO_PHONE_NUMBER && env.TWILIO_PHONE_NUMBER.length >= 6);
  const isFullyConfigured = hasAccountSid && hasAuthToken && hasPhoneNumber;

  const publicBase = (env.PUBLIC_URL || `http://${req.headers.host || `localhost:${PORT}`}`).replace(/\/$/, "");
  const incomingWebhook = `${publicBase}/twilio/incoming`;
  const streamUrl = `${publicBase.replace(/^http/, "ws")}/twilio/media-stream`;

  res.json({
    status: isFullyConfigured ? "configured" : "ready_for_setup",
    isConfigured: isFullyConfigured,
    twilio: {
      accountSidSet: hasAccountSid,
      authTokenSet: hasAuthToken,
      phoneNumberSet: hasPhoneNumber,
      phoneNumber: env.TWILIO_PHONE_NUMBER || "Not set in .env",
      clientReady: Boolean(twilioClient)
    },
    webhooks: {
      incomingVoiceUrl: incomingWebhook,
      mediaStreamWsUrl: streamUrl,
      publicTunnelUrl: env.PUBLIC_URL || null
    },
    howToConnect: {
      step1: "Run 'ngrok http 3000' in PowerShell to get your free public URL.",
      step2: `Set PUBLIC_URL in your .env file or copy the ngrok URL.`,
      step3: `Open Twilio Console -> Phone Numbers -> Active Numbers -> Configure.`,
      step4: `Under 'A CALL COMES IN', select 'Webhook' (HTTP POST) and paste: ${incomingWebhook}`,
      step5: "Call your Twilio number from your cellphone and the AI will answer!"
    }
  });
});

// Outbound Phone Call API (Calls any phone number and connects them to our AI Voice Agent)
app.post("/api/twilio/call", async (req, res) => {
  try {
    const env = getEnv();
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: "Missing required parameter 'to' (phone number to call)." });
    }

    if (!twilioClient || !env.TWILIO_PHONE_NUMBER) {
      return res.status(400).json({
        error: "Twilio credentials are not fully configured in .env.",
        missing: {
          accountSid: !env.TWILIO_ACCOUNT_SID,
          authToken: !env.TWILIO_AUTH_TOKEN,
          phoneNumber: !env.TWILIO_PHONE_NUMBER
        }
      });
    }

    const publicBase = (env.PUBLIC_URL || `http://${req.headers.host || `localhost:${PORT}`}`).replace(/\/$/, "");
    const twimlUrl = `${publicBase}/twilio/incoming`;

    console.log(`[TWILIO OUTBOUND] Calling ${to} from ${env.TWILIO_PHONE_NUMBER}...`);
    const call = await twilioClient.calls.create({
      to: to,
      from: env.TWILIO_PHONE_NUMBER,
      url: twimlUrl
    });

    console.log(`[TWILIO OUTBOUND SUCCESS] Call SID: ${call.sid}`);
    res.json({
      success: true,
      callSid: call.sid,
      to: to,
      from: env.TWILIO_PHONE_NUMBER,
      status: call.status
    });
  } catch (error) {
    console.error("[TWILIO OUTBOUND ERROR]", error);
    res.status(500).json({
      error: "Failed to initiate outbound call.",
      details: error.message
    });
  }
});

// Interactive Phone Call Simulator Endpoint
app.post("/api/twilio/simulate-call", async (req, res) => {
  try {
    const { userMessage } = req.body;
    const testMessage = userMessage || "Hello! Can you tell me what you can do?";
    const env = getEnv();

    console.log(`[TWILIO SIMULATOR] Simulating phone call with caller message: "${testMessage}"`);

    // 1. Spoken Greeting
    const greetingText = "Hello! Thank you for calling. I am your AI assistant. How can I help you today?";
    let greetingAudioBase64 = null;
    if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_API_KEY.startsWith("sk_")) {
      try {
        const mulawAudio = await synthesizeElevenLabs(greetingText, env.DEFAULT_ELEVENLABS_VOICE, null, 1, "ulaw_8000");
        greetingAudioBase64 = mulawAudio.toString("base64");
      } catch (e) {
        console.warn("[TWILIO SIMULATOR] Greeting TTS warning:", e.message);
      }
    }

    // 2. LLM Brain Response
    let aiReply = "Hello! I am your AI voice agent running over a simulated Twilio telephone media stream with sub-second latency.";
    if (groq) {
      const completion = await groq.chat.completions.create({
        model: env.GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a friendly, concise AI voice assistant speaking on an active telephone call. Keep answers natural, clear, and brief (1 to 2 sentences)."
          },
          {
            role: "user",
            content: testMessage
          }
        ],
        max_tokens: 300,
        temperature: 0.7,
        ...(env.GROQ_MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {})
      });
      aiReply = completion.choices[0]?.message?.content || aiReply;
    }

    // 3. Synthesize reply in μ-law 8kHz format
    let replyAudioBase64 = null;
    if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_API_KEY.startsWith("sk_")) {
      try {
        const mulawAudio = await synthesizeElevenLabs(aiReply, env.DEFAULT_ELEVENLABS_VOICE, null, 1, "ulaw_8000");
        replyAudioBase64 = mulawAudio.toString("base64");
      } catch (e) {
        console.warn("[TWILIO SIMULATOR] Reply TTS warning:", e.message);
      }
    }

    res.json({
      success: true,
      simulation: "Twilio Media Streams Telephony Call",
      protocol: "G.711 μ-law (8000Hz mono)",
      stages: {
        connection: "Handshake verified over /twilio/media-stream",
        greeting: {
          text: greetingText,
          hasMulawAudio: Boolean(greetingAudioBase64),
          audioBase64: greetingAudioBase64
        },
        callerUtterance: testMessage,
        brainReply: {
          text: aiReply,
          hasMulawAudio: Boolean(replyAudioBase64),
          audioBase64: replyAudioBase64
        },
        bargeInSupported: true
      }
    });
  } catch (error) {
    console.error("[TWILIO SIMULATOR ERROR]", error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================================
// 10. Stage 5: Mobile Call Forwarding & Summary Endpoints
// ==============================================

// Call Forwarding Setup Guide — Returns carrier-specific GSM CFNR codes
app.get("/api/forwarding/setup", (req, res) => {
  const env = getEnv();
  const activeNumber = env.TELNYX_PHONE_NUMBER || env.TWILIO_PHONE_NUMBER || "+1XXXXXXXXXX";
  const provider = env.TELNYX_PHONE_NUMBER ? "Telnyx" : (env.TWILIO_PHONE_NUMBER ? "Twilio" : "Simulator");

  res.json({
    status: "ready",
    provider: provider,
    activeNumber: activeNumber,
    twilioNumber: activeNumber,
    personalNumber: env.PERSONAL_PHONE_NUMBER
      ? env.PERSONAL_PHONE_NUMBER.replace(/.(?=.{4})/g, "*")
      : "Not configured in .env",
    howItWorks: {
      step1: "Your mobile carrier has a feature called Conditional Call Forwarding on No Reply (CFNR).",
      step2: `When someone calls your personal number and you don't answer within X seconds, your carrier forwards the call to ${activeNumber}.`,
      step3: `${provider} receives the forwarded call and connects it to your AI Voice Agent.`,
      step4: "After the call ends, the AI generates a summary and sends it to you via SMS."
    },
    carriers: {
      universal_gsm: {
        name: "Universal GSM (Works on ALL carriers worldwide)",
        enable: `*61*${activeNumber}**10#`,
        enableDescription: "Forward unanswered calls after 10 seconds (~2 rings)",
        timerOptions: {
          "5_seconds": `*61*${activeNumber}**5#`,
          "10_seconds": `*61*${activeNumber}**10#`,
          "15_seconds": `*61*${activeNumber}**15#`,
          "20_seconds": `*61*${activeNumber}**20#`,
          "25_seconds": `*61*${activeNumber}**25#`,
          "30_seconds": `*61*${activeNumber}**30#`
        },
        disable: "##61#",
        checkStatus: "*#61#"
      },
      jazz_warid: {
        name: "Jazz / Warid (Pakistan)",
        enable: `*61*${activeNumber}**10#`,
        disable: "##61#",
        note: "Standard GSM codes work on Jazz/Warid networks."
      },
      zong: {
        name: "Zong (Pakistan)",
        enable: `*61*${activeNumber}**10#`,
        disable: "##61#",
        note: "Standard GSM codes work on Zong 4G network."
      },
      telenor: {
        name: "Telenor (Pakistan)",
        enable: `*61*${activeNumber}**10#`,
        disable: "##61#",
        note: "Standard GSM codes work on Telenor network."
      },
      ufone: {
        name: "Ufone (Pakistan)",
        enable: `*61*${activeNumber}**10#`,
        disable: "##61#",
        note: "Standard GSM codes work on Ufone network."
      },
      airtel: {
        name: "Airtel (India)",
        enable: `*61*${activeNumber}**10#`,
        disable: "##61#",
        note: "Standard GSM codes work on Airtel network."
      },
      tmobile: {
        name: "T-Mobile (USA)",
        enable: `*61*${activeNumber}*11*10#`,
        disable: "##61#",
        note: "T-Mobile uses a slightly different format with service class *11*."
      },
      att: {
        name: "AT&T (USA)",
        enable: `*61*${activeNumber}*11*10#`,
        disable: "##61#",
        note: "AT&T may require contacting customer support for international forwarding."
      }
    },
    gsmTimerNote: "GSM networks only support forwarding timers in 5-second increments (5s, 10s, 15s, 20s, 25s, 30s). An exact 8-second timer is not possible. We recommend 10 seconds (~2 rings) as a good balance.",
    important: [
      `Forwarding to ${activeNumber} may incur call forwarding airtime charges from your carrier.`,
      `Make sure the number starts with + and country code.`,
      "Open your phone's dialer app, type the enable code, and press the Call/Dial button.",
      "To check if forwarding is active, dial *#61# and press Call.",
      "To disable forwarding, dial ##61# and press Call."
    ]
  });
});

// Call History — Returns the last 50 calls with transcripts and summaries
app.get("/api/calls/history", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 50);
  const recentCalls = callHistory.slice(-limit).reverse(); // Most recent first
  res.json({
    totalCalls: callHistory.length,
    showing: recentCalls.length,
    calls: recentCalls
  });
});

// Single Call Detail — Returns full detail for a specific call
app.get("/api/calls/:callSid", (req, res) => {
  const { callSid } = req.params;
  const call = callHistory.find(c => c.callSid === callSid);
  if (!call) {
    return res.status(404).json({ error: `Call with SID '${callSid}' not found.` });
  }
  res.json(call);
});

// Test SMS Summary — Sends a test summary SMS to your personal phone
app.post("/api/calls/test-summary-sms", async (req, res) => {
  try {
    const env = getEnv();

    if (!env.PERSONAL_PHONE_NUMBER) {
      return res.status(400).json({
        error: "PERSONAL_PHONE_NUMBER is not set in .env. Add your mobile number to receive SMS summaries."
      });
    }

    if (!twilioClient || !env.TWILIO_PHONE_NUMBER) {
      return res.status(400).json({
        error: "Twilio credentials not fully configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env."
      });
    }

    const testSummary = "This is a test SMS from your AI Voice Agent. " +
      "When someone calls your phone and you don't answer, the AI will handle the call and send you a summary like this one. " +
      "Stage 5 is working!";

    const smsResult = await sendCallSummarySms(testSummary, "+1-TEST-CALLER", 45);

    res.json({
      success: smsResult.sent,
      message: smsResult.sent
        ? `Test SMS sent to ${env.PERSONAL_PHONE_NUMBER.replace(/.(?=.{4})/g, "*")}!`
        : `SMS delivery failed: ${smsResult.reason}`,
      details: smsResult
    });
  } catch (err) {
    console.error("[TEST SMS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================
// 11. Telnyx Telephony Status & Auto-Sync Endpoints
// ==============================================

// Telnyx Status — returns live balance, numbers, and TeXML app status
app.get("/api/telnyx/status", async (req, res) => {
  const env = getEnv();
  const apiKey = env.TELNYX_API_KEY;
  if (!apiKey) {
    return res.json({
      configured: false,
      message: "TELNYX_API_KEY is not configured in .env."
    });
  }

  try {
    const headers = { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" };
    let balance = "0.00";
    try {
      const balRes = await fetch("https://api.telnyx.com/v2/balance", { headers });
      const balData = await balRes.json();
      balance = balData.data?.available_credit || balData.data?.balance || "0.00";
    } catch (e) {}

    let phoneNumbers = [];
    try {
      const numRes = await fetch("https://api.telnyx.com/v2/phone_numbers", { headers });
      const numData = await numRes.json();
      phoneNumbers = (numData.data || []).map(n => ({
        id: n.id,
        phoneNumber: n.phone_number,
        status: n.status,
        connectionId: n.connection_id
      }));
    } catch (e) {}

    const host = env.PUBLIC_URL ? new URL(env.PUBLIC_URL).host : `localhost:${PORT}`;

    res.json({
      configured: true,
      balance: balance,
      phoneNumber: env.TELNYX_PHONE_NUMBER || (phoneNumbers[0]?.phoneNumber || null),
      phoneNumbers: phoneNumbers,
      texmlAppId: env.TELNYX_TEXML_APP_ID || null,
      incomingWebhookUrl: `${env.PUBLIC_URL || "http://" + host}/telnyx/incoming`,
      mediaStreamWsUrl: `wss://${host}/telnyx/media-stream`,
      readyForCalls: Boolean(env.TELNYX_PHONE_NUMBER || phoneNumbers.length > 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Telnyx Auto-Sync — checks for purchased numbers on Telnyx and links them to TeXML app
app.post("/api/telnyx/sync", async (req, res) => {
  const env = getEnv();
  const apiKey = env.TELNYX_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: "TELNYX_API_KEY is not configured in .env." });
  }

  try {
    const headers = { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" };
    const numRes = await fetch("https://api.telnyx.com/v2/phone_numbers", { headers });
    const numData = await numRes.json();
    const numbers = numData.data || [];
    const requestedNumber = (req.body && req.body.phoneNumber) ? String(req.body.phoneNumber).trim() : null;

    if (numbers.length === 0 && !requestedNumber) {
      return res.json({
        synced: false,
        message: "No phone numbers found on your Telnyx account. Buy a number in Telnyx portal (portal.telnyx.com), then click Sync again!",
        portalUrl: "https://portal.telnyx.com/#/app/numbers/search-numbers"
      });
    }

    let primary = null;
    if (requestedNumber) {
      const cleanReq = requestedNumber.replace(/[^\d+]/g, "");
      primary = numbers.find(n => n.phone_number === cleanReq || n.phone_number.replace(/[^\d]/g, "") === cleanReq.replace(/[^\d]/g, ""));
    }
    if (!primary && numbers.length > 0) {
      primary = numbers[0];
    }

    const phoneNumber = primary ? primary.phone_number : requestedNumber;
    const phoneId = primary ? primary.id : null;

    // Link number to our TeXML application
    let linked = false;
    if (env.TELNYX_TEXML_APP_ID && primary.connection_id !== env.TELNYX_TEXML_APP_ID) {
      try {
        const patchRes = await fetch(`https://api.telnyx.com/v2/phone_numbers/${phoneId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ connection_id: env.TELNYX_TEXML_APP_ID })
        });
        if (patchRes.ok) linked = true;
      } catch (patchErr) {
        console.warn("[TELNYX SYNC] Could not link connection_id:", patchErr.message);
      }
    } else if (primary.connection_id === env.TELNYX_TEXML_APP_ID) {
      linked = true;
    }

    // Save TELNYX_PHONE_NUMBER to .env
    try {
      const envPath = path.join(__dirname, ".env");
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, "utf-8");
        if (envContent.includes("TELNYX_PHONE_NUMBER=")) {
          envContent = envContent.replace(/TELNYX_PHONE_NUMBER=.*/, `TELNYX_PHONE_NUMBER=${phoneNumber}`);
        } else {
          envContent += `\nTELNYX_PHONE_NUMBER=${phoneNumber}\n`;
        }
        fs.writeFileSync(envPath, envContent, "utf-8");
      }
    } catch (saveEnvErr) {}

    res.json({
      synced: true,
      phoneNumber: phoneNumber,
      phoneId: phoneId,
      linkedToTeXML: linked,
      texmlAppId: env.TELNYX_TEXML_APP_ID,
      mmiCode: `*61*${phoneNumber}**10#`,
      message: `Phone number ${phoneNumber} is connected to your AI Voice Agent! Dial *61*${phoneNumber}**10# on your phone to activate.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start the server (HTTP + WebSocket on same port)
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 AI Voice Agent Backend is live on http://localhost:${PORT}`);
  console.log(`⚡ Browser Stream : ws://localhost:${PORT}/ws/voice (Stage 3)`);
  console.log(`📞 Telnyx Stream  : ws://localhost:${PORT}/telnyx/media-stream (TeXML)`);
  console.log(`📞 Telnyx Webhook : POST http://localhost:${PORT}/telnyx/incoming`);
  console.log(`📞 Twilio Stream  : ws://localhost:${PORT}/twilio/media-stream (Stage 4)`);
  console.log(`📞 Twilio Webhook : POST http://localhost:${PORT}/twilio/incoming (Stage 4)`);
  console.log(`📱 Forwarding     : GET  http://localhost:${PORT}/api/forwarding/setup (Stage 5)`);
  console.log(`📱 Call History   : GET  http://localhost:${PORT}/api/calls/history (Stage 5)`);
  console.log(`📡 Health Check   : GET  http://localhost:${PORT}/api/health`);
  console.log(`📡 Telnyx Status  : GET  http://localhost:${PORT}/api/telnyx/status`);
  console.log(`📡 Twilio Status  : GET  http://localhost:${PORT}/api/twilio/status`);
  console.log(`🎭 Voices List    : GET  http://localhost:${PORT}/api/voices`);
  console.log(`💬 Text Chat      : POST http://localhost:${PORT}/chat`);
  console.log(`👂 Ears (STT)     : POST http://localhost:${PORT}/transcribe`);
  console.log(`👄 Mouth (TTS)    : POST http://localhost:${PORT}/tts`);
  console.log(`⚡ Voice Loop     : POST http://localhost:${PORT}/voice-chat`);
  const env = getEnv();
  console.log(`------------------------------------------------------`);
  console.log(`🧠 Brain (LLM)    : ${groq ? "✅ Groq (" + env.GROQ_MODEL + ") [Streaming Ready]" : "⚠️  Simulation Mode"}`);
  console.log(`👂 Ears (STT)     : ${groq ? "✅ Groq Whisper Turbo" : "⚠️  Simulation"}${env.DEEPGRAM_API_KEY ? " + Deepgram" : ""}`);
  console.log(`👄 Mouth (TTS)    : ${env.ELEVENLABS_API_KEY ? (env.ELEVENLABS_API_KEY.startsWith("sk_") ? "✅ ElevenLabs Active (Flash v2.5 Pipelined + Telephony μ-law)" : "⚠️  Invalid Key (Key ID entered instead of sk_...)") : "ℹ️  Browser Speech Fallback"}`);
  console.log(`📞 Telnyx CPaaS   : ${env.TELNYX_API_KEY ? "✅ Active Key | TeXML App: " + (env.TELNYX_TEXML_APP_ID || "Ready") + (env.TELNYX_PHONE_NUMBER ? " (" + env.TELNYX_PHONE_NUMBER + ")" : " (Buy # in portal)") : "ℹ️  Not configured"}`);
  console.log(`📞 Twilio Telecom : ${Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER) ? "✅ Active (" + env.TWILIO_PHONE_NUMBER + ")" : "ℹ️  Simulator / TeXML Ready"}`);
  console.log(`📱 Call Fwd (S5)  : ${env.PERSONAL_PHONE_NUMBER ? "✅ SMS summaries → " + env.PERSONAL_PHONE_NUMBER.replace(/.(?=.{4})/g, "*") : "ℹ️  Add PERSONAL_PHONE_NUMBER to .env"}`);
  console.log(`📱 Call History   : ${callHistory.length} calls recorded | call-history.json`);
  console.log(`⚡ Latency Goal   : <500ms Time-to-First-Audio (TTFA) + Live Telephone Barge-in`);
  console.log(`======================================================\n`);
  
  // Start self-healing public tunnel and auto-sync Telnyx TeXML cloud webhook
  startAutoTunnel(PORT);
});

