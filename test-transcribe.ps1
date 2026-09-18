# Script to test Speech-to-Text (STT) on your AI Voice Agent Backend
Write-Host "`n=== Testing Voice Input (Speech-to-Text) ===" -ForegroundColor Cyan

$testAudioPath = Join-Path $PSScriptRoot "test-speech.wav"

try {
    # 1. Synthesize a test speech audio file if it doesn't exist
    if (-not (Test-Path $testAudioPath)) {
        Write-Host "🎙️ Synthesizing test audio file ('Hello, this is a test of speech to text')..." -ForegroundColor Yellow
        Add-Type -AssemblyName System.Speech
        $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $synth.SetOutputToWaveFile($testAudioPath)
        $synth.Speak("Hello, this is a test of speech to text.")
        $synth.Dispose()
        Write-Host "Created test audio at: $testAudioPath" -ForegroundColor Green
    }

    # 2. Send the audio file to http://localhost:3000/transcribe
    Write-Host "`n🚀 Sending audio to http://localhost:3000/transcribe via Groq Whisper..." -ForegroundColor Cyan
    $transcribeResponse = curl.exe -s -F "audio=@$testAudioPath" http://localhost:3000/transcribe
    Write-Host "Transcription Result:" -ForegroundColor Green
    Write-Host $transcribeResponse

    # 3. Also test the full pipeline http://localhost:3000/voice-chat
    Write-Host "`n⚡ Testing full voice pipeline (Speech -> Whisper -> LLM Reply) at /voice-chat..." -ForegroundColor Cyan
    $pipelineResponse = curl.exe -s -F "audio=@$testAudioPath" http://localhost:3000/voice-chat
    Write-Host "Voice Pipeline Result:" -ForegroundColor Green
    Write-Host $pipelineResponse

    Write-Host "`n✅ Speech-to-Text test complete!`n" -ForegroundColor Green
}
catch {
    Write-Host "`n❌ Error during test: $($_.Exception.Message)" -ForegroundColor Red
}
