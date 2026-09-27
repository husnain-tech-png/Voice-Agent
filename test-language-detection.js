// test-language-detection.js
// Verification for: Default Language English + Dynamic Urdu Detection
import Groq from "groq-sdk";
import dotenv from "dotenv";
import { synthesizeToWhatsAppOpus } from "./edge-tts-helper.js";

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const groq = new Groq({ apiKey: GROQ_API_KEY });

const SYSTEM_PROMPT = `You are Charlie, a polite, warm, articulate, and intelligent male AI voice assistant answering on behalf of Husnain (+923154483615).

CRITICAL CONVERSATIONAL & LANGUAGE RULES:
1. DEFAULT LANGUAGE IS ENGLISH:
   - Your primary and default language of communication is ENGLISH.
   - When the user/caller speaks, writes, or greets in English, ALWAYS respond in a natural, polite, friendly, and articulate English conversational tone.
2. DYNAMIC LANGUAGE DETECTION (URDU DETECTION):
   - Listen to and detect the user's language automatically:
   - When the caller speaks, writes, or greets in Urdu or Roman Urdu (e.g. 'السلام علیکم', 'کیا حال ہے', 'Salam', 'Assalam-o-Alaikum', 'kya haal hai', 'kaise ho', 'Husnain kahan hai', 'mujhe kaam tha'):
     - Immediately and dynamically switch to speaking in authentic, natural, fluent Pakistani Urdu in proper Urdu script (e.g. 'وعلیکم السلام! جی میں حسنین کی طرف سے بات کر رہا ہوں۔ وہ اس وقت دستیاب نہیں ہیں، فرمائیے میں آپ کی کیا مدد کر سکتا ہوں؟').
     - Speak exactly like a polite, educated Pakistani person answering a phone call.
     - NEVER use robotic phrases, literal machine translations, or stiff bookish language. Make it sound completely natural and human.
   - When the caller speaks in English, ALWAYS respond in English.
3. CONVERSATIONAL BREVITY:
   - Keep your answer short, clear, and conversational (2 to 3 sentences maximum).
4. ABSOLUTELY NO MARKDOWN OR SPECIAL SYMBOLS:
   - Crucial: NEVER use markdown symbols (no asterisks *, no bullet points -, no emojis in your spoken words, no numbered lists, no URLs) because your response is converted directly into spoken audio voice notes. Speak smoothly and naturally.`;

async function testPrompt(userMessage, expectedLang) {
  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage }
    ],
    max_tokens: 200,
    temperature: 0.6,
    ...(GROQ_MODEL.includes("gpt-oss") ? { reasoning_effort: "low" } : {})
  });

  const reply = (completion.choices?.[0]?.message?.content || "").trim();
  const hasUrduScript = /[\u0600-\u06FF]/.test(reply);
  const detectedLang = hasUrduScript ? "Urdu" : "English";

  console.log(`\nUser: "${userMessage}"`);
  console.log(`AI:   "${reply}"`);
  console.log(`Detected output language: ${detectedLang} (Expected: ${expectedLang})`);

  if (detectedLang === expectedLang) {
    console.log(`✅ Passed: Language matched expected ${expectedLang}`);
    return true;
  } else {
    console.error(`❌ Failed: Expected ${expectedLang}, but got ${detectedLang}`);
    return false;
  }
}

async function run() {
  console.log("==================================================");
  console.log("🌐 Testing English Default & Dynamic Urdu Detection");
  console.log("==================================================");

  let passed = 0;

  // Test 1: Default English (greeting & query)
  console.log("\n--- Test 1: User speaks in English (Default Language) ---");
  const t1 = await testPrompt("Hi Charlie, is Husnain available right now?", "English");
  if (t1) passed++;

  // Test 2: Urdu in Urdu script
  console.log("\n--- Test 2: User speaks in Urdu Script ---");
  const t2 = await testPrompt("السلام علیکم بھائی، کیا حال ہے؟ حسنین کہاں ہیں؟", "Urdu");
  if (t2) passed++;

  // Test 3: Roman Urdu detection
  console.log("\n--- Test 3: User speaks in Roman Urdu ---");
  const t3 = await testPrompt("Salam bhai, Husnain se urgent kaam hai, call utha saktay hain?", "Urdu");
  if (t3) passed++;

  // Test 4: Another English query
  console.log("\n--- Test 4: Another English query to confirm default persists ---");
  const t4 = await testPrompt("Can you let him know that our 3 PM meeting is confirmed?", "English");
  if (t4) passed++;

  console.log(`\n==================================================`);
  console.log(`🏁 Summary: ${passed}/4 tests passed!`);
  console.log(`==================================================`);
}

run().catch(console.error);
