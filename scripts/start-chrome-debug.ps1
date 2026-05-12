param(
  [int]$DebugPort = 9222
)

$ErrorActionPreference = "Stop"

function Test-ChromeDebugPort {
  param([int]$Port)
  try {
    return Invoke-RestMethod -Uri "http://localhost:$Port/json/version" -TimeoutSec 3
  } catch {
    return $null
  }
}

$existing = Test-ChromeDebugPort -Port $DebugPort
if ($existing) {
  Write-Host "Chrome debug endpoint already ready on port ${DebugPort}: $($existing.Browser)"
  exit 0
}

$chromePaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) }

if (-not $chromePaths) {
  throw "Google Chrome executable was not found in the standard install locations."
}

$runningChrome = Get-Process chrome -ErrorAction SilentlyContinue
if ($runningChrome) {
  Write-Warning "Chrome is already running, but remote debugging is not available on port $DebugPort."
  Write-Warning "Close Chrome manually, then rerun this script so the existing user profile starts with --remote-debugging-port."
  Write-Warning "This script will not kill Chrome for you because it may contain active user work."
  exit 1
}

$chromePath = $chromePaths[0]
$userDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$args = @(
  "--remote-debugging-port=$DebugPort",
  "--user-data-dir=`"$userDataDir`"",
  "https://www.casapariurilor.ro/"
)

Start-Process -FilePath $chromePath -ArgumentList $args -WindowStyle Normal
Start-Sleep -Seconds 3

$resp = Test-ChromeDebugPort -Port $DebugPort
if (-not $resp) {
  throw "Chrome started, but http://localhost:$DebugPort/json/version did not become available."
}

Write-Host "Chrome debug endpoint ready on port ${DebugPort}: $($resp.Browser)"
