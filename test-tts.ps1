$ErrorActionPreference = "Stop"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Testing Voice Agent TTS Endpoint (Mouth)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3000"

Write-Host "`n1. Checking Voices & Health status..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method Get -UseBasicParsing
    Write-Host "   Health Status : $($health.status)" -ForegroundColor Green
    Write-Host "   LLM Provider  : $($health.services.llm.provider)" -ForegroundColor Green
    Write-Host "   STT Whisper   : $($health.services.stt.whisper)" -ForegroundColor Green
    Write-Host "   TTS ElevenLabs: $($health.services.tts.elevenlabs)" -ForegroundColor Green

    $voices = Invoke-RestMethod -Uri "$baseUrl/api/voices" -Method Get -UseBasicParsing
    Write-Host "   Active TTS    : $($voices.activeProvider)" -ForegroundColor Cyan
    Write-Host "   Preset Voices :" -ForegroundColor DarkGray
    foreach ($v in $voices.voices) {
        Write-Host "     - $($v.name): $($v.description)" -ForegroundColor DarkGray
    }
} catch {
    Write-Host "Failed to connect to ${baseUrl} : $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n2. Testing POST /tts (Mouth)..." -ForegroundColor Yellow
$body = '{"text":"Hello! This is a test of Stage 2 speech-to-text and text-to-speech.","voiceId":"21m00Tcm4TlvDq8ikWAM"}'

try {
    $response = Invoke-RestMethod -Uri "$baseUrl/tts" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing
    if ($response.fallback -or $response.mode) {
        Write-Host "   Mode   : $($response.mode)" -ForegroundColor Yellow
        Write-Host "   Message: $($response.message)" -ForegroundColor Yellow
        Write-Host "SUCCESS: TTS endpoint is alive, responding properly with fallback support." -ForegroundColor Green
    } else {
        Write-Host "SUCCESS: Response received from ElevenLabs TTS!" -ForegroundColor Green
    }
} catch {
    Write-Host "TTS Request Failed: $_" -ForegroundColor Red
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "Test complete!" -ForegroundColor Cyan
