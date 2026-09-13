$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'node_modules\electron\dist'
$cache = Join-Path $env:LOCALAPPDATA 'electron\Cache'
$zip = Get-ChildItem -Path $cache -Recurse -Filter 'electron-v33*-win32-x64.zip' | Select-Object -First 1
if (-not $zip) { throw "no cached electron zip under $cache" }
Write-Output "using $($zip.FullName)"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist -Force | Out-Null
Expand-Archive -Path $zip.FullName -DestinationPath $dist -Force
Set-Content -Path (Join-Path $root 'node_modules\electron\path.txt') -Value 'electron.exe' -NoNewline
if (Test-Path (Join-Path $dist 'electron.exe')) { Write-Output 'ELECTRON-OK' } else { Write-Output 'ELECTRON-MISSING' }
