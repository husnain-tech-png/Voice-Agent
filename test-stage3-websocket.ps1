# Test script for Stage 3: Real-Time Streaming WebSockets (<500ms Delay)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "⚡ Stage 3: Real-Time WebSocket Streaming Test Runner" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# Check if backend server is responsive
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get -TimeoutSec 3 -ErrorAction Stop
    Write-Host "Backend Server Status: $($health.status) (WebSocket: $($health.stage3.wsPath))" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Backend is not running on http://localhost:3000!" -ForegroundColor Yellow
    Write-Host "Please ensure 'node server.js' or 'npm run dev' is running in another terminal." -ForegroundColor Yellow
}

Write-Host "Executing Stage 3 WebSocket Streaming Verification..." -ForegroundColor Cyan
node test-stage3-ws.js

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n🎉 Stage 3 Real-Time WebSocket Test Completed Successfully!" -ForegroundColor Green
} else {
    Write-Host "`n❌ Stage 3 Test Failed. Please check server logs." -ForegroundColor Red
}
