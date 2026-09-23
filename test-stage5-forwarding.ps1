# Stage 5: Mobile Call Forwarding & SMS Summaries - Test Runner
# Usage: .\test-stage5-forwarding.ps1

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  Stage 5: Mobile Call Forwarding & SMS Summaries"     -ForegroundColor Cyan
Write-Host "  Automated Test Suite Runner"                          -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# Check if server is running
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method GET -TimeoutSec 5
    Write-Host "[OK] Server is running on http://localhost:3000" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "[ERROR] Server is not running on http://localhost:3000" -ForegroundColor Red
    Write-Host "Start the server first with: npm run dev" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# Run the Node.js test suite
Write-Host "Running Stage 5 test suite..." -ForegroundColor Yellow
Write-Host ""

node test-stage5-forwarding.js

$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "=====================================================" -ForegroundColor Green
    Write-Host "  ALL STAGE 5 TESTS PASSED!" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Green
} else {
    Write-Host "=====================================================" -ForegroundColor Red
    Write-Host "  SOME TESTS FAILED - Check output above" -ForegroundColor Red
    Write-Host "=====================================================" -ForegroundColor Red
}
Write-Host ""

exit $exitCode
