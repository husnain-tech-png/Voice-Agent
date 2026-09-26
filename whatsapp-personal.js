/**
 * =========================================================================
 *  WhatsApp Personal AI Voice Agent — Stage 6 ($0 Cost)
 * =========================================================================
 *  Connects to ANY personal WhatsApp number via QR scan. Whoever scans
 *  the QR code from their phone will pair this agent to their account.
 *
 *  Core Capabilities:
 *    1. Incoming Call Interception: Detects WhatsApp calls, silences/rejects
 *       them, and immediately dispatches an authentic AI voice note.
 *    2. Voice-to-Voice Notes (PTT): Downloads incoming voice messages (.ogg),
 *       transcribes via Groq Whisper STT, reasons with Groq LLM, synthesizes
 *       speech with Microsoft Edge-TTS ($0.00), and sends back an Opus voice note.
 *    3. Multi-Turn Conversation Memory: Keeps context per contact.
 *    4. Web QR & Health Server (Port 3005): Scan QR from terminal OR browser.
 *    5. Call History Sync: Persists transcripts & summaries to call-history.json.
 *    6. Pakistan-focused: Supports Urdu and English voice interactions.
 * =========================================================================
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import Groq, { toFile } from "groq-sdk";
import { synthesizeToWhatsAppOpus } from "./edge-tts-helper.js";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ───────────────────────────────────────────────────────────
const GROQ_API_KEY = (process.env.GROQ_API_KEY || "").trim();
const GROQ_LLM_MODEL = (process.env.GROQ_MODEL || process.env.GROQ_LLM_MODEL || "openai/gpt-oss-120b").trim();
const GROQ_STT_MODEL = "whisper-large-v3-turbo";
const ELEVENLABS_VOICE_ID = (process.env.ELEVENLABS_VOICE_ID || "IKne3meq5aSn9XLyUdCD").trim();
const HTTP_PORT = parseInt(process.env.WHATSAPP_PORT || "3005", 10);
const AUTH_DIR = path.join(__dirname, "auth_baileys");
const CALL_HISTORY_FILE = path.join(__dirname, "call-history.json");
const STATUS_FILE = path.join(__dirname, "whatsapp-status.json");

function getPublicTestUrl() {
  dotenv.config({ override: true });
  return (process.env.PUBLIC_URL || "http://localhost:3000").trim();
}

// Initialize Groq client
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

// ─── State Management ────────────────────────────────────────────────────────
let sock = null;
let currentQrCode = null;           // Raw QR string for terminal
let currentQrDataUrl = null;        // Base64 data URL for web rendering
let connectionState = "disconnected"; // "connecting" | "qr_ready" | "connected" | "disconnected"
let botUser = null;                   // The paired WhatsApp user info
let reconnectAttempt = 0;             // Exponential backoff counter
const MAX_RECONNECT_DELAY = 60000;    // Max 60s between reconnects

const conversationHistory = new Map(); // remoteJid -> array of { role, content }
const lastCallInterceptTime = new Map(); // remoteJid -> timestamp (rate limit)
const activeProcessing = new Set();     // JIDs currently being processed (debounce)

/**
 * Build the system prompt dynamically based on the connected user
 */
