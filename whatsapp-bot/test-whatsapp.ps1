# test-whatsapp.ps1 — Test WhatsApp Voice Bot Endpoints
$ErrorActionPreference = "Continue"

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "   WhatsApp Voice Agent — Endpoints Test" -ForegroundColor Cyan
Write-Host "=======================================================`n" -ForegroundColor Cyan

# 1. Health Check
Write-Host "[1/3] Testing GET /health..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:8000/health" -Method Get -TimeoutSec 3
    Write-Host "  ✅ Status: $($health.status)" -ForegroundColor Green
    Write-Host "  ✅ Config: $($health.config | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Server not running on http://localhost:8000" -ForegroundColor Red
    Write-Host "     Start it with: cd whatsapp-bot && python main.py" -ForegroundColor Gray
}

# 2. Webhook Verification Test (hub.challenge)
Write-Host "`n[2/3] Testing GET /webhook (Meta Handshake)..." -ForegroundColor Yellow
try {
    # Check if VERIFY_TOKEN is in .env or default test
    $challenge = "verify_test_code_98765"
    $token = "my_custom_secret"
    if (Test-Path "whatsapp-bot/.env") {
        $envMatch = Get-Content "whatsapp-bot/.env" | Where-Object { $_ -match "^VERIFY_TOKEN=(.*)" }
        if ($envMatch) { $token = $matches[1].Trim() }
    }
    $url = "http://localhost:8000/webhook?hub.mode=subscribe&hub.challenge=$challenge&hub.verify_token=$token"
    $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 3
    if ($response -eq $challenge) {
        Write-Host "  ✅ Webhook Challenge Verified! Echoed: $response" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️ Received: $response" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️ Token mismatch or server unreachable: $_" -ForegroundColor Yellow
}

# 3. Interactive Docs
Write-Host "`n[3/3] Interactive Swagger API Docs:" -ForegroundColor Yellow
Write-Host "  🌐 http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "`n=======================================================`n" -ForegroundColor Cyan
