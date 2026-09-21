# Test script for Stage 4: Phone Line Connection (Twilio Media Streams & Telephony)
Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Stage 4: Twilio Phone Line Connection Test Runner" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# Check backend server health and Stage 4 status
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get -TimeoutSec 3 -ErrorAction Stop
    Write-Host "[OK] Backend Server Status : $($health.status)" -ForegroundColor Green
    Write-Host "[OK] Stage 4 Telephony     : $($health.stage4.provider) Media Streams ($($health.stage4.audioEncoding))" -ForegroundColor Green
    Write-Host "[OK] Inbound Webhook       : $($health.stage4.incomingWebhookPath)" -ForegroundColor Green
    Write-Host "[OK] Media Stream Path     : $($health.stage4.mediaStreamWsPath)" -ForegroundColor Green
} catch {
    Write-Host "[WARN] Backend is not responding on http://localhost:3000!" -ForegroundColor Yellow
    Write-Host "Make sure the server is running: npm run dev or node server.js" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Executing Stage 4 Twilio Telephony Test Suite..." -ForegroundColor Cyan
node test-stage4-phone.js

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[SUCCESS] Stage 4 Phone Line Connection Verified Successfully!" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "[FAIL] Stage 4 Phone Line Test Encountered Issues. Check logs above." -ForegroundColor Red
    Write-Host ""
}
