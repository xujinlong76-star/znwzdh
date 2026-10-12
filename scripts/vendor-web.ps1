# Fetch the NavSphere base into apps/web and wire in the NavHub storage adapter.
#
# Why this is a script instead of a checked-in copy:
#   keeping the upstream base out of git keeps this repo focused on NavHub-specific
#   code and makes updating from upstream a single command.
#
# ASCII only on purpose -- Windows PowerShell 5.1 reads .ps1 as ANSI.

param([string]$Ref = "main")
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root "apps\web"
$refPath = Join-Path $target "UPSTREAM.md"

Write-Host "[vendor-web] target: $target"

# 1) download upstream tarball
$tmp = Join-Path $env:TEMP ("navsphere-" + [guid]::NewGuid().ToString("N") + ".tar.gz")
$url = "https://codeload.github.com/tianyaxiang/NavSphere/tar.gz/refs/heads/$Ref"
Write-Host "[vendor-web] downloading $url"
Invoke-WebRequest -Uri $url -OutFile $tmp -TimeoutSec 300

# 2) extract to a temp dir
$stage = Join-Path $env:TEMP ("navsphere-stage-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
tar -xzf $tmp -C $stage
$inner = Get-ChildItem -Directory $stage | Select-Object -First 1
if (-not $inner) { throw "extraction produced no directory" }

# 3) remember the upstream revision
$sha = "unknown"
try {
  $sha = (Invoke-RestMethod -Uri "https://api.github.com/repos/tianyaxiang/NavSphere/commits/$Ref" -Headers @{ "User-Agent" = "navhub" } -TimeoutSec 60).sha
} catch { Write-Host "[vendor-web] could not resolve upstream sha, continuing" }

# 4) keep NavHub-owned files, copy the rest from upstream
$keep = @("src", ".gitignore")
$preserve = @()
 foreach ($k in $keep) {
  $p = Join-Path $target $k
  if (Test-Path $p) { $preserve += $p }
}

# adapter file must survive the copy
$adapterSrc = Join-Path $target "src\lib\storage-adapter.ts"
$adapterBackup = $null
if (Test-Path $adapterSrc) {
  $adapterBackup = Join-Path $env:TEMP ("navhub-adapter-" + [guid]::NewGuid().ToString("N") + ".ts")
  Copy-Item $adapterSrc $adapterBackup -Force
}

Write-Host "[vendor-web] copying upstream files"
Get-ChildItem -Path $inner.FullName -Force | ForEach-Object {
  Copy-Item $_.FullName -Destination $target -Recurse -Force
}

# 5) restore NavHub-owned files
if ($adapterBackup) {
  New-Item -ItemType Directory -Force -Path (Join-Path $target "src\lib") | Out-Null
  Copy-Item $adapterBackup $adapterSrc -Force
  Remove-Item $adapterBackup -Force
  Write-Host "[vendor-web] restored src/lib/storage-adapter.ts"
}

@(
  "# NavSphere upstream"
  ""
  "This directory is derived from [NavSphere](https://github.com/tianyaxiang/NavSphere) (MIT licensed)."
  ""
  "- Upstream ref: ``$Ref``"
  "- Upstream commit: ``$sha``"
  "- Vendored at: $(Get-Date -Format o)"
  "- Re-vendor with: ``. ./scripts/vendor-web.ps1``"
  ""
  "NavHub-owned files in this directory (do not overwrite from upstream):"
  "- ``src/lib/storage-adapter.ts`` -- storage seam (github | http | sqlite)"
  ""
) -join "`n" | Set-Content -Path $refPath -Encoding UTF8

Remove-Item $tmp, $stage -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "[vendor-web] done -- base in $target, upstream $sha"
Write-Host "[vendor-web] NEXT: wire the adapter into src/lib/github.ts (see README section 1)"
