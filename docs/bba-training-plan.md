# BBA Training Plan

**Audience**: Costel (operator), CTO (reviewer)  
**Purpose**: Structured training phase to populate `selectors_observed` with reliable hit/miss/click_success counters before switching to autonomous production mode.  
**Training timeline**: 3–7 days, 3–5 sessions  
**Stake per bet during training**: 2 RON (hard cap enforced by `trigger-test-bet.ps1`)

---

## Training Goal

The BBA system learns which CSS selectors reliably locate bookmaker UI elements by tracking hit/miss/click_success counts in the `selectors_observed` SQLite table. Training is complete when every required selector **purpose** has reached convergence — enough observations that the selector ranking is stable and click success rate is production-ready.

**Why train before autonomous mode:**
- Avoids selector thrashing on first live run under real stakes
- Surfaces Casa layout changes (SPA route changes, class renames) before they become costly failures
- Builds operator confidence with small losses before full autonomy

---

## Selector Purposes and Convergence Criteria

| Purpose | Description | Min observations | Min click success rate | Notes |
|---|---|---|---|---|
| `overlay_dismiss` | Close buttons for inactivity/cookie prompts | 10 | 80% | Seen on nearly every session start |
| `login_button` | Button to open the login modal/form | 10 | 85% | Only on credential-login path |
| `login_modal` | The login modal container | 10 | 80% | Verified by modal appearing after click |
| `username_input` | Username field inside login form | 10 | 90% | Critical — failure = full session abort |
| `password_input` | Password field inside login form | 10 | 90% | Critical |
| `submit_login` | "Conectare" / submit button | 10 | 90% | Critical |
| `session_active` | Indicator that login succeeded | 15 | 85% | Higher bar — determines all future session checks |
| `session_expired` | Indicator that auth was lost | 10 | 80% | Must distinguish from unauthenticated vs. temporary |
| `captcha_detected` | CAPTCHA challenge visible | 5 | n/a (abort trigger) | Just needs reliable detection; 5 observations sufficient |
| `selection_button` | Bet odds button for the chosen selection | 20 | 80% | Highest-volume selector; most variation by market type |
| `stake_input` | Stake amount input field | 15 | 90% | Critical — wrong input = wrong stake |
| `review_button` | "Pariează" / placement trigger | 15 | 85% | Critical — clicking wrong button places bet |
| `receipt_success` | Receipt/confirmation element after placement | 10 | 75% | May vary by bet type |

**Convergence check URL**: `GET /api/companies/{companyId}/bba-memory/selector-convergence`  
Check after each training session. A purpose is converged when both `observations >= minimum` and `clickSuccessRate >= minimum`.

---

## Training Session Structure

### Session parameters
- **Bets per session**: 5
- **Stake per bet**: 2 RON (enforced by script)
- **Cool-down between bets**: 60 seconds
- **Operator presence**: required — watch Chrome throughout
- **Mode**: live placement with `requireFinalConfirmation: true` and operator confirmation at each bet

### Pre-session checklist (run `scripts/session-health.ps1`)
1. Server responding on port 3100 (`/api/health` returns `ok`)
2. Chrome CDP available on port 9222 (`/json/version` responds)
3. At least 1 Casa Pariurilor tab open and logged in
4. Recent runs panel shows no active/pending runs
5. Daily stop-loss not triggered (check UI → Stats)
6. Bankroll snapshot updated with current balance

### Session trigger command
```powershell
# Preview mode first — shows payload without sending:
scripts\trigger-test-bet.ps1 `
  -MatchLabel "Fiorentina - Juventus" `
  -Market "1X2" `
  -Selection "2" `
  -Odds 1.85 `
  -Stake 2.0

# Execute with confirmation:
scripts\trigger-test-bet.ps1 `
  -MatchLabel "Fiorentina - Juventus" `
  -Market "1X2" `
  -Selection "2" `
  -Odds 1.85 `
  -Stake 2.0 `
  -Confirm

# Full placement (skips Call 1 preview wait):
scripts\trigger-test-bet.ps1 `
  -MatchLabel "Fiorentina - Juventus" `
  -Market "1X2" `
  -Selection "2" `
  -Odds 1.85 `
  -Stake 2.0 `
  -PlaceBet -Confirm
