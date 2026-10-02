# UNFOLDIQ Flow Bridge launcher — runs npm run flow:bridge from the repo root
# (resolved from this script's own location, no hard-coded project path).
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path "./package.json")) {
    throw "Khong tim thay package.json tai thu muc du an."
}

Write-Host "Starting UNFOLDIQ Flow Bridge..."

npm run flow:bridge
