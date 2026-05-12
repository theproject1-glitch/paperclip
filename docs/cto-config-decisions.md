# CTO Config Decisions — BBA Reliability

**Date**: 2026-05-13  
**Author**: Claude Sonnet 4.6  
**Source**: Code analysis of `betting-browser-automation.ts`, `betting-stop-loss.ts`, agent config API  
**Note**: `docs/cto-reliability-analysis.md` does not exist in this branch. This document is derived from direct code review.

---

## Decision 1 — Default stop-loss thresholds

**Constants**: `betting-stop-loss.ts:6–7`

```typescript
const DEFAULT_DAILY_LIMIT_PCT = 0.05;   // 5%
const DEFAULT_SESSION_LIMIT_PCT = 0.10;  // 10%
```

**Current behavior**: Any `stopLoss.preflight()` call without explicit `dailyLimitPct`/`sessionLimitPct` uses these defaults. The route passes `riskControls.dailyStopLossPct` from the request body — if the client omits these fields, the defaults apply silently.

**Decision**: Keep defaults at 5%/10%. They are conservative and match the strategy-v2 spec. However, add a log line when defaults are applied so operators can see which threshold is active:

```typescript
logger.info({ companyId, dailyLimitPct, sessionLimitPct, usingDefaults: { daily: !input.dailyLimitPct, session: !input.sessionLimitPct } }, "stop-loss preflight");
```

**Risk if not changed**: Silent default application. Operators may not realize they're running at 5% daily when their risk model targets 10%.

---

## Decision 2 — Missing bankroll snapshot blocks all bets

**Code**: `betting-stop-loss.ts:182`

```typescript
if (currentBalance == null) {
  return { allowed: false, reason: "Missing bankroll baseline; refusing bet placement until bankroll snapshots exist." };
}
```

**Current behavior**: If `bettingBankrollSnapshots` is empty and the request omits `currentBalance`, every bet is blocked.

**Decision**: This is the right behavior — placing bets without a bankroll baseline means stop-loss cannot evaluate loss percentages. However, the error message should include the fix URL:

```typescript
reason: "Missing bankroll baseline. Add a snapshot via POST /api/companies/{companyId}/betting-bankroll-snapshots before placing bets."
```

**Also**: The deployment guide and readiness checklist must call out this requirement explicitly (added to `production-readiness-runbook.md`).

---

## Decision 3 — `retryAfterMs: 5000` in the 409 response is wrong for BBA execution times

**Code**: `betting-browser-automation.ts (route):246`

```typescript
return res.status(409).json({ error: "request_in_progress", retryAfterMs: 5000 });
```

**Problem**: A BBA execution takes 30–120s. A client retrying after 5s receives another 409. Repeated 5s retries waste network calls and pollute the log with false errors.

**Decision**: Change to `retryAfterMs: 30000` (30s). The client should wait 30s before retrying.

```typescript
return res.status(409).json({ error: "request_in_progress", retryAfterMs: 30000 });
```

This is a one-line change, zero risk. Merge independently of any larger PR.

---

## Decision 4 — DB-level idempotency key excludes `companyId`

**Code**: `betting-browser-automation.ts:1777`

```typescript
function generateIdempotencyKey(request: BettingAutomationRequest): string {
  const parts = [
    request.bookmakerConfig.bookmaker.toLowerCase().trim(),
    request.bet.matchLabel.toLowerCase().trim(),
    request.bet.market.toLowerCase().trim(),
    request.bet.selection.toLowerCase().trim(),
    String(request.bet.stake),
    day,
    request.issueId ?? "",
  ];
  // ↑ No request.companyId
```

**Risk**: Two companies placing the same bet (bookmaker+match+market+selection+stake+issueId) on the same day share a DB idempotency key. Company B's execution returns Company A's `placedBetId` and `status:"completed"` without actually placing a bet.

**Decision**: Add `request.companyId` as the first element of `parts`. This is a **money-critical fix** — currently only safe because in practice each company has different `issueId` values, but that's a fragile assumption.

```typescript
const parts = [
  request.companyId,   // ← add this
  request.bookmakerConfig.bookmaker.toLowerCase().trim(),
  ...
```

