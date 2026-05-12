param(
  [Parameter(Mandatory=$true)][string]$MatchLabel,
  [Parameter(Mandatory=$true)][string]$Market,
  [Parameter(Mandatory=$true)][string]$Selection,
  [Parameter(Mandatory=$true)][double]$Odds,
  [double]$Stake = 2.0,
  [string]$CompanyId = "b94fed82-38bf-4eb3-81d8-9b1a8aa84921",
  [string]$BaseUrl = "http://localhost:3100",
  [int]$ChromeDebugPort = 9222,
  [switch]$PreviewOnly,
  [switch]$PlaceBet,
  [switch]$Confirm
)

$ErrorActionPreference = "Stop"

if ($Stake -gt 2.0) {
  throw "Test mode: stake is capped at 2 RON. Requested: $Stake RON."
}
if ($Stake -le 0) {
  throw "Stake must be positive."
}
if ($PlaceBet -and $PreviewOnly) {
  throw "Use either -PreviewOnly or -PlaceBet, not both."
}

$mode = if ($PlaceBet) { "FULL EXECUTE" } else { "PREVIEW ONLY" }
$health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 5
$cdp = Invoke-RestMethod -Uri "http://localhost:$ChromeDebugPort/json/version" -TimeoutSec 5
$tabs = Invoke-RestMethod -Uri "http://localhost:$ChromeDebugPort/json" -TimeoutSec 5
$casaTab = $tabs | Where-Object { $_.url -match "casapariurilor" } | Select-Object -First 1
if (-not $casaTab) {
  throw "Chrome debug port is up, but no Casa Pariurilor tab is open. Open Casa in Chrome and confirm the account is logged in first."
}

Write-Host "Server: OK ($($health.status))"
Write-Host "Chrome: $($cdp.Browser)"
Write-Host "Casa tab: $($casaTab.url)"

if (-not $Confirm) {
  Write-Host ""
  Write-Host "Would send BBA execute request:"
  Write-Host "  Match:     $MatchLabel"
  Write-Host "  Market:    $Market"
  Write-Host "  Selection: $Selection"
  Write-Host "  Odds:      $Odds"
  Write-Host "  Stake:     $Stake RON"
  Write-Host "  Mode:      $mode"
  Write-Host ""
  Write-Host "Re-run with -Confirm to send. Add -PlaceBet only when the operator is ready for a real placement."
  return
}

$selector = {
  param([string[]]$Selectors, [bool]$Optional = $false)
  return @{
    selectors = $Selectors
    optional = $Optional
  }
}

$riskControls = @{
  maxStakePerBet = 2.0
  maxTotalStakePerSession = 12.0
  requireFinalConfirmation = -not $PlaceBet
  dailyStopLossPct = 0.05
  sessionStopLossPct = 0.05
}

$execution = @{
  attachToUserChrome = $true
  chromeDebugPort = $ChromeDebugPort
  skipLogin = $true
}
if ($PlaceBet) {
  $execution.finalConfirmation = @{
    confirmed = $true
    confirmedBy = "operator-trigger-test-bet.ps1"
    approvedOdds = $Odds
    oddsDriftTolerancePct = 5
  }
}

$payload = @{
  bet = @{
    matchLabel = $MatchLabel
    market = $Market
    selection = $Selection
    odds = $Odds
    stake = $Stake
    currency = "RON"
  }
  loginUsername = @{}
  loginPassword = @{}
  bookmakerConfig = @{
    bookmaker = "Casa Pariurilor"
    baseUrl = "https://www.casapariurilor.ro/"
    loginUrl = "https://www.casapariurilor.ro/"
    postLoginUrl = "https://www.casapariurilor.ro/"
    historyUrl = "https://www.casapariurilor.ro/pariurile-mele"
    username = & $selector @() $true
    password = & $selector @() $true
    loginSubmit = & $selector @() $true
    cookieAccept = & $selector @(
      "button:has-text('ACCEPT TOATE')",
      "button:has-text('Accepta toate')",
      "button:has-text('Accept')"
    ) $true
    popupClose = & $selector @(
      "button:has-text('JOACA IN CONTINUARE')",
      "button:has-text('JOACĂ ÎN CONTINUARE')",
      "[aria-label*='close' i]",
      "[class*='modal'] button[class*='close']"
    ) $true
    searchInput = & $selector @(
      "input[type='search']",
      "input[placeholder*='Caut' i]",
      "[role='searchbox']"
    ) $true
    searchSubmit = & $selector @(
      "button[type='submit']:has-text('Cauta')",
      "button:has-text('Cauta')",
      "button:has-text('Caută')"
    ) $true
    searchResult = & $selector @(
      "text={{matchLabel}}",
      "text={{searchQuery}}"
    ) $true
    marketGroup = & $selector @(
      "text={{market}}",
      "[data-testid*='market' i]:has-text('{{market}}')"
    ) $true
    selectionButton = & $selector @(
      "button:has-text('{{selection}}')",
      "[role='button']:has-text('{{selection}}')",
      "[data-testid*='selection' i]:has-text('{{selection}}')",
      "text={{selection}}"
    ) $false
    stakeInput = & $selector @(
      "input[inputmode='decimal']",
      "input[type='number']",
      "input[placeholder*='Miza' i]",
      "input[placeholder*='Miză' i]",
      "[class*='stake' i] input",
      "[class*='betslip' i] input"
    ) $false
    reviewButton = & $selector @(
      "button:has-text('Pariaza')",
      "button:has-text('Pariază')",
      "button:has-text('Plaseaza')",
      "button:has-text('Plasează')",
      "button:has-text('Pune pariul')",
      "button:has-text('Mizeaza')",
      "button:has-text('Mizează')"
    ) $false
    submitButton = & $selector @(
      "button:has-text('Confirma')",
      "button:has-text('Confirmă')",
      "button:has-text('Plaseaza pariul')",
      "button:has-text('Plasează pariul')"
    ) $true
    reviewSummary = & $selector @(
      "[class*='betslip' i]",
      "[data-testid*='betslip' i]",
      "[class*='ticket' i]"
    ) $true
    receiptSuccess = & $selector @(
      "text=/pariu.*plas/i",
      "text=/bilet.*plas/i",
      "text=/success/i"
    ) $true
    historySelection = & $selector @(
      "text={{matchLabel}}",
      "text={{selection}}"
    ) $true
  }
  riskControls = $riskControls
  execution = $execution
} | ConvertTo-Json -Depth 20

$idempotencyKey = [guid]::NewGuid().ToString()
Write-Host "Sending request with Idempotency-Key: $idempotencyKey"
$result = Invoke-RestMethod -Uri "$BaseUrl/api/companies/$CompanyId/betting-browser-automation/execute" `
  -Method Post `
  -Body $payload `
  -ContentType "application/json" `
  -Headers @{ "Idempotency-Key" = $idempotencyKey } `
  -TimeoutSec 180

$result | ConvertTo-Json -Depth 20
