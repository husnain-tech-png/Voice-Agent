# start-tunnel.ps1 — Keep-Alive Auto-Restarting Tunnel for Webhooks
$ErrorActionPreference = "Continue"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  Starting Persistent Tunnel: https://voice-agent-husnain.loca.lt" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

while ($true) {
    try {
        npx localtunnel --port 3000 --subdomain voice-agent-husnain
    } catch {
        Write-Host "[TUNNEL WARNING] Tunnel disconnected. Reconnecting in 2s..." -ForegroundColor Yellow
    }
    Start-Sleep -Seconds 2
}
