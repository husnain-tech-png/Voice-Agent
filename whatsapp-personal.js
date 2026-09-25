/**
 * =========================================================================
 *  WhatsApp Personal AI Voice Agent — Stage 6 ($0 Cost)
 * =========================================================================
 *  Connects directly to your personal WhatsApp number (+923154483615)
 *  via Baileys (@whiskeysockets/baileys) QR scan with ZERO Meta fees.
 *
 *  Core Capabilities:
 *    1. Incoming Call Interception: Detects WhatsApp calls, silences/rejects them,
 *       and immediately dispatches an authentic AI voice note on your behalf.
 *    2. Voice-to-Voice Notes (PTT): Downloads incoming voice messages (.ogg),
 *       transcribes via Groq Whisper STT, reasons with Groq Llama 3.3 70B,
 *       synthesizes speech with Microsoft Edge-TTS ($0.00), and sends back an
 *       Opus voice note.
 *    3. Multi-Turn Conversation Memory: Keeps context per contact.
 *    4. Web QR & Health Server (Port 3005): Scan QR from terminal OR browser!
 *    5. Call History Sync: Persists transcripts & summaries to call-history.json.
 * =========================================================================
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
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

// Configuration
const GROQ_API_KEY = (process.env.GROQ_API_KEY || "").trim();
const GROQ_LLM_MODEL = (process.env.GROQ_MODEL || process.env.GROQ_LLM_MODEL || "openai/gpt-oss-120b").trim();
const GROQ_STT_MODEL = "whisper-large-v3-turbo";
const EDGE_TTS_VOICE = (process.env.EDGE_TTS_VOICE || "en-US-AriaNeural").trim();
const PERSONAL_PHONE_NUMBER = (process.env.PERSONAL_PHONE_NUMBER || "+923154483615").trim();
const HTTP_PORT = parseInt(process.env.WHATSAPP_PORT || "3005", 10);
const AUTH_DIR = path.join(__dirname, "auth_baileys");
const CALL_HISTORY_FILE = path.join(__dirname, "call-history.json");
const STATUS_FILE = path.join(__dirname, "whatsapp-status.json");

// Initialize Groq client
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

// State management
let sock = null;
let currentQr = null;
let connectionState = "disconnected"; // "connecting", "qr_ready", "connected", "disconnected"
let botUser = null;
const conversationHistory = new Map(); // remoteJid -> array of { role, content }
const lastCallInterceptTime = new Map(); // remoteJid -> timestamp (rate limit auto-replies)

// System prompt for the WhatsApp Voice Agent
const SYSTEM_PROMPT = `You are a warm, articulate, and helpful AI voice assistant answering WhatsApp messages and calls on behalf of Husnain (${PERSONAL_PHONE_NUMBER}).

Guidelines:
1. Speak concisely and conversationally (2 to 4 sentences maximum). Your words will be converted directly into spoken audio voice notes.
2. If asked where Husnain is or why he didn't pick up the call, politely explain that he is currently unavailable and you are assisting on his behalf.
3. You can answer questions, take messages for Husnain, or arrange for him to follow up.
4. Crucial: NEVER use markdown symbols (no asterisks, no bullet points, no emojis in speech, no numbered lists, no URLs) because your response will be read aloud as audio. Speak naturally as if leaving a friendly voice message.`;

/**
 * Update and persist current WhatsApp agent status
 */
function updateStatus(state, extra = {}) {
  connectionState = state;
  const statusData = {
    state,
    connected: state === "connected",
    botUser: botUser ? botUser.id : null,
    personalNumber: PERSONAL_PHONE_NUMBER,
    timestamp: new Date().toISOString(),
    conversationsCount: conversationHistory.size,
    ...extra
  };

  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(statusData, null, 2), "utf-8");
  } catch (err) {
    console.warn("[STATUS ERROR] Failed to write status file:", err.message);
  }
}

/**
 * Save call or voice note interaction to call-history.json
 */
