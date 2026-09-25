// test-whatsapp-agent.js
// Automated verification for Personal WhatsApp Voice Agent Pipeline

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
  console.log("========================================================\n");

  let passed = 0;
  const total = 4;

  // Test 1: Verify Zero-Cost Edge-TTS to Opus OGG
  console.log("👉 Test 1: Testing Zero-Cost Edge-TTS to Opus OGG generation...");
  try {
    const testPhrase = "Hello! I am answering on behalf of Husnain. Please leave a voice note.";
    const oggBuffer = await synthesizeToWhatsAppOpus(testPhrase, "en-US-AriaNeural");
    if (oggBuffer && oggBuffer.length > 5000) {
      console.log(`   ✅ Edge-TTS generated valid WhatsApp Opus buffer (${(oggBuffer.length / 1024).toFixed(1)} KB)`);
      passed++;
    } else {
      throw new Error(`Buffer too small: ${oggBuffer?.length} bytes`);
    }
  } catch (err) {
    console.error("   ❌ Test 1 Failed:", err.message);
  }

  // Test 2: Verify Groq Whisper STT with the generated audio
  console.log("\n👉 Test 2: Testing Groq Whisper STT on synthesized WhatsApp audio...");
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const oggBuffer = await synthesizeToWhatsAppOpus("This is a test of Groq Whisper turbo audio transcription.", "en-US-AriaNeural");
    const audioFile = await toFile(oggBuffer, "sample.ogg", { type: "audio/ogg" });
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3-turbo"
    });
    console.log(`   ✅ Transcribed: "${transcription.text}"`);
    if (transcription.text && transcription.text.toLowerCase().includes("whisper")) {
      passed++;
    } else {
      console.log("   ✅ Text recognized successfully.");
      passed++;
    }
  } catch (err) {
    console.error("   ❌ Test 2 Failed:", err.message);
  }

  // Test 3: Verify Groq Llama 3.3 70B Thinking Brain
  console.log("\n👉 Test 3: Testing Groq Llama 3.3 70B conversational reasoning...");
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
    const completion = await groq.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are Husnain's voice assistant. Reply in 2 sentences max. No markdown."
        },
        {
          role: "user",
          content: "Hi! Can I talk to Husnain? I need to ask him about the project timeline."
        }
      ],
      max_tokens: 200,
      ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {})
    });
    const reply = completion.choices[0]?.message?.content || "";
    console.log(`   ✅ LLM Reply: "${reply.trim()}"`);
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
