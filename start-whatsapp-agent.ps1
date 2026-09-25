# start-whatsapp-agent.ps1
# Starts the Personal WhatsApp Voice Agent with QR pairing and call interception
$ErrorActionPreference = "Continue"

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  Starting Personal WhatsApp AI Voice Agent ($0.00 Cost)  " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Target Number   : +923154483615" -ForegroundColor Cyan
Write-Host "Voice Engine    : Microsoft Edge-TTS (AriaNeural, $0.00)" -ForegroundColor Cyan
Write-Host "Brain & Ears    : Groq Llama 3.3 70B + Groq Whisper STT" -ForegroundColor Cyan
Write-Host "Web QR & Status : http://localhost:3005/qr" -ForegroundColor Yellow
Write-Host "==========================================================`n" -ForegroundColor Green

node whatsapp-personal.js