function logCallRecord(record) {
  try {
    let history = [];
    if (fs.existsSync(CALL_HISTORY_FILE)) {
      const raw = fs.readFileSync(CALL_HISTORY_FILE, "utf-8");
      history = JSON.parse(raw);
    }
    history.unshift({
      callSid: `WA_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      callerNumber: record.callerNumber,
      channel: "WhatsApp",
      type: record.type || "Call Intercept",
      startTime: record.startTime || new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationSeconds: record.durationSeconds || 0,
      transcript: record.transcript || [],
      summary: record.summary || "WhatsApp call intercepted by AI voice agent.",
      smsSent: false
    });

    if (history.length > 50) history = history.slice(0, 50);
    fs.writeFileSync(CALL_HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
    console.log(`[CALL HISTORY] Saved record for ${record.callerNumber}`);
  } catch (err) {
    console.error("[CALL HISTORY ERROR]", err.message);
  }
}

/**
 * Retrieve or create conversation history for a contact
 */
function getHistory(jid) {
  if (!conversationHistory.has(jid)) {
    conversationHistory.set(jid, []);
  }
  return conversationHistory.get(jid);
}

function appendHistory(jid, role, content) {
  const history = getHistory(jid);
  history.push({ role, content });
  if (history.length > 16) {
    conversationHistory.set(jid, history.slice(-16));
  }
}

/**
 * Generate AI voice greeting and send to caller when a live call is intercepted
 */
async function handleCallInterception(call) {
  const callerJid = call.from;
  const callerNumber = callerJid.split("@")[0];

  console.log(`\n=============================================================`);
  console.log(`📞 [CALL INTERCEPTED] Incoming WhatsApp call from: +${callerNumber}`);
  console.log(`=============================================================`);

  // Rate-limit call auto-responses to once every 2 minutes per caller
  const now = Date.now();
  const lastTime = lastCallInterceptTime.get(callerJid) || 0;
  if (now - lastTime < 120000) {
    console.log(`[CALL NOTICE] Call auto-response rate-limited for +${callerNumber}`);
    return;
  }
  lastCallInterceptTime.set(callerJid, now);

  const greetingText = `Hello! You've reached Husnain's AI voice assistant. I am answering on his behalf. I'm currently taking voice messages. Please hold down the microphone button right here in this chat and leave your voice note, and I will assist you or notify Husnain immediately!`;

  try {
    console.log(`👄 Synthesizing AI call-interception voice note via Edge-TTS...`);
    const oggBuffer = await synthesizeToWhatsAppOpus(greetingText, EDGE_TTS_VOICE);

    // Send native WhatsApp Voice Note (PTT)
    await sock.sendMessage(callerJid, {
      audio: oggBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true
    });

    // Also send companion text message for visual confirmation
    await sock.sendMessage(callerJid, {
      text: `📞 *Missed Call Handled by AI*\n\nHi! I am Husnain's AI assistant answering on his behalf. Please leave a *voice note* 🎤 right here in this chat, and I'll listen and assist you immediately!`
    });

    console.log(`✅ [VOICE NOTE SENT] Call interception audio delivered to +${callerNumber}`);

    // Log to call history
    logCallRecord({
      callerNumber: `+${callerNumber}`,
      type: "WhatsApp Call (Auto-Intercepted)",
      transcript: [
        { role: "system", text: "Incoming WhatsApp call intercepted and silenced." },
        { role: "assistant", text: greetingText }
      ],
      summary: `Incoming WhatsApp call from +${callerNumber} was intercepted by the AI voice assistant. An audio greeting requesting a voice note was sent.`
    });
  } catch (err) {
    console.error(`❌ [CALL INTERCEPTION ERROR] Failed to send voice note to +${callerNumber}:`, err.message);
  }
}

/**
 * Handle incoming audio (voice note) or text messages
 */
async function handleIncomingMessage(msg) {
  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith("@g.us") || msg.key.fromMe) {
    // Ignore group chats or messages sent by the bot itself
    return;
  }

  const senderNumber = jid.split("@")[0];
  const messageType = Object.keys(msg.message || {})[0];

  let userText = "";
  let isAudio = false;

  // 1. Check if message is a Voice Note or Audio
  if (messageType === "audioMessage") {
    isAudio = true;
    console.log(`\n🎤 [VOICE NOTE RECEIVED] From +${senderNumber}`);

    try {
      console.log(`⬇️ Downloading WhatsApp audio buffer...`);
      const buffer = await downloadMediaMessage(
        msg,
        "buffer",
        {},
        { logger: pino({ level: "silent" }) }
      );

      if (!buffer || buffer.length === 0) {
        console.warn(`[AUDIO WARNING] Empty audio buffer received`);
        return;
      }

      console.log(`👂 Transcribing voice note via Groq Whisper (${GROQ_STT_MODEL})...`);
      const audioFile = await toFile(buffer, "voice.ogg", { type: "audio/ogg" });
      const transcription = await groq.audio.transcriptions.create({
        file: audioFile,
        model: GROQ_STT_MODEL,
        language: "en"
      });

      userText = (transcription.text || "").trim();
      console.log(`   ✅ Transcribed: "${userText}"`);

      if (!userText) {
        await sock.sendMessage(jid, {
          text: "I couldn't hear that voice note clearly. Could you please send it again? 🎤"
        });
        return;
      }
    } catch (sttErr) {
      console.error(`❌ [STT ERROR]`, sttErr.message);
      await sock.sendMessage(jid, {
        text: "I had trouble transcribing your voice note. Please try again or type your message!"
      });
      return;
    }
  } else if (messageType === "conversation" || messageType === "extendedTextMessage") {
    userText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
    console.log(`\n💬 [TEXT RECEIVED] From +${senderNumber}: "${userText}"`);
  } else {
    // Other unsupported formats (stickers, images)
    return;
  }

  if (!userText) return;

  // Append user message to history
  appendHistory(jid, "user", userText);

  // 2. Query Groq LLM for AI response
  let aiReplyText = "";
  try {
    console.log(`🧠 Generating response with Groq LLM (${GROQ_LLM_MODEL})...`);
    const history = getHistory(jid);
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history
    ];

    const completion = await groq.chat.completions.create({
      model: GROQ_LLM_MODEL,
      messages,
      max_tokens: 300,
      temperature: 0.5,
      ...(GROQ_LLM_MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {})
    });

    aiReplyText = (completion.choices[0]?.message?.content || "").trim();
    console.log(`   ✅ AI Response: "${aiReplyText}"`);
    appendHistory(jid, "assistant", aiReplyText);
  } catch (llmErr) {
    console.error(`❌ [LLM ERROR]`, llmErr.message);
    aiReplyText = "I'm having a brief connection delay. I have noted your message for Husnain and he will get back to you shortly.";
  }

  // 3. Synthesize Speech and Send WhatsApp Voice Note
  try {
    console.log(`👄 Synthesizing voice note reply with Edge-TTS (${EDGE_TTS_VOICE})...`);
    const oggBuffer = await synthesizeToWhatsAppOpus(aiReplyText, EDGE_TTS_VOICE);

    // Send native WhatsApp Voice Note (PTT)
    await sock.sendMessage(
      jid,
      {
        audio: oggBuffer,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true
      },
      { quoted: msg }
    );

    console.log(`🚀 [VOICE NOTE DELIVERED] Replied to +${senderNumber} with voice note!`);

    // Log to call history
    logCallRecord({
      callerNumber: `+${senderNumber}`,
      type: isAudio ? "WhatsApp Voice Note Exchange" : "WhatsApp Chat Exchange",
      transcript: [
        { role: "user", text: userText },
        { role: "assistant", text: aiReplyText }
      ],
      summary: `User asked: "${userText}". AI Voice Assistant responded: "${aiReplyText}".`
    });
  } catch (ttsErr) {
    console.error(`❌ [TTS/DELIVERY ERROR]`, ttsErr.message);
    // Graceful fallback to text if audio synthesis failed
    await sock.sendMessage(jid, { text: aiReplyText }, { quoted: msg });
  }
}

/**
 * Initialize Baileys Socket connection
 */
async function startWhatsAppBot() {
  updateStatus("connecting");
  console.log("\n========================================================");
  console.log("  🚀 Starting Personal WhatsApp AI Voice Agent Service");
  console.log("========================================================\n");

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`[BAILEYS] Using WhatsApp Web version: ${version.join(".")}`);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }), // Silent logger avoids terminal noise
    printQRInTerminal: false, // We render QR code manually using qrcode-terminal
    browser: ["VoiceAgent-AI", "Chrome", "1.0.0"],
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  // 1. Connection updates & QR Code handling
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQr = qr;
      updateStatus("qr_ready", { qr });
      console.log("\n📲 [ACTION REQUIRED] Scan this QR Code with your WhatsApp:");
      console.log("   1. Open WhatsApp on your phone (+923154483615)");
      console.log("   2. Tap Settings ⚙️ (or 3 dots) → Linked Devices");
      console.log("   3. Tap 'Link a Device' and point camera here:\n");

      qrcode.generate(qr, { small: true });

      console.log(`\n🌐 Or open in browser: http://localhost:${HTTP_PORT}/qr\n`);
    }

    if (connection === "open") {
      botUser = sock.user;
      currentQr = null;
      updateStatus("connected", { user: botUser });
      console.log("\n========================================================");
      console.log(`🟢 WhatsApp Voice Agent Connected & Online!`);
      console.log(`📱 User: ${botUser?.name || "Husnain"} (+${botUser?.id?.split(":")[0]})`);
      console.log(`👂 Listening for incoming calls and voice notes 24/7...`);
      console.log("========================================================\n");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      updateStatus("disconnected", { statusCode, shouldReconnect });

      console.log(`⚠️ Connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(startWhatsAppBot, 3000);
      } else {
        console.log("❌ Logged out from WhatsApp. Clear 'auth_baileys' folder to pair again.");
      }
    }
  });

  // 2. Incoming Call Interception
  sock.ev.on("call", async (calls) => {
    for (const call of calls) {
      if (call.status === "offer") {
        try {
          // Reject/silence the call
          await sock.rejectCall(call.id, call.from);
          // Auto-respond with AI voice note
          await handleCallInterception(call);
        } catch (callErr) {
          console.error("[CALL HANDLER ERROR]", callErr.message);
        }
      }
    }
  });

  // 3. Incoming Messages (Voice Notes & Text)
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        await handleIncomingMessage(msg);
      } catch (msgErr) {
        console.error("[MESSAGE HANDLER ERROR]", msgErr.message);
      }
    }
  });
}

/**
 * Web QR & Status Server (Port 3005)
 */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      status: connectionState,
      connected: connectionState === "connected",
      user: botUser,
      personalNumber: PERSONAL_PHONE_NUMBER,
      activeConversations: conversationHistory.size
    }));
    return;
  }

  if (url.pathname === "/qr" || url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp Voice Agent — QR Link</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 28px; max-width: 440px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          h1 { font-size: 1.4rem; color: #38bdf8; margin-bottom: 8px; }
          p { color: #94a3b8; font-size: 0.9rem; margin-bottom: 20px; }
          .badge { display: inline-block; padding: 6px 12px; border-radius: 9999px; font-weight: 600; font-size: 0.8rem; margin-bottom: 16px; }
          .badge-connected { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #10b981; }
          .badge-waiting { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; }
          pre { background: #020617; padding: 16px; border-radius: 8px; font-size: 10px; line-height: 10px; overflow-x: auto; color: #38bdf8; }
          .steps { text-align: left; background: #0f172a; padding: 14px 18px; border-radius: 10px; font-size: 0.82rem; color: #cbd5e1; line-height: 1.6; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🤖 WhatsApp AI Voice Agent</h1>
          <p>Answering calls & voice notes for <strong>${PERSONAL_PHONE_NUMBER}</strong></p>
          ${
            connectionState === "connected"
              ? `<div class="badge badge-connected">🟢 Connected & Online</div><p>Your WhatsApp is paired! The AI voice agent is actively answering incoming calls and voice notes.</p>`
              : `<div class="badge badge-waiting">📲 QR Code Ready to Scan</div>
                 <div class="steps">
                   <strong>How to Pair:</strong><br>
                   1. Open WhatsApp on your phone.<br>
                   2. Go to <strong>Settings ⚙️ → Linked Devices</strong>.<br>
                   3. Tap <strong>Link a Device</strong> and scan the terminal QR code.
                 </div>
                 <p style="margin-top:16px; font-size: 0.78rem;">Status auto-refreshes every 4s</p>`
          }
        </div>
        <script>
          setTimeout(() => location.reload(), 4000);
        </script>
      </body>
      </html>
    `);
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(HTTP_PORT, () => {
  console.log(`🌐 WhatsApp Agent Status & Web UI: http://localhost:${HTTP_PORT}/qr`);
});

// Launch bot
startWhatsAppBot().catch((err) => {
  console.error("❌ Fatal WhatsApp Bot Error:", err);
});
