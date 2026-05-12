# Strategy v2 — Implementation Audit

**Date**: 2026-05-13  
**Auditor**: Claude Sonnet 4.6  
**Scope**: TypeScript server-side implementation only  
**Note**: Python strategy files (`selection_engine.py`, `execution_manager.py`, `shared/bankroll.py`, `shared/calibration.py`, `daily_loop.py`) were not found in `C:\Users\thepr\GitHub\paperclip`. This audit covers the TypeScript risk management layer only. A separate Python-side audit is required for the edge calculation and Kelly sizing logic.

---

## Strategy v2 Parameters (from agent capabilities)

| Parameter | Value |
|---|---|
| Minimum edge — football | ≥2% |
| Minimum edge — basketball | ≥3% |
| Minimum edge — tennis | ≥4% |
| Kelly fraction | 0.25 |
| Kelly cap | 3% of current bankroll |
| Daily stop-loss (soft alert) | −5% |
| Daily stop-loss (hard halt) | −10% |
| Consecutive loss halt | 3 losses → 24h |
| Lifetime stop-loss | 70% of initial bankroll |
| Bet type | Singles only |
| Concentration — sport | Max 40% of daily stake allocation |
| Concentration — league | Max 25% of daily stake allocation |
| Skip threshold | Best EV <4% → pass |

---

## What Is Implemented in TypeScript

### Stop-loss (daily and session) ✅ IMPLEMENTED

**File**: `server/src/services/betting-stop-loss.ts`

- `DEFAULT_DAILY_LIMIT_PCT = 0.05` (5%) — matches strategy-v2 hard halt threshold
- `DEFAULT_SESSION_LIMIT_PCT = 0.10` (10%) — implemented but not in the strategy-v2 spec as a named parameter; acts as an additional session-scoped guard
- Per-request overrides via `dailyStopLossPct` / `sessionLimitPct` — allows the caller to tighten but not necessarily loosen
- Baseline from `bettingBankrollSnapshots` — correct anchor
- **Gap**: the strategy-v2 spec has a −5% soft alert and −10% hard halt. The current implementation uses a single threshold (`dailyLimitPct`) that triggers a hard block. There is no soft alert behavior — the Telegram notification fires, but the bet is still blocked if `lossPct >= dailyLimitPct`. Recommendation: add a separate soft-alert threshold (default 5%) that sends the Telegram alert but still allows the bet, and a hard-halt threshold (default 10%) that blocks.

### Stake validation (per-bet and per-session) ✅ IMPLEMENTED

**File**: `server/src/services/betting-browser-automation.ts:validateStakeGuards`

- `riskControls.maxStakePerBet` — hard ceiling per individual bet
- `riskControls.maxTotalStakePerSession` — sum of all legs must not exceed this
- These are checked before browser launch (step 3 of execute flow)
- **Gap**: these are caller-supplied values, not automatically computed from Kelly. The TypeScript layer does not calculate Kelly fraction from bankroll — that is expected to be done upstream (by the Python strategy layer or by the operator).

### Bankroll tracking and P&L ✅ IMPLEMENTED

**File**: `server/src/services/bankroll.ts`

- `resolveBet`: wins earn `stake × (odds − 1)`, losses lose `stake`, voids are zero-sum
- `snapshotBankroll`: stores balance, total staked, total return, ROI (%), win/loss/void counts
- `DRAWDOWN_ALERT_THRESHOLD = 0.20` (20%) — fires a log warning when current balance is 20% below the session peak. This is separate from the stop-loss thresholds.

### Odds-drift guard ✅ IMPLEMENTED

**File**: `server/src/services/betting-browser-automation.ts:2235`

- If `approvedOdds` is provided in Call 2 and `|(detected − approved) / approved| > oddsDriftTolerancePct` (default 5%), the bet is rejected.
- This is an execution-time guard, not a pre-flight check. It fires after the browser has placed the selection but before clicking Submit.

---

## What Is NOT Implemented in TypeScript

### Kelly fraction calculation ❌ NOT IMPLEMENTED

The TypeScript layer accepts `bet.stake` as a caller-provided value and validates it against `maxStakePerBet`. It does not compute `stake = 0.25 × Kelly × bankroll` from the edge probability. This calculation must happen in the Python strategy layer or be done manually by the operator.

**Risk**: If the Python layer is down, broken, or bypassed, operators can supply arbitrary stake values unconstrained by Kelly. The only server-side check is `stake ≤ maxStakePerBet` and sum ≤ `maxTotalStakePerSession`. A caller could submit `stake = maxStakePerBet` on every bet regardless of Kelly.

**Recommendation**: Add a `maxKellyFraction` parameter to `riskControls` (default 0.03 = 3% of bankroll). If `currentBalance` is provided and `stake > currentBalance × maxKellyFraction`, block the bet with reason "Stake exceeds Kelly cap."

### Consecutive loss halt ❌ NOT IMPLEMENTED

