import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq, { toFile } from "groq-sdk";
import multer from "multer";

// Load variables from .env into process.env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configure in-memory upload storage for audio processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max audio size
});

// Middleware to parse JSON request bodies and enable CORS
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Initialize Groq client if API key is provided
let groq = null;
if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim() !== "") {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

// Health Check Endpoints
app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    message: "AI Voice Agent Backend is running!",
    groqConfigured: Boolean(groq)
  });
});


// 2. Chat Endpoint
// Accessible via: POST http://localhost:3000/chat
// Request body example: { "message": "Hello" }
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    // Validate incoming input
    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({
        error: "Invalid request. Please send a JSON object with a 'message' field, e.g. {\"message\": \"Hello\"}"
      });
    }

    // If no Groq API Key has been set yet, provide a friendly simulated response
    if (!groq) {
      console.log(`[SIMULATION] Received: "${message}"`);
      return res.json({
        reply: "Hello! Your backend is working perfectly! (Simulation mode: To connect live AI, add your free GROQ_API_KEY into the .env file).",
        simulated: true
      });
    }

    console.log(`[AI REQUEST] User message: "${message}"`);

    // Call the Groq LLM API
    const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
    const completion = await groq.chat.completions.create({
      model,
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

// 3. Speech-to-Text Endpoint (Groq Whisper Turbo)
// Accessible via: POST http://localhost:3000/transcribe
// Payload: multipart/form-data with field name "audio"
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No audio file uploaded. Please send audio via multipart/form-data with key 'audio'."
      });
    }

    if (!groq) {
      return res.json({
        text: "Simulation: Speech received. (Add GROQ_API_KEY to transcribe with Groq Whisper).",
        simulated: true
      });
    }

    console.log(`[STT REQUEST] Audio received: ${(req.file.size / 1024).toFixed(1)} KB (${req.file.mimetype || "unknown"})`);

    const filename = req.file.originalname || "audio.webm";
    const mimetype = req.file.mimetype || "audio/webm";
    const fileObj = await toFile(req.file.buffer, filename, { type: mimetype });

    // Whisper Large v3 Turbo on Groq provides ~200-400ms speech transcription
    const transcription = await groq.audio.transcriptions.create({
      file: fileObj,
      model: "whisper-large-v3-turbo",
      response_format: "json"
    });

    const transcribedText = (transcription.text || "").trim();
    console.log(`[STT SUCCESS] Result: "${transcribedText}"`);

    res.json({
      text: transcribedText
    });
  } catch (error) {
    console.error("[ERROR] Transcription error:", error);
    res.status(500).json({
      error: "Failed to transcribe audio.",
      details: error.message
    });
  }
});

// 4. Combined Voice-to-Response Pipeline: Speech -> Whisper STT -> LLM Brain -> Reply
// Accessible via: POST http://localhost:3000/voice-chat
// Payload: multipart/form-data with field name "audio"
app.post("/voice-chat", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No audio file uploaded. Please send audio via multipart/form-data with key 'audio'."
      });
    }

    if (!groq) {
      return res.json({
        transcript: "Simulation input",
        reply: "Backend simulation mode. Add GROQ_API_KEY for full voice pipeline."
      });
    }

    // Step A: Transcribe audio
    const filename = req.file.originalname || "audio.webm";
    const mimetype = req.file.mimetype || "audio/webm";
    const fileObj = await toFile(req.file.buffer, filename, { type: mimetype });

    const transcription = await groq.audio.transcriptions.create({
      file: fileObj,
      model: "whisper-large-v3-turbo",
      response_format: "json"
    });

    const userSpeechText = (transcription.text || "").trim();
    if (!userSpeechText) {
      return res.json({
        transcript: "",
        reply: "I couldn't hear anything clearly. Could you please say that again?"
      });
    }

    console.log(`[VOICE PIPELINE] Speech detected: "${userSpeechText}"`);

    // Step B: Send to Groq LLM
    const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
    const completion = await groq.chat.completions.create({
      model,
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
    console.log(`[VOICE PIPELINE] AI Reply: "${aiReply}"`);

    res.json({
      transcript: userSpeechText,
      reply: aiReply
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
  console.log(`\n==============================================`);
  console.log(`🚀 AI Backend Server is live on http://localhost:${PORT}`);
  console.log(`📡 Health check : GET  http://localhost:${PORT}/api/health`);
  console.log(`💬 Text Chat    : POST http://localhost:${PORT}/chat`);
  console.log(`🎙️ Transcribe   : POST http://localhost:${PORT}/transcribe`);
  console.log(`⚡ Voice Chat   : POST http://localhost:${PORT}/voice-chat`);
  if (!groq) {
    console.log(`⚠️  Running in SIMULATION mode (Add GROQ_API_KEY to .env for real AI)`);
  } else {
    console.log(`✨ Groq LLM & Whisper STT connected and ready!`);
  }
  console.log(`==============================================\n`);
});
