# Start Server Script
Write-Host "Starting server..." -ForegroundColor Green

# Kill any existing processes on common ports
Write-Host "Checking for existing server processes..." -ForegroundColor Yellow
$ports = @(3000, 9876, 5000)
foreach ($port in $ports) {
    try {
        $connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($connection) {
            $processId = $connection.OwningProcess
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if ($process -and $process.ProcessName -eq "node") {
                Write-Host "Killing Node.js process on port $port (PID: $processId)..." -ForegroundColor Yellow
                Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        # Port not in use, continue
    }
}

Set-Location -Path "server2\server"
npm start
