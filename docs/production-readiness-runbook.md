# BBA Production Readiness Runbook

**Audience**: Costel (operator), CTO (reviewer)  
**Purpose**: Per-bet operator sequence for production use — what to check before, during, and after every placement; failure recovery paths; stop conditions.  
**Companion docs**: [`bba-memory-deployment.md`](bba-memory-deployment.md) (server setup), [`bba-memory-demo-dry-run.md`](bba-memory-demo-dry-run.md) (demo script)

---

## Pre-Requisites (one-time, per environment)

These must be true before the first bet in any environment. Check them once at deploy time; re-check after any server restart.

| Check | How to verify | Fix if missing |
|---|---|---|
| Server running on port 3100 | `Invoke-RestMethod http://localhost:3100/health` → `{status:"ok"}` | Start server: `pnpm --filter server start` |
| Bankroll snapshot seeded | UI → Stats → "Current Bankroll" shows a number | POST `/api/companies/{id}/betting-bankroll-snapshots` with current balance |
| Company ID known | UI → Settings → Company ID | Check Paperclip admin panel |
| Secrets stored (username + password) | UI → Secrets → list non-empty | Add via UI → Secrets → New Secret |
| Bookmaker config valid | Test request with small stake + `requireFinalConfirmation:true` | Fix selector config; check bba-memory-architecture.md |
| Playwright/Chromium installed | `npx playwright install chromium` in server dir | Run install command |

---

## Per-Bet Operator Sequence

### Step 1 — Pre-placement checks (T−5 min)

Before opening the Bet Placement form:

1. **Check server health**: `Invoke-RestMethod http://localhost:3100/health`
2. **Check stop-loss status**: UI → BBA Memory → Stats tab. Confirm neither daily nor session limit is near threshold.
   - Daily loss >3% of bankroll → review before placing
   - Session loss >7% → consider pausing for the session
3. **Confirm event is live**: verify the match is available on the bookmaker's site, odds are displayed, and the market you intend to bet is open.
4. **Confirm bankroll snapshot is current**: if the last snapshot is >4h old, update it via `POST /betting-bankroll-snapshots` with today's current balance.

### Step 2 — Fill the bet form

1. Open UI → BBA Memory → Execute Bet.
2. Fill all required fields:
   - **matchLabel**: exactly as shown on the bookmaker (e.g., "Fiorentina - Juventus")
   - **market**: market name (e.g., "1X2", "Over/Under 2.5")
   - **selection**: selection text (e.g., "1", "Over 2.5")
   - **odds**: current odds displayed on the bookmaker site
   - **stake**: calculated stake (≤ `riskControls.maxStakePerBet`)
3. Set `riskControls.requireFinalConfirmation: true` (default — do not disable unless you have a specific automation reason).
4. If using a direct event URL, paste it in `execution.startUrl` or the `bet.eventUrl` field to skip search.

### Step 3 — Call 1: Preview

1. Click **Place Bet** → confirmation modal opens.
2. Read the full bet summary: match, market, selection, odds, stake, currency.
3. Verify all fields match your intention.
4. Type `CONFIRM` in the confirmation input.
5. Click **Place Real Bet**.
6. Wait for the spinner (expected: 20–90s depending on Casa load).
7. Expected outcome: `status: "awaiting_confirmation"` with `reviewSummaryText` showing the betslip preview (odds, estimated return).
   - Verify the displayed odds in `reviewSummaryText` match the odds you entered.
   - If odds differ by >2%, abort: click away, do not proceed to Call 2. Log the discrepancy.

### Step 4 — Call 2: Confirm and submit

> Only proceed if Step 3 returned `awaiting_confirmation` AND the displayed odds are acceptable.

1. The UI will show a "Confirm Placement" step with `approvedOdds` pre-filled from Call 1.
2. Review the summary one more time.
3. Click **Confirm and Place**.
4. Wait for spinner (expected: 20–90s — full browser session again from scratch).
5. Expected outcomes:
   - `status: "completed"` → bet placed and confirmed in bookmaker receipt
   - `status: "submitted_unconfirmed"` → browser submitted but receipt not confirmed → check Step 5
   - `status: "failed"` with `failureReason` → read failure class, apply recovery path below

### Step 5 — Post-placement verification (T+2 min)

After any non-failed response:

1. **Check Casa My Bets**: open `https://casapariurilor.ro` → My Account → My Bets. Confirm the placed bet appears with correct selection, stake, and odds.
2. **Check Recent Runs panel**: UI → BBA Memory → Recent Runs. Confirm a new row appeared with `outcome: success` and a valid `placedBetId`.
3. **If `submitted_unconfirmed`**: bet may still be placed even without UI confirmation. Always verify in Casa My Bets before deciding whether to retry.
4. **Update bankroll snapshot**: after each placed bet, update the bankroll with the new balance:
   ```powershell
   $body = @{ balance = <new_balance>; currency = "RON" } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri "http://localhost:3100/api/companies/$companyId/betting-bankroll-snapshots" `
     -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } -Body $body
   ```

---

## Failure Recovery Paths

### F-1: `status: "session_expired"`

Persistent profile session was not authenticated and autofill login failed.

1. Open Chrome with the persistent profile: `chrome --user-data-dir="%USERPROFILE%\.paperclip\bba-playwright-profile" https://casapariurilor.ro`
2. Log in manually.
3. Close Chrome.
4. Retry the bet (Call 1 → Call 2 sequence again).

