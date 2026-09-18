# Test script for your AI Voice Agent Backend
$body = @{ message = "Hello" } | ConvertTo-Json
Write-Host "Sending: 'Hello' to http://localhost:3000/chat..." -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/chat" -Method Post -ContentType "application/json" -Body $body
    Write-Host "`nServer Response:" -ForegroundColor Green
    $response | Format-List
} catch {
    Write-Host "`nError contacting server:" -ForegroundColor Red
    Write-Host $_.Exception.Message
}
