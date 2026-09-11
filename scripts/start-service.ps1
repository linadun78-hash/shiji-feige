param([ValidateSet('start','stop','status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$feigePython = Get-Command python -ErrorAction SilentlyContinue
if (-not $feigePython) {
    Write-Error 'Python 3.10+ is required. Install Python and server/requirements.txt first.'
    exit 1
}
& $feigePython.Source -m server.desktop $Action
if ($LASTEXITCODE -ne 0) {
    Write-Host 'See %LOCALAPPDATA%\ShijiFeige\startup.log and service.log.'
    Write-Host 'For foreground diagnostics: python -m server.run'
    exit 1
}
if ($Action -eq 'start') { Write-Host 'Feige is running in the background. You can close this window.' }
