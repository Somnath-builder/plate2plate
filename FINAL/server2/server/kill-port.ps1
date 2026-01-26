# Kill process on a specific port
param(
    [int]$Port = 9876
)

Write-Host "Checking for processes on port $Port..." -ForegroundColor Yellow

try {
    $connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($connection) {
        $processId = $connection.OwningProcess
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process) {
            Write-Host "Found process: $($process.ProcessName) (PID: $processId)" -ForegroundColor Yellow
            Stop-Process -Id $processId -Force
            Write-Host "Killed process on port $Port" -ForegroundColor Green
        }
    } else {
        Write-Host "No process found on port $Port" -ForegroundColor Green
    }
} catch {
    Write-Host "No process found on port $Port" -ForegroundColor Green
}