function getSystemPrompt() {
  const userName = botUser?.name || "Husnain";
  const userNumber = botUser?.id?.split(":")[0] || "923154483615";

  return `You are Charlie, a polite, warm, articulate, and intelligent male AI voice assistant answering WhatsApp messages and calls on behalf of ${userName} (+${userNumber}).

CRITICAL CONVERSATIONAL & LANGUAGE RULES:
1. NATURAL URDU CONVERSATION (HIGHEST PRIORITY):
   - When the caller speaks, writes, or greets in Urdu or Roman Urdu (e.g. 'Salam', 'Assalam-o-Alaikum', 'kya haal hai', 'kaise ho', 'Husnain kahan hai', 'mujhe kaam tha'):
     - ALWAYS reply in natural, authentic, fluent Pakistani Urdu in Urdu script (e.g. 'وعلیکم السلام! جی میں حسنین کی طرف سے بات کر رہا ہوں۔ وہ اس وقت مصروف ہیں، فرمائیے میں آپ کی کیا مدد کر سکتا ہوں؟').
     - Speak exactly like a polite, educated Pakistani person answering a phone call.
     - NEVER use robotic phrases, literal machine translations, or stiff bookish language. Make it sound completely natural and human.
     - Keep your answer short, clear, and conversational (2 to 3 sentences maximum).
2. NATURAL ENGLISH CONVERSATION:
   - When the caller speaks in English, respond in a natural, polite, and friendly male conversational tone.
3. HANDLING WHERE ${userName} IS:
   - If asked where ${userName} is or why they didn't answer the call, politely explain that they are currently occupied/busy, and you are taking their messages or assisting them right now.
4. ABSOLUTELY NO MARKDOWN OR SPECIAL SYMBOLS:
   - Crucial: NEVER use markdown symbols (no asterisks *, no bullet points -, no emojis in your spoken words, no numbered lists, no URLs) because your response is converted directly into spoken audio voice notes. Speak smoothly and naturally.`;
}

// ─── Status Persistence ──────────────────────────────────────────────────────

function updateStatus(state, extra = {}) {
  connectionState = state;
  const statusData = {
    state,
    connected: state === "connected",
    botUser: botUser ? botUser.id : null,
    userName: botUser?.name || null,
    timestamp: new Date().toISOString(),
    conversationsCount: conversationHistory.size,
    ...extra
  };

  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(statusData, null, 2), "utf-8");
  } catch (err) {
    // Non-critical — just log
    console.warn("[STATUS] Could not write status file:", err.message);
  }
}

// ─── Call History ─────────────────────────────────────────────────────────────

