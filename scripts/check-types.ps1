# Standalone type-check runner — bypasses shell cwd issues
$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptRoot
Write-Host "[check-types] cwd: $root"
Set-Location -LiteralPath $root
& pnpm exec vue-tsc --noEmit
Write-Host "[check-types] exit: $LASTEXITCODE"
exit $LASTEXITCODE