```

### Post-session checklist
1. Run `scripts/verify-bet.ps1 -Limit 5` — confirm all 5 runs completed
2. Check Casa My Bets — confirm each bet appears
3. Check Recent Runs panel — all 5 have `outcome` (success/partial/failure)
4. Call selector convergence endpoint — note which purposes are not yet converged
5. Update bankroll snapshot with new balance
6. Log any anomalies in `.claude/incidents/{date}-training-session-N.md`

---

## Variety Matrix (5 sessions over 3–7 days)

| Session | Sport | Market | Time of day | Notes |
|---|---|---|---|---|
| Session 1 | Football | 1X2 | Afternoon (16:00–18:00) | Most common market; baseline for selection_button + review_button |
| Session 2 | Tennis | Match winner | Evening (19:00–21:00) | Different page layout; tests marketGroup click path |
| Session 3 | Basketball | Total (over/under) | Evening (19:00–21:00) | Fractional/decimal odds variation; tests stake_input with decimal values |
| Session 4 | Football | 1X2 | Morning (10:00–12:00) | Different overlay behavior at session start; catch time-of-day CSS variations |
| Session 5 | Mixed re-tests | Any failed selector purpose | Any | Focus on purposes still below convergence threshold |

**Variety goals**:
- Exercise different bookmaker page layouts (match detail, league view, search flow)
- Exercise login path at least once (let CDP session expire, then re-run with credential path)
- Exercise search path at least twice (rather than direct event URL)
- Exercise direct eventUrl path at least twice

---

## Expected Training Cost

| Parameter | Value |
|---|---|
| Bets per session | 5 |
| Sessions planned | 5 |
| Stake per bet | 2 RON |
| Total bets | 25 |
| Expected total staked | 50 RON |
| Expected variance | ±20 RON (depending on outcomes) |

This is a deliberate investment in selector reliability. The alternative is discovering selector failures at full production stake.

---

## Convergence Check: How to Read the Output

```
GET /api/companies/{companyId}/bba-memory/selector-convergence
```

Expected response shape:
```json
{
  "purposes": [
    {
      "purpose": "selection_button",
      "topSelector": "button:has-text('{{selection}}')",
      "observations": 18,
      "clickSuccessRate": 0.83,
      "converged": false,
      "gap": "2 more observations needed"
    },
    ...
  ],
  "allConverged": false,
  "convergenceTimestamp": null
}
```

**All converged** means `allConverged: true` and all `clickSuccessRate` values exceed the criteria table above.

If the endpoint is not yet implemented, the operator can manually check the `selectors_observed` table:
```powershell
# Requires sqlite3 CLI or a DB browser
sqlite3 "$env:USERPROFILE\.paperclip\bba-memory\bba-memory.db" `
  "SELECT purpose, selector, net_hits, click_successes, click_attempts FROM selectors_observed ORDER BY purpose, net_hits DESC;"
```

---

## Handoff to Production (Autonomous Mode)

### Conditions to meet before switching to Paperclip autonomous mode

| Condition | How to verify |
|---|---|
| All selector purposes converged (see table above) | Convergence endpoint returns `allConverged: true` |
| 0 unresolved `SELECTOR_NOT_FOUND` failures in last 10 runs | Recent Runs panel, filter by failure class |
| At least 1 successful session per sport (football + tennis + basketball) | Session logs in `.claude/incidents/` |
| Bankroll snapshot up-to-date | UI → Stats shows today's balance |
| Operator has read production-readiness-runbook.md | Manual confirmation |

### Switch procedure

1. Verify all conditions above.
2. Confirm with CEO that strategy parameters in `docs/agent-prompts/shared-strategy-reference.md` are current.
3. Confirm the Python prediction pipeline is producing predictions with the correct edge fields.
4. Enable the BBA agent's autonomous heartbeat in Paperclip.
5. CEO monitors the first 3 autonomous placements manually (same post-session checklist as training).

### Supervision after handoff

| Period | Supervision level |
|---|---|
| Week 1 (first 7 days) | Operator checks Casa My Bets after every autonomous bet |
| Week 2 | Random sampling — check 1 in 3 bets manually |
| Month 1 | Weekly review of Recent Runs panel + selector convergence stats |
| Ongoing | Alert on any failure class other than `SESSION_EXPIRED` or `CAPTCHA_VISIBLE` |

### Anomaly threshold

If any of these occur, pause autonomous mode and investigate:
- 2+ consecutive `SELECTOR_NOT_FOUND` failures
- Any `submitted_unconfirmed` outcome (bet submitted but receipt not confirmed)
- Any unexpected large discrepancy in Casa My Bets vs. Recent Runs

---

## Failure Recovery During Training

If a training bet fails, do not immediately re-run. First:

1. Check Casa My Bets — was the bet placed despite the failure report?
2. Read the session log (`scripts/verify-bet.ps1 -RunId {id}`) for failure details
3. If `SELECTOR_NOT_FOUND`: identify the selector from the screenshot, update config
4. If `session_expired`: manually log in to Casa in Chrome, re-run
5. If `CAPTCHA_VISIBLE`: stop for the session; manually solve CAPTCHA, try again next day
6. Log the failure in `.claude/incidents/{date}-training-N.md`

Count this failure toward the session (it is a real learning signal for the selector system).
