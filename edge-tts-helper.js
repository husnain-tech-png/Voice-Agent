// edge-tts-helper.js
// High-Fidelity Speech Synthesis Pipeline for WhatsApp Voice Agent
// Primary: ElevenLabs Charlie Voice (IKne3meq5aSn9XLyUdCD) via eleven_multilingual_v2
// Fallback: Microsoft Edge-TTS Male Voices (ur-PK-AsadNeural for Urdu, en-US-GuyNeural for English)
// Output: Native WhatsApp-compatible Opus OGG (48kHz, mono, PTT ready)

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import ffmpegPath from "ffmpeg-static";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SYNTHESIZER_PY = path.join(__dirname, "edge-tts-synthesizer.py");

// Charlie ElevenLabs Voice ID (Male casual Australian/British voice, multilingual)
const DEFAULT_CHARLIE_VOICE = "IKne3meq5aSn9XLyUdCD";

// Male Edge-TTS Fallbacks (Zero-Cost, NO female voices)
const EDGE_MALE_URDU = "ur-PK-AsadNeural";
const EDGE_MALE_ENGLISH = "en-US-GuyNeural";

/**
 * Checks if text contains Urdu/Arabic script characters
 */
function isUrduText(text) {
  if (!text) return false;
  // Arabic/Urdu Unicode block \u0600-\u06FF
  return /[\u0600-\u06FF]/.test(text);
}

/**
 * Clean text for clean speech synthesis (remove markdown, asterisks, URLs, brackets)
 */
function cleanTextForSpeech(text) {
  if (!text) return "";
  return text
    .replace(/[*_#`~>\[\]\(\)]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Transcodes an MP3 file into WhatsApp-compliant Opus OGG (48kHz, 1 channel)
 */
function transcodeMp3ToOpusOgg(inputMp3Path, outputOggPath) {
  execFileSync(
    ffmpegPath,
    [
      "-y",
      "-i", inputMp3Path,
      "-c:a", "libopus",
      "-b:a", "48k",
      "-ac", "1",
      "-ar", "48000",
      "-avoid_negative_ts", "make_zero",
      "-f", "ogg",
      outputOggPath
    ],
    { timeout: 15000, stdio: "ignore" }
  );

  if (!fs.existsSync(outputOggPath) || fs.statSync(outputOggPath).size === 0) {
    throw new Error("FFmpeg failed to transcode audio to Opus OGG");
  }
}

/**
 * Synthesizes text to WhatsApp-compatible Opus OGG.
 * Uses ElevenLabs Charlie by default, with automatic male Edge-TTS fallback.
 *
 * @param {string} text - Text to speak
 * @param {string} [preferredVoice] - Optional specific ElevenLabs voice ID or Edge voice
 * @returns {Promise<Buffer>} - Buffer of the Opus OGG audio file
 */
export async function synthesizeToWhatsAppOpus(text, preferredVoice = null) {
  if (!text || !text.trim()) {
    throw new Error("Text is required for speech synthesis");
  }

  const cleanText = cleanTextForSpeech(text);
  if (!cleanText) {
    throw new Error("Text is empty after cleaning");
  }

  const hasUrdu = isUrduText(cleanText);
  const elevenlabsKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  const elevenlabsVoiceId = preferredVoice || process.env.ELEVENLABS_VOICE_ID || DEFAULT_CHARLIE_VOICE;

  const tempId = `voice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const tempMp3 = path.join(os.tmpdir(), `${tempId}.mp3`);
  const tempOgg = path.join(os.tmpdir(), `${tempId}.ogg`);

  // ── Step 1: Attempt ElevenLabs Synthesis with Charlie Voice ─────────────
  if (elevenlabsKey && elevenlabsKey.startsWith("sk_")) {
    try {
      console.log(`[TTS] Synthesizing via ElevenLabs Charlie (${elevenlabsVoiceId}) [Model: eleven_multilingual_v2, Lang: ${hasUrdu ? "Urdu" : "Auto"}]...`);
      
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${elevenlabsVoiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": elevenlabsKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: cleanText,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.8
            }
          })
        }
      );

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(tempMp3, Buffer.from(arrayBuffer));

        // Transcode MP3 to WhatsApp-compliant Opus OGG
        transcodeMp3ToOpusOgg(tempMp3, tempOgg);
        const oggBuffer = fs.readFileSync(tempOgg);
        console.log(`[TTS] ✅ ElevenLabs Charlie synthesis successful (${oggBuffer.length} bytes Opus OGG)`);
        return oggBuffer;
      } else {
        const errDetail = await response.text();
        console.warn(`[TTS] ElevenLabs returned ${response.status}: ${errDetail.substring(0, 120)}. Falling back to Edge-TTS male voice...`);
      }
    } catch (elevenErr) {
      console.warn(`[TTS] ElevenLabs request failed: ${elevenErr.message}. Falling back to Edge-TTS male voice...`);
    } finally {
      try { if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3); } catch (_) {}
      try { if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg); } catch (_) {}
    }
  }

  // ── Step 2: Fallback to Edge-TTS Male Voice (Zero Cost, No Female Voice) ───
  // If Urdu text is present, use Pakistani male voice Asad (ur-PK-AsadNeural)
  // If English text, use Guy (en-US-GuyNeural)
  const edgeVoice = hasUrdu ? EDGE_MALE_URDU : EDGE_MALE_ENGLISH;
  console.log(`[TTS] Synthesizing via Edge-TTS Male Fallback (${edgeVoice}) [HasUrdu: ${hasUrdu}]...`);

  try {
    execFileSync("python", [SYNTHESIZER_PY, cleanText, tempMp3, edgeVoice], {
      timeout: 20000,
      encoding: "utf-8"
    });

    if (!fs.existsSync(tempMp3) || fs.statSync(tempMp3).size === 0) {
      throw new Error("Edge-TTS synthesizer failed to generate MP3");
    }

    transcodeMp3ToOpusOgg(tempMp3, tempOgg);
    const oggBuffer = fs.readFileSync(tempOgg);
    console.log(`[TTS] ✅ Edge-TTS Male fallback successful (${oggBuffer.length} bytes Opus OGG)`);
    return oggBuffer;
  } catch (edgeErr) {
    console.error("[TTS FATAL] Both ElevenLabs and Edge-TTS synthesis failed:", edgeErr.message);
    throw edgeErr;
  } finally {
    try { if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3); } catch (_) {}
    try { if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg); } catch (_) {}
  }
}
