# BBA Training Session — Pre-flight Checklist and Safety Rules

**Audience**: Costel (operator)  
**Session parameters**: 5 bets × 2 RON = 10 RON maximum per session  
**Mode**: manual supervision required for every bet, `requireFinalConfirmation: true` throughout training

---

## Known gaps before first session (read first)

| Gap | Status | Impact |
|---|---|---|
| Operator scripts (`session-health.ps1`, `trigger-test-bet.ps1`, `verify-bet.ps1`) | In PR #55 — NOT merged to master | Must use `Invoke-RestMethod` directly (examples below) |
| `selector-convergence` endpoint | Not yet implemented | Use `stats-summary` + `recent-runs` to judge session health instead |
| CDP attach (`execution.attachToUserChrome`) | In PR #55 — NOT merged | Use `execution.skipLogin: true` + persistent Chromium profile |

---

## Hard stops — abort the session immediately if any of these fire

Do not attempt to "push through" any hard stop. Stop the session, record the state, and triage before resuming.

| Condition | What to do |
|---|---|
| Any bet results in `outcome: "failure"` with `failureClass: "CAPTCHA_VISIBLE"` | Stop session. BBA has been detected. Wait 24h before next session. |
| Server returns 500 on the execute route | Stop. Check server logs before placing another bet. |
| Casa shows a balance lower than expected by more than 1 RON | Stop. Cross-check My Bets against run journal. |
| Any run completes with `outcome: null` (partial) | Stop. Open Casa My Bets and confirm whether the bet was placed before retrying anything. A retry with a different idempotency key places a second bet. |
| More than 2 consecutive `outcome: "failure"` runs | Stop. Don't retry — failure patterns indicate a selector regression or session expiry that training alone won't fix. |
| Daily loss exceeds 5 RON across all sessions today | Stop. Trigger the daily stop-loss manually by checking stats-summary. |
| You see the server placing bets you did not explicitly trigger | Stop the server immediately (`Ctrl+C`). Check for stuck or queued executions. |

---

## Pre-session checklist (run before every session)

### 1 — Server health

```powershell
# Confirm server responds
Invoke-RestMethod -Uri "http://localhost:3100/api/health"
# Expected: { status: "ok" } or similar
```

If this fails: the server is not running. Start it before proceeding.

### 2 — Recent runs — confirm no active/stuck runs

```powershell
$cid = "b94fed82-..."  # your company ID
$token = "..."         # your API token

$runs = Invoke-RestMethod `
  -Uri "http://localhost:3100/api/companies/$cid/bba-memory/recent-runs?limit=5" `
  -Headers @{ Authorization = "Bearer $token" }

$runs.runs | Select-Object id, startedAt, finishedAt, outcome
```

Expected: all recent runs have a `finishedAt` and a non-null `outcome`. If any run shows `finishedAt: null`, a bet is in progress. Wait for it to complete or confirm it's a stale record before starting a new session.

### 3 — Stats summary — confirm stop-loss is not already triggered

```powershell
$stats = Invoke-RestMethod `
  -Uri "http://localhost:3100/api/companies/$cid/bba-memory/stats-summary?windowDays=1" `
  -Headers @{ Authorization = "Bearer $token" }

# Review: $stats.failureCount, $stats.successCount, $stats.partialCount
$stats | ConvertTo-Json
```

If `failureCount >= 3` from today: do not start a new session. Investigate the failure pattern first.

### 4 — Bankroll snapshot

Record the current Casa balance (from the Casa website) before the session starts. This is your baseline for stop-loss calculation. If the `betting-bankroll-snapshots` endpoint is available:

```powershell
$snapshots = Invoke-RestMethod `
  -Uri "http://localhost:3100/api/companies/$cid/betting-bankroll-snapshots" `
  -Headers @{ Authorization = "Bearer $token" }
```

If not: note the balance manually. Post-session you will compare actual Casa balance against (pre-session balance − total stake placed).

### 5 — Concurrent run guard

The BBA agent config has `maxConcurrentRuns: 5`. During training, only 1 bet should run at a time. Confirm no other process is triggering BBA executions (no other terminal, no scheduled routines running, no agent tasks pending for BBA). Check the UI → Recent Runs for any in-progress runs.

---

## First-session extra rules

These apply only to session 1. They are stricter than the standard training rules:

1. **Stake cap**: 2 RON per bet, enforced. Do not increase even if the bet looks obvious.
2. **Bet interval**: Wait for the full run to complete (finishedAt populated) before placing the next bet. No concurrent placements.
3. **Bookmaker tab**: Keep the Casa My Bets tab open and visible in a second browser window. After each bet, switch to it and manually confirm the bet appears before triggering the next.
4. **Odds tolerance**: If the preview Call 1 returns odds that differ from the target by more than 2% (not the 5% server default), do not confirm. Exit the session and re-evaluate the bet.
5. **No retries on first session**: If any bet fails, stop. Do not retry. Record the failure and triage before the next session.
6. **Time window**: Place all 5 bets within a 30-minute window. If a session takes longer than 30 minutes for any reason (server issue, CAPTCHA, unexpected result), stop after the current bet.

