param([switch]$Once)
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot
if (-not (Test-Path "$ProjectRoot\.venv\Scripts\python.exe")) { throw "Racing worker environment is not installed. Run install_windows_racing.ps1 first." }
$Python = "$ProjectRoot\.venv\Scripts\python.exe"
if ($Once) { & $Python -m racing.worker_service; exit $LASTEXITCODE }
while ($true) { & $Python -m racing.worker_service; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Start-Sleep -Seconds 300 }
