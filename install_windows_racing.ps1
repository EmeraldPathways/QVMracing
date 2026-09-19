$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot
if (-not (Test-Path "$ProjectRoot\.venv")) { py -3 -m venv .venv }
& "$ProjectRoot\.venv\Scripts\python.exe" -m pip install --upgrade pip
& "$ProjectRoot\.venv\Scripts\python.exe" -m pip install -r requirements-racing.txt
Write-Host "QVM Racing Worker installed in $ProjectRoot\.venv"
