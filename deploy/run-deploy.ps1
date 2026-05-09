<#
    deploy/run-deploy.ps1 — deploy the latest origin/main onto EC2.

    Usage (PowerShell, from repo root):
        ./deploy/run-deploy.ps1                   # ubuntu@16.16.146.231 + PEM (see below)
        ./deploy/run-deploy.ps1 -Push             # also git push first
        ./deploy/run-deploy.ps1 -Pem path\to\key.pem   # optional explicit key
        ./deploy/run-deploy.ps1 -User ubuntu       # default SSH user (Ubuntu EC2 AMI)

    SSH user defaults to "ubuntu" (standard Ubuntu cloud images). Use -User only if your server uses another account.

    PEM resolution (repo root = parent of deploy/):
      1) -Pem if passed and exists (relative to repo root or absolute)
      2) backend/keys/deployment.pem
      3) baileyandbeauco-key.pem in repo root

    Server contract (already provisioned, see deploy/update.sh):
      - /home/ubuntu/app  is a clone of this repo, branch main
      - gunicorn (systemd) backend, pm2 'bailyandbeau-frontend' on :3001
      - nginx terminates TLS on :443
#>

param(
    [string]$ServerIp = '16.16.146.231',
    [string]$User     = 'ubuntu',
    [string]$Pem      = 'backend/keys/deployment.pem',
    [string]$AppDir   = '/home/ubuntu/app',
    [switch]$Push
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
function Resolve-DeployPemPath {
  param([string]$PemArg, [string]$Root)
  $tryPaths = @()
  if ([System.IO.Path]::IsPathRooted($PemArg)) {
    $tryPaths += $PemArg
  } else {
    $tryPaths += (Join-Path $Root ($PemArg -replace '/', [IO.Path]::DirectorySeparatorChar))
  }
  $fallback = Join-Path $Root 'baileyandbeauco-key.pem'
  foreach ($p in $tryPaths) {
    if (Test-Path -LiteralPath $p) { return (Resolve-Path -LiteralPath $p).Path }
  }
  if ((Test-Path -LiteralPath $fallback) -and ($tryPaths[0] -ne $fallback)) {
    Write-Host "[deploy] Using baileyandbeauco-key.pem (backend/keys/deployment.pem not found)"
    return (Resolve-Path -LiteralPath $fallback).Path
  }
  throw "PEM not found. Tried: $($tryPaths -join ', ') and $fallback"
}

$Pem = Resolve-DeployPemPath -PemArg $Pem -Root $RepoRoot

# OpenSSH on Windows refuses world-readable keys; tighten to current user only.
icacls $Pem /inheritance:r 2>&1 | Out-Null
icacls $Pem /grant:r "$($env:UserName):(R)" 2>&1 | Out-Null
icacls $Pem /remove:g "BUILTIN\Users" "Authenticated Users" "Everyone" 2>&1 | Out-Null

$Target  = "$User@$ServerIp"
$SshOpts = @('-i', $Pem, '-o', 'StrictHostKeyChecking=accept-new')

Write-Host "[deploy] SSH user: $User | key: $Pem"

if ($Push) {
    Write-Host '[deploy] git push origin HEAD'
    & git push origin HEAD
    if ($LASTEXITCODE -ne 0) { throw 'git push failed.' }
}

Write-Host "[deploy] SSH to $Target ..."
& ssh @SshOpts $Target "echo 'connected: '`$(hostname); test -d $AppDir || { echo 'app dir missing'; exit 1; }"
if ($LASTEXITCODE -ne 0) { throw 'SSH check failed.' }

Write-Host '[deploy] running update.sh on server ...'
& ssh @SshOpts $Target "bash $AppDir/deploy/update.sh"
if ($LASTEXITCODE -ne 0) { throw 'remote update.sh failed.' }

Write-Host ''
Write-Host '[deploy] Done.'
Write-Host "  App:    https://$ServerIp/"
Write-Host "  Admin:  https://$ServerIp/super-admin/"
Write-Host "  Health: https://$ServerIp/api/v1/health/"
