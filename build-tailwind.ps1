$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cliPath = Join-Path $projectRoot 'tools\tailwindcss.exe'
$inputPath = Join-Path $projectRoot 'core\static_src\tailwind.input.css'
$outputPath = Join-Path $projectRoot 'core\static\core\css\tailwind.css'

if (-not (Test-Path $cliPath)) {
    throw "Tailwind CLI not found at $cliPath"
}

& $cliPath -i $inputPath -o $outputPath --config (Join-Path $projectRoot 'tailwind.config.js') --minify
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Output "Tailwind CSS built successfully at $outputPath"