---

## Per-bet checklist

Before confirming each bet (Call 2):

- [ ] Call 1 returned `status: "awaiting_confirmation"`
- [ ] `risk.allowed = true`
- [ ] `reviewSummaryText` odds are within 5% of the requested odds (2% for first session)
- [ ] Stake shown in reviewSummaryText matches requested stake (2.00 RON)
- [ ] No active bet from this session is still in-flight (check `recent-runs`)

---

## Placing a bet manually (no operator scripts)

```powershell
$cid = "b94fed82-..."
$token = "..."
$iKey = [System.Guid]::NewGuid().ToString()

$body = @{
  bookmakerConfig = @{
    bookmaker = "Casa Pariurilor"
    baseUrl   = "https://www.casapariurilor.ro"
    loginUrl  = "https://www.casapariurilor.ro/login"
    # ... full bookmakerConfig ...
  }
  bet = @{
    matchLabel = "Fiorentina - Juventus"
    market     = "1X2"
    selection  = "2"
    odds       = 1.85
    stake      = 2.0
  }
  riskControls = @{
    maxStakePerBet           = 2.0
    maxTotalStakePerSession  = 10.0
    requireFinalConfirmation = $true
  }
  loginUsername = @{ secretName = "casa-username" }
  loginPassword = @{ secretName = "casa-password" }
  execution = @{
    skipLogin = $true
  }
} | ConvertTo-Json -Depth 10

# Call 1 — preview
$call1 = Invoke-RestMethod `
  -Uri "http://localhost:3100/api/companies/$cid/betting-browser-automation/execute" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $token"; "Idempotency-Key" = $iKey; "Content-Type" = "application/json" } `
  -Body $body

Write-Host "Call 1 status: $($call1.status)"
Write-Host "Review summary: $($call1.reviewSummaryText)"
Write-Host "Risk allowed: $($call1.risk.allowed)"

# STOP HERE — manually verify odds and risk before Call 2

# Call 2 — only if Call 1 looks correct
$bodyConfirm = ($body | ConvertFrom-Json)
$bodyConfirm.execution | Add-Member -NotePropertyName finalConfirmation -NotePropertyValue @{
  confirmed           = $true
  approvedOdds        = $call1.reviewSummaryOdds  # or the odds shown in reviewSummaryText
  oddsDriftTolerancePct = 5
}
$call2 = Invoke-RestMethod `
  -Uri "http://localhost:3100/api/companies/$cid/betting-browser-automation/execute" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $token"; "Idempotency-Key" = $iKey; "Content-Type" = "application/json" } `
  -Body ($bodyConfirm | ConvertTo-Json -Depth 10)

Write-Host "Call 2 status: $($call2.status)"
Write-Host "placedBetId: $($call2.placedBetId)"
```

---

## Post-session checklist

After all 5 bets:

1. **Verify runs**: `GET /bba-memory/recent-runs?limit=5` — all 5 should have `outcome` populated.
2. **Verify Casa**: Open My Bets on Casa — all 5 bets should appear. Screenshot the page.
3. **Record balance**: Note the new Casa balance. Confirm: `(pre-session balance) − (sum of placed stakes)` ≈ new balance (±0.50 RON tolerance for rounding).
4. **Log anomalies**: Any unexpected result (CAPTCHA, partial, missing bet on Casa) → create `.claude/incidents/{date}-training-session-{N}.md`.
5. **Note convergence**: Check `recent-runs` — look at the `meta` field for any selector hit/miss data. Note which selectors are consistently hitting.

---

## Convergence tracking (manual until endpoint ships)

The `selector-convergence` endpoint referenced in the training plan does not exist yet. To assess convergence manually after a session:

1. Check `GET /bba-memory/stats-summary?windowDays=7` — confirms aggregate success/failure rate across sessions.
2. Check `GET /bba-memory/recent-runs?limit=20` — look at `outcome` distribution. Three consecutive `success` runs without `SELECTOR_NOT_FOUND` in failure class indicates basic selector stability.
3. After 10+ runs with `outcome: "success"`: the selectors are effectively converged for the happy path.

Convergence is not a hard gate for autonomous mode — it's an indicator. The handoff condition is: "5 consecutive successful runs with no manual intervention needed."

---

## Abort procedure

If you need to stop mid-session:

1. **Do not kill the server** if a bet is in-flight — wait for the run to complete (or time out at `sessionTimeoutMs`). Killing the server mid-bet leaves the bet in an unknown state.
2. If the server is unresponsive: check Casa My Bets first to determine if the bet was placed, then kill the server.
3. After abort: record the last known `runId` and `outcome` from `recent-runs`.
4. Before next session: confirm all aborted runs have resolved outcomes or are identified as partial.

---

## Rate limiter note

The BBA execute route has a rate limit: **10 placement attempts per minute per company**. During training, 5 bets over 30 minutes is well within this limit. If you hit a 429 response, wait 60 seconds before the next attempt.