function logCallRecord(record) {
  try {
    let history = [];
    if (fs.existsSync(CALL_HISTORY_FILE)) {
      try {
        const raw = fs.readFileSync(CALL_HISTORY_FILE, "utf-8");
        history = JSON.parse(raw);
        if (!Array.isArray(history)) history = [];
      } catch (_parseErr) {
        history = [];
      }
    }

    history.unshift({
      callSid: `WA_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      callerNumber: record.callerNumber || "unknown",
      channel: "WhatsApp",
      type: record.type || "Call Intercept",
      startTime: record.startTime || new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationSeconds: record.durationSeconds || 0,
      transcript: record.transcript || [],
      summary: record.summary || "WhatsApp interaction handled by AI voice agent.",
      smsSent: false
    });

    if (history.length > 50) history = history.slice(0, 50);
    fs.writeFileSync(CALL_HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
    console.log(`[CALL LOG] Saved record for ${record.callerNumber}`);
  } catch (err) {
    console.error("[CALL LOG ERROR]", err.message);
  }
}

// ─── Conversation Memory ─────────────────────────────────────────────────────

function getHistory(jid) {
  if (!conversationHistory.has(jid)) {
    conversationHistory.set(jid, []);
  }
  return conversationHistory.get(jid);
}

function appendHistory(jid, role, content) {
  const history = getHistory(jid);
  history.push({ role, content });
  // Keep last 16 turns to stay within token limits
  if (history.length > 16) {
    conversationHistory.set(jid, history.slice(-16));
  }
}

// ─── Call Interception Handler ───────────────────────────────────────────────

async function handleCallInterception(call) {
  if (!call || !call.from) {
    console.warn("[CALL] Received call event without 'from' field, skipping.");
    return;
  }

  const callerJid = call.from;
  const callerNumber = callerJid.split("@")[0];

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  CALL INTERCEPTED — Incoming from: +${callerNumber}`);
  console.log(`${"=".repeat(60)}`);

  // Rate-limit: max one auto-response per caller every 2 minutes
  const now = Date.now();
  const lastTime = lastCallInterceptTime.get(callerJid) || 0;
  if (now - lastTime < 120_000) {
    console.log(`[CALL] Rate-limited auto-response for +${callerNumber}`);
    return;
  }
  lastCallInterceptTime.set(callerJid, now);

  const userName = botUser?.name || "Husnain";
  const liveCallUrl = getPublicTestUrl();

  // Natural Urdu & English greeting spoken by Charlie (ElevenLabs)
  const greetingAudioText = `السلام علیکم! آپ نے ${userName} کے اے آئی اسسٹنٹ سے رابطہ کیا ہے۔ وہ اس وقت دستیاب نہیں ہیں۔ آپ اپنا پیغام یہاں وائس میسج میں ریکارڈ کروا سکتے ہیں، میں آپ سے بات کر کے آپ کی مکمل رہنمائی کروں گا، یا فوری لائیو کال کے لیے لنک پر ٹیپ کریں۔ Hello! You have reached ${userName}'s AI voice assistant. He is currently unavailable. Please leave a voice note here to talk to me, or tap the link to join a live call.`;

  try {
    console.log(`[TTS] Synthesizing call-interception voice note with Charlie voice (${ELEVENLABS_VOICE_ID})...`);
    const oggBuffer = await synthesizeToWhatsAppOpus(greetingAudioText, ELEVENLABS_VOICE_ID);

    // Send native WhatsApp Voice Note (PTT) with Charlie's voice
    await sock.sendMessage(callerJid, {
      audio: oggBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true
    });

    // Send companion text message with 1-tap live call link
    const companionText = `📞 *${userName}'s AI Voice Assistant*\n\nالسلام علیکم! ${userName} اس وقت دستیاب نہیں ہیں۔\n\n🎙️ *آپ مجھ سے 2 طریقوں سے بات کر سکتے ہیں:*\n1️⃣ *وائس میسج:* یہیں چیٹ میں مائیک کا بٹن دبا کر اپنا وائس میسج بھیجیں — میں فوراً سن کر آپ کو جواب دوں گا۔\n2️⃣ *براہِ راست لائیو فون کال (Live Call):* نیچے دیے گئے لنک پر ٹیپ کریں اور براہِ راست لائیو فون کال کی طرح مجھ سے بات کریں:\n👉 ${liveCallUrl}\n\n_(Reply with a voice note here, or tap the link above to talk on a live voice call.)_`;

    await sock.sendMessage(callerJid, {
      text: companionText
    });

    console.log(`[CALL] Voice note and live call link delivered to +${callerNumber}`);

    logCallRecord({
      callerNumber: `+${callerNumber}`,
      type: "WhatsApp Call (Auto-Intercepted)",
      transcript: [
        { role: "system", text: "Incoming WhatsApp call intercepted." },
        { role: "assistant", text: greetingAudioText }
      ],
      summary: `Call from +${callerNumber} intercepted. Delivered Charlie Urdu/English voice note & live call studio link.`
    });
  } catch (err) {
    console.error(`[CALL ERROR] Failed to send voice note to +${callerNumber}:`, err.message);
  }
}

// ─── Message Handler ─────────────────────────────────────────────────────────

async function handleIncomingMessage(msg) {
  // Defensive null checks
  if (!msg || !msg.key || !msg.key.remoteJid) return;

  const jid = msg.key.remoteJid;

  // Skip: group chats, broadcast, status updates, own messages
  if (
    jid.endsWith("@g.us") ||
    jid.endsWith("@broadcast") ||
    jid === "status@broadcast" ||
    msg.key.fromMe
  ) {
    return;
  }

  // Skip if no message payload
  if (!msg.message) return;

  // Debounce: prevent duplicate processing if a message arrives while we're still replying
  if (activeProcessing.has(jid)) {
    console.log(`[MSG] Already processing a message for ${jid}, queuing...`);
    return;
  }

  activeProcessing.add(jid);

  try {
    await _processMessage(msg, jid);
  } catch (err) {
    console.error(`[MSG ERROR] Unhandled error for ${jid}:`, err.message);
  } finally {
    activeProcessing.delete(jid);
  }
}

async function _processMessage(msg, jid) {
  const senderNumber = jid.split("@")[0];

  // Determine message type safely
  const messageKeys = Object.keys(msg.message || {});
  // Filter out protocol-level keys
  const contentKey = messageKeys.find(k =>
    ["audioMessage", "conversation", "extendedTextMessage", "imageMessage", "videoMessage", "documentMessage", "stickerMessage"].includes(k)
  );

  let userText = "";
  let isAudio = false;

  // ── Audio / Voice Note ──────────────────────────────────────────────────
  if (contentKey === "audioMessage") {
    isAudio = true;
    console.log(`\n[VOICE] Incoming voice note from +${senderNumber}`);

    if (!groq) {
      console.error("[VOICE] Groq API key not configured — cannot transcribe.");
      await safeSendText(jid, "I'm sorry, I cannot process voice notes right now. Please type your message instead.");
      return;
    }

    try {
      console.log(`[VOICE] Downloading audio buffer...`);
      const buffer = await downloadMediaMessage(
        msg,
        "buffer",
        {},
        { logger: pino({ level: "silent" }) }
      );

      if (!buffer || buffer.length === 0) {
        console.warn(`[VOICE] Empty audio buffer from +${senderNumber}`);
        return;
      }

      console.log(`[STT] Transcribing via Groq Whisper (${buffer.length} bytes)...`);
      const audioFile = await toFile(buffer, "voice.ogg", { type: "audio/ogg" });
      const transcription = await groq.audio.transcriptions.create({
        file: audioFile,
        model: GROQ_STT_MODEL,
        prompt: "Urdu and English speech. السلام علیکم، میں حسنین سے بات کرنا چاہتا ہوں، کیا حال ہے، سب خیریت ہے۔"
      });

      userText = (transcription.text || "").trim();
      console.log(`[STT] Result: "${userText}"`);

      if (!userText) {
        await safeSendText(jid, "معذرت، میں آپ کا وائس میسج واضح طور پر نہیں سن سکا۔ برائے مہربانی دوبارہ بھیجیں یا ٹیکسٹ میسج کریں۔");
        return;
      }
    } catch (sttErr) {
      console.error(`[STT ERROR]`, sttErr.message);
      await safeSendText(jid, "معذرت، وائس میسج پراسیس کرنے میں دشواری پیش آئی۔ برائے مہربانی دوبارہ بھیجیں یا لکھ کر میسج کریں۔");
      return;
    }

  // ── Text Message ────────────────────────────────────────────────────────
  } else if (contentKey === "conversation" || contentKey === "extendedTextMessage") {
    userText = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      ""
    ).trim();

    if (!userText) return;
    console.log(`\n[TEXT] From +${senderNumber}: "${userText}"`);

  // ── Unsupported media (images, stickers, etc.) — ignore silently ──────
  } else {
    return;
  }

  if (!userText) return;

  // Append user message to conversation memory
  appendHistory(jid, "user", userText);

  // ── LLM Response ──────────────────────────────────────────────────────
  let aiReplyText = "";
  try {
    if (!groq) throw new Error("Groq API not configured");

    console.log(`[LLM] Generating response (${GROQ_LLM_MODEL})...`);
    const history = getHistory(jid);
    const messages = [
      { role: "system", content: getSystemPrompt() },
      ...history
    ];

    const completion = await groq.chat.completions.create({
      model: GROQ_LLM_MODEL,
      messages,
      max_tokens: 300,
      temperature: 0.6,
      ...(GROQ_LLM_MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {})
    });

    aiReplyText = (completion.choices?.[0]?.message?.content || "").trim();

    if (!aiReplyText) {
      aiReplyText = "وعلیکم السلام! میں نے آپ کا پیغام نوٹ کر لیا ہے، میں حسنین کو مطلع کر دوں گا۔";
    }

    console.log(`[LLM] Response: "${aiReplyText}"`);
    appendHistory(jid, "assistant", aiReplyText);
  } catch (llmErr) {
    console.error(`[LLM ERROR]`, llmErr.message);
    aiReplyText = "معذرت، اس وقت رابطہ میں تاخیر ہو رہی ہے۔ میں نے آپ کا پیغام نوٹ کر لیا ہے۔";
  }

  // ── TTS Synthesis & Send Voice Note ───────────────────────────────────
  try {
    console.log(`[TTS] Synthesizing reply with ElevenLabs Charlie (${ELEVENLABS_VOICE_ID})...`);
    const oggBuffer = await synthesizeToWhatsAppOpus(aiReplyText, ELEVENLABS_VOICE_ID);

    await sock.sendMessage(
      jid,
      {
        audio: oggBuffer,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true
      },
      { quoted: msg }
    );

    console.log(`[SENT] Voice note delivered to +${senderNumber}`);

    logCallRecord({
      callerNumber: `+${senderNumber}`,
      type: isAudio ? "WhatsApp Voice Note Exchange" : "WhatsApp Chat Exchange",
      transcript: [
        { role: "user", text: userText },
        { role: "assistant", text: aiReplyText }
      ],
      summary: `User: "${userText}". AI: "${aiReplyText}".`
    });
  } catch (ttsErr) {
    console.error(`[TTS ERROR]`, ttsErr.message);
    // Fallback: send as text message if voice synthesis fails
    await safeSendText(jid, aiReplyText, msg);
  }
}

/**
 * Safe text sender — won't crash if socket is dead
 */
async function safeSendText(jid, text, quotedMsg = null) {
  try {
    const opts = quotedMsg ? { quoted: quotedMsg } : {};
    await sock.sendMessage(jid, { text }, opts);
  } catch (err) {
    console.error(`[SEND ERROR] Could not send text to ${jid}:`, err.message);
  }
}

// ─── Baileys Socket Initialization ───────────────────────────────────────────

async function startWhatsAppBot() {
  updateStatus("connecting");

  console.log(`\n${"=".repeat(60)}`);
  console.log("  WhatsApp AI Voice Agent — Starting...");
  console.log(`${"=".repeat(60)}\n`);

  // Ensure auth directory exists
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  let state, saveCreds;
  try {
    ({ state, saveCreds } = await useMultiFileAuthState(AUTH_DIR));
  } catch (authErr) {
    console.error("[AUTH ERROR] Failed to load auth state:", authErr.message);
    console.log("[AUTH] Clearing corrupted auth data and retrying...");
    try {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      ({ state, saveCreds } = await useMultiFileAuthState(AUTH_DIR));
    } catch (retryErr) {
      console.error("[AUTH FATAL] Cannot initialize auth:", retryErr.message);
      process.exit(1);
    }
  }

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (_) {
    version = [2, 3000, 1015901307]; // Fallback version
  }

  console.log(`[BAILEYS] WhatsApp Web version: ${version.join(".")}`);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["VoiceAgent-AI", "Chrome", "1.0.0"],
    syncFullHistory: false,
    connectTimeoutMs: 30_000,
    defaultQueryTimeoutMs: 60_000
  });

  sock.ev.on("creds.update", saveCreds);

  // ── Connection Updates & QR ─────────────────────────────────────────────
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQrCode = qr;
      reconnectAttempt = 0; // Reset backoff on new QR

      // Generate data URL for the web UI
      try {
        currentQrDataUrl = await QRCode.toDataURL(qr, {
          width: 320,
          margin: 2,
          color: { dark: "#e2e8f0", light: "#0f172a" }
        });
      } catch (qrErr) {
        console.warn("[QR] Could not generate QR data URL:", qrErr.message);
        currentQrDataUrl = null;
      }

      updateStatus("qr_ready", { qr });

      console.log("\n  Scan this QR Code with WhatsApp:");
      console.log("  1. Open WhatsApp on your phone");
      console.log("  2. Go to Settings > Linked Devices");
      console.log("  3. Tap 'Link a Device' and scan:\n");
      qrcodeTerminal.generate(qr, { small: true });
      console.log(`\n  Or open: http://localhost:${HTTP_PORT}/qr\n`);
    }

    if (connection === "open") {
      botUser = sock.user;
      currentQrCode = null;
      currentQrDataUrl = null;
      reconnectAttempt = 0;
      updateStatus("connected", { user: botUser });

      const userName = botUser?.name || "Unknown";
      const userNum = botUser?.id?.split(":")[0] || "N/A";

      console.log(`\n${"=".repeat(60)}`);
      console.log(`  CONNECTED — WhatsApp AI Voice Agent Online`);
      console.log(`  User: ${userName} (+${userNum})`);
      console.log(`  Listening for calls & voice notes 24/7...`);
      console.log(`${"=".repeat(60)}\n`);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      updateStatus("disconnected", { statusCode, shouldReconnect });

      if (shouldReconnect) {
        // Exponential backoff: 3s, 6s, 12s, 24s, ... up to 60s
        reconnectAttempt++;
        const delay = Math.min(3000 * Math.pow(2, reconnectAttempt - 1), MAX_RECONNECT_DELAY);
        console.log(`[RECONNECT] Connection closed (code: ${statusCode}). Retrying in ${delay / 1000}s...`);
        setTimeout(startWhatsAppBot, delay);
      } else {
        console.log("[DISCONNECTED] Logged out from WhatsApp.");
        console.log("[DISCONNECTED] Delete the 'auth_baileys' folder and restart to pair a new number.");
        currentQrCode = null;
        currentQrDataUrl = null;
        botUser = null;
      }
    }
  });

  // ── Call Interception ───────────────────────────────────────────────────
  sock.ev.on("call", async (calls) => {
    if (!Array.isArray(calls)) return;

    for (const call of calls) {
      try {
        if (call && call.status === "offer" && call.from) {
          await sock.rejectCall(call.id, call.from).catch(() => {});
          await handleCallInterception(call);
        }
      } catch (callErr) {
        console.error("[CALL ERROR]", callErr.message);
      }
    }
  });

  // ── Message Reception ─────────────────────────────────────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    if (!Array.isArray(messages)) return;

    for (const msg of messages) {
      try {
        await handleIncomingMessage(msg);
      } catch (msgErr) {
        console.error("[MSG HANDLER ERROR]", msgErr.message);
      }
    }
  });
}

