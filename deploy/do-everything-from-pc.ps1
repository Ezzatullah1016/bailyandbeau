<#
  Run on YOUR Windows machine (where SSH to 51.21.140.88 works). From repo root:

    .\deploy\do-everything-from-pc.ps1
    .\deploy\do-everything-from-pc.ps1 -Push
    $env:CERTBOT_EMAIL='you@domain.com'; .\deploy\do-everything-from-pc.ps1

  Does:
    1) ./deploy/run-deploy.ps1 (optionally -Push) — git fetch on server + update.sh
    2) ./deploy/reading-room-from-laptop.ps1 — nginx vhost for reading-room subdomain (uses CERTBOT_EMAIL if no cert yet)

  PEM: baileyandbeauco-key.pem first (matches EC2 key pair "baileyandbeauco-key"), then baileyandbeaukey.pem.
  Cursor/agent sandboxes often cannot reach port 22; this script is for your local PC.
#>

param(
    [switch]$Push,
    [string]$CertbotEmail = ''
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

if ($CertbotEmail) {
    $env:CERTBOT_EMAIL = $CertbotEmail
}

Write-Host '=== [1/2] Deploy app (update.sh on server) ===' -ForegroundColor Cyan
$deployArgs = @('-File', (Join-Path $PSScriptRoot 'run-deploy.ps1'))
if ($Push) { $deployArgs += '-Push' }
& powershell -NoProfile -ExecutionPolicy Bypass @deployArgs
if ($LASTEXITCODE -ne 0) { throw 'run-deploy.ps1 failed.' }

Write-Host '=== [2/2] Nginx vhost reading-room.baileyandbeauco.com ===' -ForegroundColor Cyan
$rrArgs = @('-File', (Join-Path $PSScriptRoot 'reading-room-from-laptop.ps1'))
& powershell -NoProfile -ExecutionPolicy Bypass @rrArgs
if ($LASTEXITCODE -ne 0) { throw 'reading-room-from-laptop.ps1 failed.' }

Write-Host 'All steps finished.' -ForegroundColor Green
