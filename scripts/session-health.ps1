param(
  [string]$CompanyId = "b94fed82-38bf-4eb3-81d8-9b1a8aa84921",
  [string]$BaseUrl = "http://localhost:3100",
  [int]$ChromeDebugPort = 9222
)

$ErrorActionPreference = "Continue"

function First-NonEmpty {
  param($A, $B, $Default = $null)
  if ($null -ne $A -and "$A" -ne "") { return $A }
  if ($null -ne $B -and "$B" -ne "") { return $B }
  return $Default
}

Write-Host "=== Paperclip Server ==="
try {
  $health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 5
  $health | ConvertTo-Json -Depth 5
} catch {
  Write-Host "Server health failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "=== Chrome CDP ==="
try {
  $cdp = Invoke-RestMethod -Uri "http://localhost:$ChromeDebugPort/json/version" -TimeoutSec 5
  Write-Host "Chrome debug endpoint: $($cdp.Browser)"
  $tabs = Invoke-RestMethod -Uri "http://localhost:$ChromeDebugPort/json" -TimeoutSec 5
  $casaTabs = $tabs | Where-Object { $_.url -match "casapariurilor" }
  Write-Host "Casa tabs: $($casaTabs.Count)"
  $casaTabs | ForEach-Object { Write-Host "  $($_.title) - $($_.url)" }
} catch {
  Write-Host "Chrome CDP failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "=== BBA Memory DB ==="
$dbPath = Join-Path $env:USERPROFILE ".paperclip\bba-memory\bba-memory.db"
if (Test-Path $dbPath) {
  $item = Get-Item $dbPath
  Write-Host "Path: $dbPath"
  Write-Host "Size: $($item.Length) bytes"
  Write-Host "Modified: $($item.LastWriteTime)"
} else {
  Write-Host "Missing: $dbPath"
}

Write-Host ""
Write-Host "=== Recent BBA Runs ==="
try {
  $recent = Invoke-RestMethod -Uri "$BaseUrl/api/companies/$CompanyId/bba-memory/recent-runs?all=true&limit=5" -TimeoutSec 10
  $runs = if ($recent.runs) { $recent.runs } else { $recent }
  $runs | ForEach-Object {
    $displayId = First-NonEmpty $_.id $_.runId
    $failure = First-NonEmpty $_.failureClass $_.failure_class "-"
    $started = First-NonEmpty $_.startedAt $_.started_at
    Write-Host "  ${displayId}: outcome=$($_.outcome), failure=$failure, started=$started"
  }
} catch {
  Write-Host "Recent BBA runs failed: $($_.Exception.Message)"
}
