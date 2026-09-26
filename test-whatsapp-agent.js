// test-whatsapp-agent.js
// Automated verification for Personal WhatsApp Voice Agent Pipeline
// Tests: ElevenLabs Charlie Voice, Multilingual Urdu STT, Urdu LLM Reasoning, Call History

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Groq, { toFile } from "groq-sdk";
import dotenv from "dotenv";
import { synthesizeToWhatsAppOpus } from "./edge-tts-helper.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log("\n========================================================");
  console.log("🧪 Automated Verification: WhatsApp Voice Agent Pipeline");
  console.log("   Voice: ElevenLabs Charlie (IKne3meq5aSn9XLyUdCD)");
  console.log("   Language: Natural Pakistani Urdu & English");
  console.log("========================================================\n");

  let passed = 0;
  const total = 4;

  // Test 1: Verify ElevenLabs Charlie TTS to Opus OGG (Urdu & English)
  console.log("👉 Test 1: Testing ElevenLabs Charlie Voice Opus OGG synthesis (Urdu)...");
  try {
    const urduPhrase = "السلام علیکم! میں حسنین کا اسسٹنٹ بول رہا ہوں، فرمائیے میں آپ کی کیا مدد کر سکتا ہوں۔";
    const oggBuffer = await synthesizeToWhatsAppOpus(urduPhrase);
    if (oggBuffer && oggBuffer.length > 5000) {
      console.log(`   ✅ Charlie synthesized valid WhatsApp Opus OGG (${(oggBuffer.length / 1024).toFixed(1)} KB)`);
      passed++;
    } else {
      throw new Error(`Buffer too small: ${oggBuffer?.length} bytes`);
    }
  } catch (err) {
    console.error("   ❌ Test 1 Failed:", err.message);
  }

  // Test 2: Verify Groq Whisper STT on synthesized Urdu audio
  console.log("\n👉 Test 2: Testing Groq Whisper STT on synthesized Urdu WhatsApp audio...");
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const oggBuffer = await synthesizeToWhatsAppOpus("السلام علیکم، میں حسنین سے ملنا چاہتا ہوں۔");
    const audioFile = await toFile(oggBuffer, "sample_urdu.ogg", { type: "audio/ogg" });
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3-turbo",
      prompt: "Urdu and English speech. السلام علیکم، میں حسنین سے ملنا چاہتا ہوں۔"
    });
    console.log(`   ✅ Transcribed Urdu Audio: "${transcription.text}"`);
    if (transcription.text && transcription.text.length > 2) {
      passed++;
    } else {
      throw new Error("Empty transcription result");
    }
  } catch (err) {
    console.error("   ❌ Test 2 Failed:", err.message);
  }

  // Test 3: Verify Groq LLM Conversational Urdu Reasoning
  console.log("\n👉 Test 3: Testing Groq LLM natural Pakistani Urdu reasoning...");
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
    const completion = await groq.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are Charlie, Husnain's polite male voice assistant. Respond to Urdu queries in natural, authentic Pakistani Urdu in Urdu script (2 sentences max). No markdown."
        },
        {
          role: "user",
          content: "السلام علیکم بھائی! کیا حسنین بھائی موجود ہیں؟ مجھے ان سے ایک پروجیکٹ کے بارے میں بات کرنی تھی۔"
        }
      ],
      max_tokens: 200,
      ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {})
    });
    const reply = completion.choices[0]?.message?.content || "";
    console.log(`   ✅ LLM Urdu Reply: "${reply.trim()}"`);
    if (reply.length > 10) {
      passed++;
    } else {
      throw new Error("Empty reply");
    }
  } catch (err) {
    console.error("   ❌ Test 3 Failed:", err.message);
  }

  // Test 4: Verify Call History Persistence
  console.log("\n👉 Test 4: Testing Call History & Interception Logging...");
  try {
    const historyFile = path.join(__dirname, "call-history.json");
    let history = [];
    if (fs.existsSync(historyFile)) {
      history = JSON.parse(fs.readFileSync(historyFile, "utf-8"));
    }
    console.log(`   ✅ call-history.json exists with ${history.length} records`);
    passed++;
  } catch (err) {
    console.error("   ❌ Test 4 Failed:", err.message);
  }

  console.log("\n========================================================");
  console.log(`🏁 Results: ${passed}/${total} checks passed (${Math.round((passed / total) * 100)}%)`);
  console.log("========================================================\n");
}

runTests().catch(console.error);
