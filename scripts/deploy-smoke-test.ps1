param(
  [string]$BaseUrl = "http://localhost:3100",
  [string]$CompanyId = "test-co"
)

$ErrorActionPreference = "Stop"

function Join-Url {
  param([string]$Base, [string]$Path)
  return $Base.TrimEnd("/") + "/" + $Path.TrimStart("/")
}

function Invoke-SmokeRequest {
  param(
    [string]$Name,
    [string]$Path,
    [string]$ExpectedContentPattern = ""
  )

  $url = Join-Url -Base $BaseUrl -Path $Path
  try {
    $response = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 15 -Headers @{
      "Accept" = "application/json, text/plain"
    }
  } catch {
    Write-Error "FAIL $Name ($url): $($_.Exception.Message)"
    return $false
  }

  if ($response.StatusCode -ne 200) {
    Write-Error "FAIL $Name ($url): expected HTTP 200, got $($response.StatusCode)"
    return $false
  }

  if ($ExpectedContentPattern -and ($response.Content -notmatch $ExpectedContentPattern)) {
    Write-Error "FAIL $Name ($url): response did not match pattern '$ExpectedContentPattern'"
    Write-Host $response.Content
    return $false
  }

  Write-Host "PASS $Name ($url)"
  return $true
}

$checks = @(
  @{ Name = "health"; Path = "/health"; Pattern = '"status"\s*:\s*"ok"' },
  @{ Name = "deep health"; Path = "/health/deep"; Pattern = '"db_connected"\s*:\s*true' },
  @{ Name = "BBA recent runs"; Path = "/api/companies/$CompanyId/bba-memory/recent-runs"; Pattern = '"runs"\s*:' },
  @{ Name = "BBA metrics"; Path = "/api/companies/$CompanyId/bba-memory/metrics"; Pattern = '# TYPE bba_runs_total counter' }
)

$failed = 0
foreach ($check in $checks) {
  $ok = Invoke-SmokeRequest -Name $check.Name -Path $check.Path -ExpectedContentPattern $check.Pattern
  if (-not $ok) { $failed += 1 }
}

if ($failed -gt 0) {
  Write-Error "Deployment smoke test failed: $failed check(s) failed."
  exit 1
}

Write-Host "Deployment smoke test passed."
exit 0
