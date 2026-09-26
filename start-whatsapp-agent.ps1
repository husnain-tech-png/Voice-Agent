# start-whatsapp-agent.ps1
# Starts the Personal WhatsApp Voice Agent with QR pairing, Charlie voice & Urdu intelligence
$ErrorActionPreference = "Continue"

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  Starting Personal WhatsApp AI Voice Agent (Charlie Voice)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Target Number   : +923154483615" -ForegroundColor Cyan
Write-Host "Voice Engine    : ElevenLabs Charlie (IKne3meq5aSn9XLyUdCD) + Edge Male Fallback" -ForegroundColor Cyan
Write-Host "Languages       : Natural Pakistani Urdu + English" -ForegroundColor Cyan
Write-Host "Brain & Ears    : Groq LLM + Groq Whisper Multilingual STT" -ForegroundColor Cyan
Write-Host "Web QR & Status : http://localhost:3005/qr" -ForegroundColor Yellow
Write-Host "Live Call Studio: http://localhost:3000" -ForegroundColor Yellow
Write-Host "==========================================================`n" -ForegroundColor Green

node whatsapp-personal.js
