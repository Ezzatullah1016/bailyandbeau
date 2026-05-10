<#
  Copies reading-room-vhost-install.sh to EC2 and runs it with sudo.
  From repo root:
    ./deploy/reading-room-from-laptop.ps1
    $env:CERTBOT_EMAIL='you@baileyandbeauco.com'; ./deploy/reading-room-from-laptop.ps1

  Requires:
  - SSH port 22 open to YOUR IP (or 0.0.0.0/0) on the instance security group
  - baileyandbeaukey.pem, baileyandbeauco-key.pem, or backend/keys/deployment.pem (same resolution as run-deploy.ps1)
  - DNS A record: reading-room.baileyandbeauco.com -> instance IP

  If a cert already exists under /etc/letsencrypt/live/ (subdomain or apex), nginx is configured
  without needing CERTBOT_EMAIL.
#>

param(
    [string]$ServerIp = '51.21.140.88',
    [string]$User     = 'ubuntu',
    [string]$Pem      = 'backend/keys/deployment.pem'
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
function Resolve-DeployPemPath {
  param([string]$PemArg, [string]$Root)
  $primary = if ([System.IO.Path]::IsPathRooted($PemArg)) {
    $PemArg
  } else {
    (Join-Path $Root ($PemArg -replace '/', [IO.Path]::DirectorySeparatorChar))
  }
  $candidates = [System.Collections.Generic.List[string]]::new()
  foreach ($p in @(
      $primary,
      (Join-Path $Root 'baileyandbeauco-key.pem'),
      (Join-Path $Root 'baileyandbeaukey.pem')
    )) {
    if (-not $candidates.Contains($p)) { [void]$candidates.Add($p) }
  }
  foreach ($p in $candidates) {
    if (Test-Path -LiteralPath $p) {
      if ($p -ne $primary) { Write-Host "[reading-room] Using PEM: $p" }
      return (Resolve-Path -LiteralPath $p).Path
    }
  }
  throw "PEM not found. Tried: $($candidates -join ', ')"
}

$Pem = Resolve-DeployPemPath -PemArg $Pem -Root $RepoRoot
icacls $Pem /inheritance:r 2>&1 | Out-Null
icacls $Pem /grant:r "$($env:UserName):(R)" 2>&1 | Out-Null
icacls $Pem /remove:g "BUILTIN\Users" "Authenticated Users" "Everyone" 2>&1 | Out-Null

$SshBase = @('-i', $Pem, '-o', 'StrictHostKeyChecking=accept-new')
$Target  = "${User}@${ServerIp}"
$LocalSh = Join-Path $PSScriptRoot 'reading-room-vhost-install.sh'
if (-not (Test-Path -LiteralPath $LocalSh)) { throw "Missing $LocalSh" }

Write-Host "[reading-room] SCP install script → ${Target}:/tmp/ …"
& scp @SshBase $LocalSh "${Target}:/tmp/reading-room-vhost-install.sh"
if ($LASTEXITCODE -ne 0) { throw 'scp failed (SSH unreachable or key rejected?).' }

$email = $env:CERTBOT_EMAIL
if ([string]::IsNullOrWhiteSpace($email)) {
  Write-Host "[reading-room] CERTBOT_EMAIL not set — remote script will only obtain cert if none exists; if no cert on server, set env var and re-run."
  Write-Host '[reading-room] Remote: sudo bash /tmp/reading-room-vhost-install.sh'
  & ssh @SshBase $Target "chmod +x /tmp/reading-room-vhost-install.sh && sudo bash /tmp/reading-room-vhost-install.sh"
} else {
  Write-Host "[reading-room] Running with CERTBOT_EMAIL for new certs if needed…"
  & ssh @SshBase $Target "chmod +x /tmp/reading-room-vhost-install.sh && sudo CERTBOT_EMAIL='$email' bash /tmp/reading-room-vhost-install.sh"
}

if ($LASTEXITCODE -ne 0) { throw 'Remote reading-room-vhost-install.sh failed.' }
Write-Host '[reading-room] Done. Try https://reading-room.baileyandbeauco.com/ in the browser.'