---

## Decision 5 — Cookie cache path must be per-company

**Pattern**: `COOKIE_CACHE_PATH` constant stores session cookies for CDP (persistent profile) sessions.

If `COOKIE_CACHE_PATH` is a single global path (not per-company), executing a CDP session for Company A and then Company B may inject Company A's cookies into Company B's browser context.

**Decision**: Before any production multi-company use, verify the `COOKIE_CACHE_PATH` definition. If not per-company, change to:

```typescript
const cookieCachePath = (companyId: string) =>
  path.join(homedir(), ".paperclip", "bba-memory", "cookies", `${companyId}.json`);
```

Pass `companyId` through to `persistSessionCookies` and the CDP warm-up cookie load.

---

## Decision 6 — CTO agent `maxTurnsPerRun=25` is too low for multi-file BBA changes

**Config**: `d9bd4d75 maxTurnsPerRun=25`

The CTO (codex_local, gpt-5.4) handles all technical tasks. The BBA subsystem spans ~30 files, ~6000 lines. Multi-file changes regularly require >25 turns to read files, plan, implement, test, and commit.

**Decision**: Increase to `maxTurnsPerRun=40`. Monitor whether this causes runaway sessions; revert to 30 if costs spike without quality improvement.

---

## Decision 7 — Playwright `slowMo: 0` in the ephemeral browser path

**Code**: `betting-browser-automation.ts:1956`

```typescript
browser = await browserType.launch({
  headless: runtime.headless,
  slowMo: 0,
  ...
});
```

`slowMo: 0` means no artificial delay between Playwright actions. The human-simulation layer (`typeHuman`, `clickHuman`, `moveMouseHuman`) provides realism at the application level. `slowMo` is redundant and keeping it at 0 is correct.

**Decision**: No change. Note: if anti-bot detection increases, `slowMo: 50` can be a quick experiment to add consistent inter-action delays at the Playwright level as a backup to the application-level simulation.

---

## Decision 8 — `waitForOddsReady` timeout is capped at 25s

**Code**: `betting-browser-automation.ts:1560`

```typescript
const deadline = Date.now() + Math.min(timeoutMs, 25_000);
```

This cap means odds are waited on for at most 25s regardless of `pageTimeoutMs`. If the Casa SPA takes longer than 25s to render odds (slow network, heavy JS bundle), `waitForOddsReady` exits without finding odds, and the subsequent `resolveSelectionButton` call likely fails.

**Decision**: Increase cap to `Math.min(timeoutMs, 45_000)` (45s). The current 25s cap was probably set conservatively; Casa's SPA typically loads in 5–15s but can be slower on poor connections.

---

## Decision 9 — BBA `graceSec=90` may not cover slow sessions

**Config**: BBA agent `graceSec=90`

`graceSec` is the number of seconds the runner gives the agent to finish cleanly after the turn budget is exhausted. A full Casa Pariurilor session (login + navigate + search + select + stake + submit + history verify) can take 60–90s. If the run approaches 50 turns near the session timeout, a 90s grace may cut the session short before `persistPlacedBet` is called.

**Decision**: Increase `graceSec` to 120. This gives the BBA agent 30 extra seconds to complete the placement write and return a result without being forcefully killed mid-execution.

---

## Priority Order for Implementation

| Priority | Decision | Risk | Effort |
|---|---|---|---|
| P1 | Decision 4 — add companyId to DB idempotency key | MONEY-CRITICAL | 1 line |
| P1 | Decision 3 — retryAfterMs 5000→30000 | Low | 1 line |
| P1 | Decision 5 — per-company cookie cache | HIGH (multi-company) | ~10 lines |
| P2 | Decision 2 — improve error message for missing snapshot | Low | 1 line |
| P2 | Decision 8 — increase waitForOddsReady cap to 45s | Medium | 1 line |
| P2 | Decision 9 — BBA graceSec 90→120 | Low | config change |
| P3 | Decision 6 — CTO maxTurnsPerRun 25→40 | Low | config change |
| P3 | Decision 1 — log default stop-loss parameters | Low | 2 lines |
| P3 | Decision 7 — slowMo=0 (no change) | n/a | n/a |
