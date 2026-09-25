"""
Edge-TTS Zero-Cost Speech Synthesizer
Generates natural neural audio without any API key or subscription fees.
Supports command-line invocation:
  python edge-tts-synthesizer.py "Hello, this is an AI voice." "output.mp3" "en-US-AriaNeural"
"""
import sys
import asyncio
import edge_tts

async def synthesize(text: str, output_path: str, voice: str = "en-US-AriaNeural"):
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)
    print(f"SUCCESS: Synthesized {len(text)} chars to {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python edge-tts-synthesizer.py <text> <output_path> [voice]")
        sys.exit(1)
    
    text_arg = sys.argv[1]
    out_arg = sys.argv[2]
    voice_arg = sys.argv[3] if len(sys.argv) > 3 else "en-US-AriaNeural"
    
    asyncio.run(synthesize(text_arg, out_arg, voice_arg))
