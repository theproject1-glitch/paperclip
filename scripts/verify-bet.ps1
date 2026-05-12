param(
  [string]$RunId,
  [string]$CompanyId = "b94fed82-38bf-4eb3-81d8-9b1a8aa84921",
  [string]$BaseUrl = "http://localhost:3100",
  [int]$Limit = 20
)

$ErrorActionPreference = "Stop"

$health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 5
Write-Host "Server: OK ($($health.status))"

function First-NonEmpty {
  param($A, $B, $Default = $null)
  if ($null -ne $A -and "$A" -ne "") { return $A }
  if ($null -ne $B -and "$B" -ne "") { return $B }
  return $Default
}

$uri = "$BaseUrl/api/companies/$CompanyId/bba-memory/recent-runs?all=true&limit=$Limit"
$recent = Invoke-RestMethod -Uri $uri -TimeoutSec 10
$runs = if ($recent.runs) { $recent.runs } else { $recent }
if ($RunId) {
  $runs = $runs | Where-Object { "$($_.id)" -eq "$RunId" -or "$($_.runId)" -eq "$RunId" }
}

if (-not $runs) {
  Write-Host "No BBA Memory runs found for the requested filter."
} else {
  $runs | Select-Object -First $Limit | ForEach-Object {
    $displayId = First-NonEmpty $_.id $_.runId
    $failure = First-NonEmpty $_.failureClass $_.failure_class "-"
    $started = First-NonEmpty $_.startedAt $_.started_at
    Write-Host ""
    Write-Host "Run: $displayId"
    Write-Host "  Source:  $($_.source)"
    Write-Host "  Trigger: $($_.trigger)"
    Write-Host "  Outcome: $($_.outcome)"
    Write-Host "  Failure: $failure"
    Write-Host "  Started: $started"
    Write-Host "  Notes:   $($_.notes)"
    if ($_.artifactDir) { Write-Host "  Artifacts: $($_.artifactDir)" }
    if ($_.logPath) { Write-Host "  Log:       $($_.logPath)" }
  }
}

Write-Host ""
Write-Host "Manual Casa verification checklist:"
Write-Host "  1. Open the already-debuggable Chrome window."
Write-Host "  2. Open Casa Pariurilor -> Pariurile mele / Bilete plasate."
Write-Host "  3. Confirm match, market, selection, stake, and timestamp."
Write-Host "  4. Confirm the account balance delta matches the stake."
