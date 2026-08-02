# Adds backend\.venv\Scripts to PATH for this PowerShell session.
# Run from repo root:  .\deploy\eb-use-venv.ps1
#
# AWS CLI (if aws.cmd breaks): & $python -m awscli --version

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$venvScripts = Join-Path $repoRoot 'backend\.venv\Scripts'
$pythonExe = Join-Path $venvScripts 'python.exe'

if (-not (Test-Path $pythonExe)) {
    Write-Host 'Missing backend\.venv - create with: cd backend ; python -m venv .venv'
    exit 1
}

# Avoid "$a;$b" inside one string (some editors save Unicode quotes that break parsing)
$env:PATH = $venvScripts + ';' + $env:PATH

Write-Host ('PATH prepended with: ' + $venvScripts)
Write-Host ''
Write-Host 'Examples:'
Write-Host '  eb --version'
Write-Host ('  & ''' + $pythonExe + ''' -m awscli --version')
Write-Host ''
Write-Host 'Configure AWS (interactive, needs IAM keys):'
Write-Host ('  & ''' + $pythonExe + ''' -m awscli configure')
Write-Host ''
Write-Host 'Elastic Beanstalk (run from backend folder):'
Write-Host '  cd .\backend'
Write-Host '  eb init'
Write-Host '  eb create bailey-beau-backend-env'
