$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a stable semantic version in package.json.' }
$webRoot = Join-Path $projectRoot 'out\mugao'
if (-not (Test-Path -LiteralPath (Join-Path $webRoot 'index.html'))) {
  throw 'Run npm run build:static before packaging.'
}
$releaseRoot = Join-Path $projectRoot "releases\v$version"
[void](New-Item -ItemType Directory -Path $releaseRoot -Force)
$archiveName = "mugao-v$version-web.zip"
$archivePath = Join-Path $releaseRoot $archiveName
if (Test-Path -LiteralPath $archivePath) { throw "Release package already exists: $archiveName" }
Compress-Archive -LiteralPath @(
  $webRoot,
  (Join-Path $projectRoot 'docs\STATIC_PACKAGE.md'),
  (Join-Path $projectRoot 'LICENSE')
) -DestinationPath $archivePath -CompressionLevel Optimal
$checksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
"$checksum  $archiveName" | Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Encoding utf8NoBOM
Write-Output "Packaged releases/v$version/$archiveName"