No TypeScript code counts recent consecutive losses or enforces a 24h halt after 3 consecutive losses. The `bettingPlacedBets` table has enough data to compute this (ordered by `placedAt`, status `won`/`lost`), but the logic does not exist in the server.

**Risk**: A run of bad outcomes (3+ consecutive losses) can continue indefinitely without automatic pause.

**Recommendation**: Add a `bettingConsecutiveLossGuard` check in `betting-stop-loss.ts` (or a new service). Query the last 3 `bettingPlacedBets` rows for the company ordered by `placedAt` desc. If all 3 are `status: "lost"`, return `allowed: false, reason: "24h halt after 3 consecutive losses."` with a `haltUntil` timestamp.

### Lifetime stop-loss ❌ NOT IMPLEMENTED

The daily stop-loss uses same-day snapshot as baseline. There is no lifetime stop-loss that checks whether the current bankroll is below 70% of the initial (or peak) deposit.

The `DRAWDOWN_ALERT_THRESHOLD = 0.20` in `bankroll.ts` logs a warning at 20% drawdown from peak, but this is a log-only alert that does not block execution.

**Risk**: Cumulative losses could erode the bankroll below the lifetime threshold without triggering a halt.

**Recommendation**: Add a `lifetimeStopLossPct` parameter (default 0.30 = "stop if current < 70% of initial"). Read the oldest `bettingBankrollSnapshots` row as the initial balance. Block if `currentBalance < initialBalance × (1 − lifetimeStopLossPct)`.

### Concentration limits (per sport, per league) ❌ NOT IMPLEMENTED

No code enforces max 40% of daily stake per sport or 25% per league. There is no stake aggregation by `matchLabel` sport/league classification.

**Risk**: Unlimited concentration in one market (e.g., all stake on football today) violates the strategy-v2 limits.

**Recommendation**: This requires sport/league metadata on each bet. Either:
1. Add `sport` and `league` fields to `BettingAutomationBetInput` (and `bettingPlacedBets` schema), or
2. Parse from `matchLabel` + `market` using a classification function.
Then query `bettingPlacedBets` for today's placed bets and sum stake by sport/league.

### EV threshold filter (skip if best EV <4%) ❌ NOT IMPLEMENTED

No TypeScript code filters out bets where the edge/EV is below 4%. This is expected to be enforced by the Python strategy layer before calling the BBA execute endpoint. The server receives whatever bets are sent to it.

**Risk**: The Python layer could be bypassed (e.g., manual API call) with a low-EV bet. The server would place it without question.

**Recommendation**: Add `minExpectedValuePct` to `riskControls` (default 4.0). If the caller provides `bet.edgePct` and it is below this threshold, block with reason "Bet edge below minimum EV threshold."

### Soft alert vs. hard halt distinction ❌ PARTIAL

The strategy-v2 spec distinguishes −5% (soft alert) from −10% (hard halt). The current `betting-stop-loss.ts` uses a single `dailyLimitPct` for both. The Telegram alert fires when the limit is hit, but it fires at the same time as the hard block.

**Recommendation**: Add `dailySoftAlertPct` (default 5%) alongside `dailyLimitPct` (default 10%). If `lossPct >= dailySoftAlertPct`, send the Telegram alert but allow the bet. If `lossPct >= dailyLimitPct`, block.

---

## Risk Matrix

| Parameter | Implemented | Gap severity | Fix complexity |
|---|---|---|---|
| Daily stop-loss hard halt | ✅ (at 5%, not 10%) | Medium — threshold mismatch | 1-line config |
| Session stop-loss | ✅ | n/a | — |
| Stake per bet cap | ✅ (caller-supplied) | Low | — |
| Odds-drift guard | ✅ | n/a | — |
| Bankroll tracking | ✅ | n/a | — |
| Kelly cap enforcement | ❌ | High — unconstrained staking | ~20 lines |
| Consecutive loss halt | ❌ | High — no automatic pause | ~30 lines + migration |
| Lifetime stop-loss | ❌ | High — no floor | ~15 lines |
| Concentration limits | ❌ | Medium — requires schema change | Schema + ~40 lines |
| EV threshold filter | ❌ | Low (Python layer expected) | ~5 lines if `edgePct` added |
| Soft alert vs hard halt | ❌ | Low (alert fires anyway) | ~10 lines |

---

## Recommended Implementation Order

1. **Fix daily stop-loss threshold mismatch** (now 5% blocks; should be 10% blocks, 5% alerts): low-risk 1-liner + 10 lines for soft-alert path.
2. **Add Kelly cap enforcement** to `riskControls` validation: catches manual API calls that bypass the Python layer.
3. **Add consecutive loss halt** to `betting-stop-loss.ts`: queries last 3 resolved bets; adds 24h halt logic.
4. **Add lifetime stop-loss**: reads oldest bankroll snapshot as initial baseline.
5. **Defer concentration limits** until sport/league fields are added to the schema — this requires a migration.
