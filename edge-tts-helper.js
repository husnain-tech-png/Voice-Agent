// edge-tts-helper.js
// Zero-cost Neural Speech Synthesis via Microsoft Edge TTS & FFmpeg Opus Conversion

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import ffmpegPath from "ffmpeg-static";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SYNTHESIZER_PY = path.join(__dirname, "edge-tts-synthesizer.py");

/**
 * Synthesizes text to speech using Edge-TTS ($0 cost) and encodes as WhatsApp-compatible Opus OGG.
 * @param {string} text - The text to speak
 * @param {string} voice - Microsoft Edge voice (e.g., 'en-US-AriaNeural', 'en-US-GuyNeural')
 * @returns {Promise<Buffer>} - Buffer of the Opus OGG audio file
 */
export async function synthesizeToWhatsAppOpus(text, voice = "en-US-AriaNeural") {
  if (!text || !text.trim()) {
    throw new Error("Text is required for speech synthesis");
  }

  // Clean text for speech (strip markdown, URLs, excessive punctuation)
  const cleanText = text
    .replace(/[*_#`~>\[\]\(\)]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tempId = `voice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const tempMp3 = path.join(os.tmpdir(), `${tempId}.mp3`);
  const tempOgg = path.join(os.tmpdir(), `${tempId}.ogg`);

  try {
    // 1. Run Python edge-tts synthesizer
    execFileSync("python", [SYNTHESIZER_PY, cleanText, tempMp3, voice], {
      timeout: 20000,
      encoding: "utf-8"
    });

    if (!fs.existsSync(tempMp3) || fs.statSync(tempMp3).size === 0) {
      throw new Error("Edge-TTS failed to produce an audio file");
    }

    // 2. Transcode MP3 to WhatsApp-compliant Opus OGG (48kHz, mono)
    execFileSync(
      ffmpegPath,
      [
        "-y",
        "-i", tempMp3,
        "-c:a", "libopus",
        "-b:a", "48k",
        "-ac", "1",
        "-ar", "48000",
        "-avoid_negative_ts", "make_zero",
        "-f", "ogg",
        tempOgg
      ],
      { timeout: 15000, stdio: "ignore" }
    );

    if (!fs.existsSync(tempOgg) || fs.statSync(tempOgg).size === 0) {
      throw new Error("FFmpeg failed to transcode to Opus OGG");
    }

    const oggBuffer = fs.readFileSync(tempOgg);
    return oggBuffer;
  } finally {
    // Clean up temporary files
    try { if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3); } catch (_) {}
    try { if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg); } catch (_) {}
  }
}
