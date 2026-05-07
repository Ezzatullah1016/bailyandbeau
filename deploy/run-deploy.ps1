<#
    deploy/run-deploy.ps1 — push the repo to the EC2 box and run deploy.sh

    Usage (PowerShell, from repo root):
        ./deploy/run-deploy.ps1

    Optional overrides:
        ./deploy/run-deploy.ps1 -ServerIp 16.16.146.231 -User ubuntu -Pem .\backend\keys\deployment.pem -Bootstrap

    Requires OpenSSH client (built-in on Win10+).  No 3rd-party tools needed.
    The .pem file is read locally only and never uploaded.
#>

param(
    [string]$ServerIp = '16.16.146.231',
    [string]$User     = 'ubuntu',
    [string]$Pem      = 'backend/keys/deployment.pem',
    [string]$RemoteDir = '/opt/baileybeau',
    [switch]$Bootstrap   # Run server-bootstrap.sh on the first deploy
)

$ErrorActionPreference = 'Stop'

# 1. Resolve and validate the .pem
$Pem = (Resolve-Path -LiteralPath $Pem).Path
Write-Host "[deploy] Using key: $Pem"
if (-not (Test-Path -LiteralPath $Pem)) {
    throw "PEM not found at $Pem"
}

# Tighten permissions so OpenSSH on Windows accepts it
icacls $Pem /inheritance:r          | Out-Null
icacls $Pem /grant:r "$($env:UserName):(R)" | Out-Null
icacls $Pem /remove:g "BUILTIN\Users" "Authenticated Users" "Everyone" 2>$null | Out-Null

$Target = "$User@$ServerIp"
$SshOpts = @('-i', $Pem, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=~/.ssh/known_hosts')

# 2. Sanity SSH
Write-Host "[deploy] Testing SSH to $Target ..."
& ssh @SshOpts $Target 'echo "ok: $(hostname) $(uname -srm)"'
if ($LASTEXITCODE -ne 0) { throw 'SSH connection failed.' }

# 3. Optional first-time bootstrap
if ($Bootstrap) {
    Write-Host "[deploy] Bootstrapping server (one-time)..."
    & scp @SshOpts 'deploy/server-bootstrap.sh' "${Target}:/tmp/server-bootstrap.sh"
    if ($LASTEXITCODE -ne 0) { throw 'scp bootstrap failed.' }
    & ssh @SshOpts $Target 'bash /tmp/server-bootstrap.sh && rm -f /tmp/server-bootstrap.sh'
    if ($LASTEXITCODE -ne 0) { throw 'bootstrap failed.' }
}

# 4. Sync code (no git history, no node_modules, no venv, no secrets)
Write-Host "[deploy] Ensuring remote dir $RemoteDir ..."
& ssh @SshOpts $Target "sudo mkdir -p $RemoteDir && sudo chown -R ${User}:${User} $RemoteDir"

$RsyncBin = (Get-Command rsync -ErrorAction SilentlyContinue)?.Source
if ($RsyncBin) {
    Write-Host "[deploy] rsync code -> $Target:$RemoteDir/"
    $excludes = @(
        '--exclude=.git/',
        '--exclude=node_modules/',
        '--exclude=.venv/',
        '--exclude=.next/',
        '--exclude=backend/keys/',
        '--exclude=*.pem',
        '--exclude=*.sqlite3',
        '--exclude=backend/media/',
        '--exclude=backend/.env',
        '--exclude=frontend/.env.local',
        '--exclude=frontend/.env.production.local',
        '--exclude=__pycache__/'
    )
    & rsync -az --delete -e "ssh -i `"$Pem`" -o StrictHostKeyChecking=accept-new" `
        @excludes ./ "${Target}:$RemoteDir/"
    if ($LASTEXITCODE -ne 0) { throw 'rsync failed.' }
} else {
    Write-Host "[deploy] rsync not found — falling back to tar+ssh"
    $tar = Join-Path $env:TEMP "baileybeau-deploy.tgz"
    if (Test-Path $tar) { Remove-Item $tar -Force }

    # tar excludes (Windows tar is bsdtar)
    & tar `
        --exclude=.git `
        --exclude=node_modules `
        --exclude=.venv `
        --exclude=.next `
        --exclude=backend/keys `
        --exclude=*.pem `
        --exclude=*.sqlite3 `
        --exclude=backend/media `
        --exclude=backend/.env `
        --exclude=frontend/.env.local `
        --exclude=frontend/.env.production.local `
        --exclude=__pycache__ `
        -czf $tar .
    if ($LASTEXITCODE -ne 0) { throw 'tar failed.' }

    & scp @SshOpts $tar "${Target}:/tmp/baileybeau.tgz"
    & ssh @SshOpts $Target "tar -xzf /tmp/baileybeau.tgz -C $RemoteDir && rm -f /tmp/baileybeau.tgz"
    Remove-Item $tar -Force
}

# 5. Run remote deploy
Write-Host "[deploy] Running remote deploy.sh ..."
& ssh @SshOpts $Target "bash $RemoteDir/deploy/deploy.sh"
if ($LASTEXITCODE -ne 0) { throw 'remote deploy.sh failed.' }

Write-Host ""
Write-Host "[deploy] Done. Open http://$ServerIp/ in a browser."
