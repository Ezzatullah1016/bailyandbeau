<#
    deploy/run-deploy.ps1 — deploy the latest origin/main onto EC2.

    Usage (PowerShell, from repo root):
        ./deploy/run-deploy.ps1                   # default: ubuntu@16.16.146.231
        ./deploy/run-deploy.ps1 -Push             # also git push first

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

$Pem = (Resolve-Path -LiteralPath $Pem).Path
if (-not (Test-Path -LiteralPath $Pem)) { throw "PEM not found at $Pem" }

# OpenSSH on Windows refuses world-readable keys; tighten to current user only.
icacls $Pem /inheritance:r 2>&1 | Out-Null
icacls $Pem /grant:r "$($env:UserName):(R)" 2>&1 | Out-Null
icacls $Pem /remove:g "BUILTIN\Users" "Authenticated Users" "Everyone" 2>&1 | Out-Null

$Target  = "$User@$ServerIp"
$SshOpts = @('-i', $Pem, '-o', 'StrictHostKeyChecking=accept-new')

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