// ─── Web Server (QR + Status) ────────────────────────────────────────────────

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ── JSON Status Endpoint ──────────────────────────────────────────────
  if (url.pathname === "/status") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    });
    return res.end(JSON.stringify({
      status: connectionState,
      connected: connectionState === "connected",
      user: botUser ? { id: botUser.id, name: botUser.name } : null,
      activeConversations: conversationHistory.size
    }));
  }

  // ── Logout / Reset Endpoint ───────────────────────────────────────────
  if (url.pathname === "/logout") {
    try {
      sock?.logout?.().catch(() => {});
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      botUser = null;
      currentQrCode = null;
      currentQrDataUrl = null;
      connectionState = "disconnected";
      updateStatus("disconnected", { reason: "manual_logout" });

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, message: "Logged out. Restart the agent to pair a new number." }));

      // Restart to get a fresh QR
      setTimeout(() => {
        console.log("[LOGOUT] Restarting for fresh QR...");
        startWhatsAppBot().catch(console.error);
      }, 2000);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // ── QR Page / Landing Page ────────────────────────────────────────────
  if (url.pathname === "/qr" || url.pathname === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store"
    });

    const isConnected = connectionState === "connected";
    const userName = botUser?.name || "Unknown";
    const userNum = botUser?.id?.split(":")[0] || "";

    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Voice Agent</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0a0a0f;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: linear-gradient(145deg, #12121a 0%, #1a1a2e 100%);
      border: 1px solid rgba(99, 102, 241, 0.15);
      border-radius: 20px;
      padding: 36px;
      max-width: 460px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(99, 102, 241, 0.05);
    }
    .logo { font-size: 2.4rem; margin-bottom: 8px; }
    h1 {
      font-size: 1.35rem;
      font-weight: 700;
      background: linear-gradient(135deg, #818cf8, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 6px;
    }
    .subtitle { color: #94a3b8; font-size: 0.88rem; margin-bottom: 24px; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 0.82rem;
      margin-bottom: 20px;
    }
    .badge-connected {
      background: rgba(16, 185, 129, 0.12);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-waiting {
      background: rgba(245, 158, 11, 0.12);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .badge-connected .badge-dot { background: #34d399; box-shadow: 0 0 8px #34d399; }
    .badge-waiting .badge-dot { background: #fbbf24; animation: pulse 2s infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .qr-container {
      background: #0f172a;
      border-radius: 14px;
      padding: 20px;
      margin: 16px auto;
      display: inline-block;
    }
    .qr-container img {
      width: 280px;
      height: 280px;
      border-radius: 8px;
    }
    .steps {
      text-align: left;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(51, 65, 85, 0.4);
      padding: 16px 20px;
      border-radius: 12px;
      font-size: 0.82rem;
      color: #cbd5e1;
      line-height: 1.7;
      margin-top: 16px;
    }
    .steps strong { color: #e2e8f0; }
    .steps .step-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(99, 102, 241, 0.2);
      color: #818cf8;
      font-size: 0.7rem;
      font-weight: 700;
      margin-right: 6px;
    }
    .info-connected {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(16, 185, 129, 0.2);
      border-radius: 12px;
      padding: 20px;
      margin-top: 16px;
    }
    .info-connected .user-name { font-size: 1.1rem; font-weight: 600; color: #f1f5f9; }
    .info-connected .user-num { color: #94a3b8; font-size: 0.85rem; }
    .info-connected .features {
      margin-top: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      text-align: left;
      font-size: 0.82rem;
      color: #94a3b8;
    }
    .info-connected .features span { color: #34d399; margin-right: 6px; }
    .logout-btn {
      display: inline-block;
      margin-top: 20px;
      padding: 10px 24px;
      background: rgba(239, 68, 68, 0.12);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.25);
      border-radius: 10px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
    }
    .logout-btn:hover { background: rgba(239, 68, 68, 0.25); }
    .refresh-note { color: #475569; font-size: 0.72rem; margin-top: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">${isConnected ? "&#x1F7E2;" : "&#x1F4F2;"}</div>
    <h1>WhatsApp AI Voice Agent</h1>
    <p class="subtitle">Zero-cost AI assistant for your WhatsApp</p>

    ${isConnected ? `
      <div class="badge badge-connected"><span class="badge-dot"></span> Connected &amp; Online</div>
      <div class="info-connected">
        <div class="user-name">${escapeHtml(userName)}</div>
        <div class="user-num">+${escapeHtml(userNum)}</div>
        <div class="features">
          <div><span>&#x2713;</span> Intercepting incoming calls</div>
          <div><span>&#x2713;</span> Processing voice notes with AI</div>
          <div><span>&#x2713;</span> Replying to text messages</div>
          <div><span>&#x2713;</span> Multi-turn conversation memory</div>
        </div>
      </div>
      <a href="/logout" class="logout-btn" onclick="return confirm('Disconnect this WhatsApp account?')">Disconnect &amp; Pair New Number</a>
    ` : `
      <div class="badge badge-waiting"><span class="badge-dot"></span> Waiting for QR Scan</div>
      ${currentQrDataUrl
        ? `<div class="qr-container"><img src="${currentQrDataUrl}" alt="Scan this QR code with WhatsApp" /></div>`
        : `<div class="qr-container" style="padding:40px;color:#64748b;">Generating QR code...</div>`
      }
      <div class="steps">
        <strong>How to pair your WhatsApp:</strong><br><br>
        <div><span class="step-num">1</span> Open WhatsApp on your phone</div>
        <div><span class="step-num">2</span> Go to <strong>Settings</strong> &rarr; <strong>Linked Devices</strong></div>
        <div><span class="step-num">3</span> Tap <strong>Link a Device</strong> and scan the QR code above</div>
      </div>
      <p class="refresh-note">Page auto-refreshes every 4 seconds</p>
    `}
  </div>
  <script>
    ${isConnected ? "" : "setTimeout(() => location.reload(), 4000);"}
  </script>
</body>
</html>`);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

/**
 * HTML-escape to prevent XSS in dynamic content
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Launch ──────────────────────────────────────────────────────────────────

httpServer.listen(HTTP_PORT, () => {
  console.log(`[WEB] QR & Status page: http://localhost:${HTTP_PORT}/qr`);
});

startWhatsAppBot().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
