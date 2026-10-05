#Requires -Version 5.1
# Chrome'u CDP (uzaktan hata ayiklama) portuyla baslatir — YEDEK YOL.
# Asil yol eklentidir (grup acar). CDP grup acamaz ama sekme acip listeleyebilir.
# Kullanim: powershell -ExecutionPolicy Bypass -File start-chrome-debug.ps1
$port = if ($env:CUDEALL_CDP_PORT) { $env:CUDEALL_CDP_PORT } else { 9222 }
$profile = Join-Path $env:TEMP "cudeall-chrome-profile"
if (-not (Test-Path -LiteralPath $profile)) { New-Item -ItemType Directory -Path $profile | Out-Null }
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chrome) { Write-Error "Chrome bulunamadi."; exit 1 }
Write-Host "Baslatiliyor: $chrome (port $port, profil $profile)"
& "$chrome" "--remote-debugging-port=$port" "--user-data-dir=$profile" "about:blank"