### F-2: `status: "failed"`, failureReason contains `SELECTOR_NOT_FOUND` or `not found`

A CSS selector failed to locate its target. Casa may have updated their site.

1. Open Recent Runs → expand the failed run → click the screenshot link.
2. Identify which element was not found from the screenshot.
3. Update the selector in the bookmaker config JSON or the seeded selectors in `repository.ts`.
4. Restart the server if config is baked into startup.
5. Retry the bet.

### F-3: `status: "failed"`, failureReason contains `Odds drifted`

Odds moved by more than `oddsDriftTolerancePct` (default 5%) between Call 1 and Call 2.

1. Do NOT retry the same payload. The bet conditions changed.
2. Refresh the bookmaker page and check current odds.
3. If the new odds are still acceptable (within your edge threshold), create a new bet request with the updated odds as both `bet.odds` and `execution.finalConfirmation.approvedOdds`.
4. Run Call 1 → Call 2 with the fresh odds.

### F-4: `status: "submitted_unconfirmed"`

Bet was submitted but no receipt confirmed.

1. **Always check Casa My Bets first**. If the bet appears → treat as placed, do not retry.
2. If the bet does NOT appear in My Bets after 5 minutes:
   - Wait another 5 minutes (Casa can be slow to show new bets).
   - If still absent after 10 minutes total → the bet may have failed silently. Retry Call 1 → Call 2.
   - Keep the `Idempotency-Key` UUID the same as the original request if retrying within 60s. Use a new UUID if >60s have elapsed.

### F-5: `status: "blocked_by_risk"`, reason contains `Missing bankroll baseline`

Stop-loss preflight blocked because there are no bankroll snapshots.

1. Add a bankroll snapshot (see Pre-Requisites above).
2. Retry the bet.

### F-6: HTTP 409 `request_in_progress`

A prior request with the same `Idempotency-Key` is still executing.

1. Wait 30 seconds.
2. Check Recent Runs for the result.
3. If a result appeared → done, no retry needed.
4. If no result after 60s → the prior run may have crashed. Use a new UUID for the next request.

### F-7: HTTP 429 Too Many Requests

Rate limiter triggered: >10 placement calls per 60s per company.

1. Wait 60 seconds.
2. Check Recent Runs — the rate limiter fires before execution, so no bet was placed.
3. Retry.

---

## Stop Conditions

Stop ALL betting activity immediately if any of the following are true:

| Condition | Action |
|---|---|
| Daily bankroll loss ≥10% | `blocked_by_risk` will fire automatically. Do not override. Wait until next calendar day (Europe/Bucharest timezone). |
| Session bankroll loss ≥10% | Same — automatic block. Close the session. Start a new session tomorrow. |
| 3 consecutive `failed` or `session_expired` outcomes | Pause. The bookmaker site may have changed or the account may be locked. Investigate before placing another bet. |
| `CAPTCHA_VISIBLE` failure class appears | Do not attempt to bypass. Log in manually to the bookmaker account to clear the CAPTCHA, then retry via CDP path. |
| Bookmaker account shows "Account Suspended" or equivalent | Stop immediately. Contact the bookmaker. Do not attempt further automation on this account. |
| Server throws unhandled exception or exits | Restart server. Check logs. Do not retry any in-flight bet until you confirm its status in Casa My Bets. |

---

## Audit Trail

Every bet execution writes:

| Artifact | Location | Retention |
|---|---|---|
| Run record | BBA Memory SQLite (`~/.paperclip/bba-memory/bba-memory.db`) | Permanent |
| Session log | `~/.paperclip/data/betting-browser-automation/{companyId}/{session}/session.log` | Permanent |
| Screenshots | `~/.paperclip/data/betting-browser-automation/{companyId}/{session}/screenshots/` | Permanent |
| Video | `~/.paperclip/data/betting-browser-automation/{companyId}/{session}/videos/` | Permanent |
| Playwright trace | `~/.paperclip/bba-memory/traces/{runId}.zip` | Permanent |
| `bettingPlacedBets` row | Paperclip main DB | Permanent |

To open a trace in Playwright Trace Viewer:
```powershell
$runId = 42  # from Recent Runs panel
npx playwright show-trace "$env:USERPROFILE\.paperclip\bba-memory\traces\$runId.zip"
```

---

## Known Limitations

- **Double-click risk on Call 2** (P2-1 in execute-path-review): if the bookmaker's betslip retains the Call 1 selection via server-side session cookies, Call 2 may toggle it OFF instead of ON. If the Run log shows "slip verification failed" on a re-run, check Casa My Bets — the bet may already be placed from Call 1.
- **No concurrent placement protection** (P2-2 in execute-path-review): avoid triggering the same bet from two different sessions or API keys simultaneously. The DB-level idempotency key provides eventual de-duplication but not race protection.
- **Bankroll baseline required for every session**: if the snapshot is missing or older than the current session start, the stop-loss guard may use a stale baseline. Update the snapshot before each new betting session.
