$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$output = Join-Path $projectRoot ".extension-dist"

& npm.cmd run extension:build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

foreach ($browser in @("chromium", "firefox")) {
  $source = Join-Path $output $browser
  $manifest = Get-Content -LiteralPath (Join-Path $source "manifest.json") -Raw | ConvertFrom-Json
  $archive = Join-Path $output "schoolpp-$browser-$($manifest.version).zip"
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  Compress-Archive -Path (Join-Path $source "*") -DestinationPath $archive -CompressionLevel Optimal
}

Get-ChildItem -LiteralPath $output -Filter "*.zip" | Select-Object Name, Length
