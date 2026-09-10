$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
    $feigeHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8766/health' -TimeoutSec 2
    if ($feigeHealth.data.service -eq 'web-context-agent-bridge') {
        Write-Host 'Feige is already running: http://127.0.0.1:8766/mcp'
        exit 0
    }
    throw 'Port 8766 is occupied by another service.'
} catch {
    if (Get-NetTCPConnection -State Listen -LocalPort 8766 -ErrorAction SilentlyContinue) {
        Write-Error 'Port 8766 is occupied. Stop the other service or inspect it before retrying.'
        exit 1
    }
}
$feigePython = Get-Command python -ErrorAction SilentlyContinue
if (-not $feigePython) {
    Write-Error 'Python 3.10+ is required. Install Python and server/requirements.txt first.'
    exit 1
}
& $feigePython.Source -c 'import fastapi, uvicorn, mcp'
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Install dependencies: python -m pip install -r server/requirements.txt'
    exit 1
}
Write-Host 'Feige MCP: http://127.0.0.1:8766/mcp'
Write-Host 'Keep this window open while using Feige. Ctrl+C stops the service.'
& $feigePython.Source -m server.run
exit $LASTEXITCODE
