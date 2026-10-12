# NavHub pnpm runner.
# This machine has no PowerShell Core (pwsh) and pnpm is not on PATH for
# non-interactive shells, so we locate the DSH-bundled runtime explicitly.
# NOTE: ASCII only on purpose -- Windows PowerShell 5.1 reads .ps1 as ANSI.
#
# Usage (Windows PowerShell only -- note the leading dot, which dot-sources
# the script so exit codes are preserved):
#   . ./scripts/run.ps1 install
#   . ./scripts/run.ps1 --filter @navhub/core test

param([Parameter(ValueFromRemainingArguments = $true)][string[]]$PnpmArgs)

$ErrorActionPreference = 'Stop'

$pnpm = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
if (-not (Test-Path $pnpm)) { throw "pnpm not found at $pnpm" }

$node = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path $node)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'node not found' }
  $node = $cmd.Source
}

Write-Host "[run.ps1] $node $pnpm $($PnpmArgs -join ' ')" -ForegroundColor DarkGray

& $node $pnpm @PnpmArgs
