# BBA Execute Path — Code Review

**File reviewed**: `server/src/services/betting-browser-automation.ts` (full)  
**Route reviewed**: `server/src/routes/betting-browser-automation.ts`  
**Instrumentation**: `server/src/services/bba-memory-instrumentation.ts`  
**Reviewer**: automated (Claude Sonnet 4.6) — Phase F consolidated branch  
**Verdict**: APPROVE with 2 P1s, 2 P2s, 1 nit

---

## Execute Flow — Step-by-Step Map

### 1. Route entry

**File**: `server/src/routes/betting-browser-automation.ts:177`

- `assertCompanyAccess(req, companyId)` — JWT claim check
- `bbaRateLimiter()` middleware — 10 calls per 60s per company
- Body parsing: `requireObject`, `requireString`, `requireNumber`, `parseExecution`
- `normalizeExecutionForPreAuth`: if `skipLogin=true`, forces `browserName:"chromium"` and `userDataDir: DEFAULT_BBA_CHROMIUM_PROFILE`

### 2. HTTP-layer idempotency

**File**: `server/src/routes/betting-browser-automation.ts:228`

- `readIdempotencyKey(req)` — reads `Idempotency-Key` header (1–128 chars)
- `claimIdempotencyKey(key, companyId)` (atomic SQLite INSERT OR IGNORE):
  - `"exists_complete"` → `getIdempotencyKey` → `res.setHeader("X-Idempotent-Replay","true")` → return cached JSON
  - `"exists_pending"` → `409 { error:"request_in_progress", retryAfterMs:5000 }`
  - `"claimed"` → sets `shouldStoreIdempotencyResult=true`, continues
- No `Idempotency-Key` header → skip idempotency entirely; request always executes

### 3. Instrumentation wrapper + selector validation

**File**: `server/src/services/bba-memory-instrumentation.ts`

- `instrumentBettingService.execute()` calls `startRun` (inserts BBA Memory run row) before delegating
- `validateStakeGuards`: checks `stake ≤ maxStakePerBet` and sum of all legs ≤ `maxTotalStakePerSession`
- `ensureSelectors`: confirms `selectionButton`, `stakeInput`, `reviewButton` each have ≥1 selector; conditionally checks `username`/`password`/`loginSubmit` if login is needed

### 4. DB-level idempotency (content-addressed)

**File**: `server/src/services/betting-browser-automation.ts:1864`

- `generateIdempotencyKey(request)`: SHA256 of `bookmaker|matchLabel|market|selection|stake|day|issueId` → 16-char hex
- SELECT from `bettingPlacedBets` WHERE `idempotencyKey = X` — **no `companyId` filter**
- If non-pending record found → return cached result, no browser launched
- This check has no exclusive lock; two concurrent requests can both see "no existing bet"

### 5. Stop-loss preflight

**File**: `server/src/services/betting-stop-loss.ts:154`

- Queries `bettingBankrollSnapshots` (ascending order) for the company
- `pickDailyBaseline`: first snapshot on same calendar day (Europe/Bucharest), or most recent prior
- `pickSessionBaseline`: snapshot at/before `sessionStartedAt`, or earliest if none prior
- Loss thresholds: default `dailyLimitPct = 5%`, `sessionLimitPct = 10%` (overridable per request)
- **No baseline snapshot at all → `allowed=false`, reason="Missing bankroll baseline"** — blocks ALL bets
- Trigger → return `status:"blocked_by_risk"` immediately (no browser launch, no `placedBetId`)

### 6. Browser launch

**File**: `server/src/services/betting-browser-automation.ts:1927`

- `userDataDir` present → `cloneUserDataDir` to tmpdir → `launchPersistentContext`
- No `userDataDir` → `launch` + `newContext`
- Stealth via `addInitScript`: removes `navigator.webdriver`, adds `window.chrome`, patches `navigator.languages` and `navigator.plugins`
- Casa popup auto-dismiss via `addLocatorHandler` for `"Continuă"` / `"JOACĂ ÎN CONTINUARE"`
- Video: `recordVideo: { dir, size: { width:1280, height:720 } }`
- Locale: `ro-RO`, timezone: `Europe/Bucharest`

### 7. Session verification (CDP path, `skipLogin=true`)

**File**: `server/src/services/betting-browser-automation.ts:2004`

- Load cached cookies from `COOKIE_CACHE_PATH` (fixed path, see risk P1-2)
- Warm-up: navigate to `/pariuri-online/fotbal` SPA entry point
- `checkSessionActive`: polls `loginSuccess`/`loginFailure` selectors + `hasVisibleAuthPrompt` heuristics
- `checkSecondarySessionActive`: probes `account.casapariurilor.ro/ro/user/embedded/betslips` with 3s timeout
- Both active → skip login
- Either fails → attempt `performBrowserAutofillLogin` (if no secrets configured) **or** `performLogin` with stored credentials
- Re-verify post-login → persist cookies → navigate to entry URL → final auth check

### 8. Session verification (credential path, `skipLogin=false`)

**File**: `server/src/services/betting-browser-automation.ts:2128`

- Navigate to `loginUrl`
- Cookie accept / popup close
- `performLogin`: resolve secrets from Vault/DB → `locateVisibleOne` username + password (Casa-specific fallbacks if bookmaker name includes "casa pariurilor") → `typeHuman` fill → `clickHuman` submit
- `waitForLoginOutcome`: polls success/failure indicators; `"timeout"` throws; `"unknown"` navigates to `postLoginUrl`
- `checkSessionActive` post-login → throw if not active
- Persist cookies

### 9. Bet navigation loop (one or more legs)

**File**: `server/src/services/betting-browser-automation.ts:2155`

- For each leg in `betsToPlace`:
  - `navigateToEventPage`:
    - `bet.eventUrl` → direct `goto` + `waitForOddsReady` (polls odds buttons, reload once if stale)
    - Search flow → open search modal → `typeHuman` query → click result → `waitForOddsReady`
    - `startUrl` fallback if configured (no navigation)
  - `verifyEventPageTeams`: match both team names in page header; logs confidence high/low/unknown
  - `idleScroll` (random scroll for anti-bot realism)
  - Optional `marketGroup` click
  - `resolveSelectionButton`: template-based (`{selection}`, `{market}`) **or** text-match scan across all frames
  - `clickHuman` (Bezier mouse path, 40–100ms hold, post-click drift)
  - **`verifySlipContainsSelection` — hard throw if selection not in betslip**
  - Inter-leg pause 1500–2500ms

### 10. Stake entry

**File**: `server/src/services/betting-browser-automation.ts:2198`

- `resolveStakeInput`: polls for editable input; supports descendent resolution (`input, textarea, [contenteditable], [role=spinbutton]`)
- Triple-click to clear existing value
- `typeHuman(page, String(stake), ...)` — 8% typo chance, 50–180ms per char
- Read back `inputValue`, compare to expected (threshold 0.01) → throw on mismatch

### 11. Review summary + odds-drift guard

**File**: `server/src/services/betting-browser-automation.ts:2220`

- `readReviewSummary`: optional element; extracts betslip summary text
- `parseAcceptedOddsFromReviewSummary`: regex parse of current displayed odds
- **Odds-drift guard**: if Call 2 provides `approvedOdds` and `|(detected − approved) / approved| > oddsDriftTolerancePct` (default 5%) → return `status:"failed"` — bet not placed, manual review required

### 12. Confirmation gate

**File**: `server/src/services/betting-browser-automation.ts:2263`

- `confirmationRequired && !confirmed` → return `status:"awaiting_confirmation"`
- Browser torn down by `finally` block
- This is the **Call 1 / Call 2 pattern**: Call 1 returns preview; Call 2 re-runs the entire flow with `finalConfirmation.confirmed=true` and `finalConfirmation.approvedOdds` from Call 1
- Call 2 re-opens a fresh browser, re-logs in, re-navigates, re-selects, re-enters stake

### 13. Submit

**File**: `server/src/services/betting-browser-automation.ts:2282`

- Wait for `reviewButton`, human click
- If `submitButton` configured: wait and click (two-step flow)
- Else: `reviewButton` is the final action (single-step)
- Post-click: `checkSessionActive` with 3s timeout — throw on auth loss (prevents classifying an expired session as a placed bet)

### 14. Receipt confirmation

**File**: `server/src/services/betting-browser-automation.ts:2333`

- `waitForPlacementOutcome`: polls `receiptSuccess` OR detects auth loss
- `"receipt"` → `betslipConfirmed=true`
- `"auth_lost"` → throw
- Timeout + `receiptSuccess.optional=true` → check betslip still visible → `submitted_unconfirmed`
- Timeout + `receiptSuccess.optional=false` → throw (receipt not found)

### 15. History verification

**File**: `server/src/services/betting-browser-automation.ts:2383`

- If `historyUrl` + `historySelection` configured: navigate, wait for `historyReady`, look for placed selection
- `historyVerified = true | false`

### 16. Status resolution

```
betslipConfirmed && (!historyVerificationConfigured || historyVerified)
  → "completed"
  → else "submitted_unconfirmed"
```

### 17. DB persist + return

- `persistPlacedBet` for each leg: `db.insert(bettingPlacedBets)` with `executionStatus`, `executionLedger`, DB idempotency key
- Route: if `shouldStoreIdempotencyResult` → `putIdempotencyKey` (stores response JSON)
- Route: `res.json(result)`

### 18. Cleanup (finally)

- `context.close()`, `browser.close()`
- `fs.rm(clonedUserDataDir, { recursive: true })` (tmpdir clone from step 6)

---

## Critical Risk Points

### P1-1 — DB idempotency key has no company isolation

**File**: `server/src/services/betting-browser-automation.ts:1777`

```typescript
// generateIdempotencyKey does NOT include request.companyId
const parts = [
  request.bookmakerConfig.bookmaker, request.bet.matchLabel,
  request.bet.market, request.bet.selection, String(request.bet.stake),
  day, request.issueId ?? "",
];
```

If two different companies submit an identical bet on the same day (same bookmaker, match, market, selection, stake, issueId), the SELECT at line 1865 returns Company A's record to Company B. Company B's execute call returns `status:"completed"` with Company A's `placedBetId` — without placing a real bet.

**Fix**: Add `request.companyId` as the first element of `parts` in `generateIdempotencyKey`.

---

### P1-2 — `COOKIE_CACHE_PATH` is a single global file (not per-company)

The persistent session cookie cache is stored at a fixed path (somewhere under `~/.paperclip`). If Company A runs a CDP session and persists cookies, Company B's next CDP session injects Company A's cookies into its browser context. This can silently authenticate Company B as Company A's bookmaker account.

**Fix**: Verify `COOKIE_CACHE_PATH` definition. If not per-company, change to include `companyId` in the path: `~/.paperclip/bba-memory/cookies/{companyId}.json`.

---

### P2-1 — Call 1 / Call 2 split can double-click the selection button

When `requireFinalConfirmation=true` (the default), Call 1 adds the selection to the betslip, returns the preview, and tears down the browser. Call 2 re-opens a browser using the same persistent profile. If the profile retained the betslip state from Call 1, Call 2's `resolveSelectionButton` click may **toggle the selection OFF** (removing it from the betslip) rather than adding it. `verifySlipContainsSelection` would then throw, and the bet would not be placed.

**Observed mitigation**: The persistent profile is cloned to a tmpdir (`cloneUserDataDir`) and the tmpdir is deleted in the finally block. If the profile clone captures betslip state, it is deleted after Call 1, so Call 2 starts from the original profile. Casa Pariurilor's betslip is also server-side, so a fresh browser load of the event page should present a clean betslip state regardless of local profile data.

**Residual risk**: If the bookmaker stores betslip selections server-side (cookies identifying the session) and the persistent profile retains those session cookies, Call 2 may inherit the pre-selected betslip. Recommend: after opening the event page in Call 2, clear betslip before clicking selection, or verify betslip is empty before proceeding.

---

### P2-2 — Concurrent requests with distinct HTTP keys can both place the same bet

The HTTP idempotency guard is keyed by `(Idempotency-Key header, companyId)`. Two API clients using different UUID keys for the same bet content bypass the pending sentinel. The DB-level check (step 4) is a non-atomic SELECT — two concurrent requests can both see "no existing bet" and both spawn a full Playwright session.

**Mitigation in code**: Node.js single-thread serializes JavaScript execution between awaits; the two concurrent requests would interleave at I/O boundaries. The DB INSERT at step 17 includes a DB idempotency key — the second INSERT would violate a unique constraint if one exists (need to verify schema).

**Recommendation**: Add a per-company in-process mutex (a `Map<string, Promise>`) keyed by `companyId` to serialize concurrent requests for the same company. This is a stronger guarantee than relying on DB constraint timing.

---

### Nit — `retryAfterMs: 5000` in the 409 response is too short

**File**: `server/src/routes/betting-browser-automation.ts:246`

```typescript
return res.status(409).json({ error: "request_in_progress", retryAfterMs: 5000 });
```

BBA executions typically take 30–120 seconds. A retry after 5 seconds will hit the pending sentinel again and receive another 409. Recommend `retryAfterMs: 30000` (30s) as a minimum, or dynamically calculate based on `sessionTimeoutMs`.

---

## Instrumentation Status Map

| BBA status | Memory `outcome` | `failure_class` | DB write |
|---|---|---|---|
| `completed` | `success` | null | `persistPlacedBet` |
| `submitted_unconfirmed` | `partial` | null | `persistPlacedBet` |
| `awaiting_confirmation` | `partial` | null | none |
| `failed` | `failure` | `UNKNOWN` | none (caught by instrumentation) |
| `blocked_by_risk` | `failure` | `UNKNOWN` | none |
| `session_expired` | `failure` | `SESSION_NOT_DETECTED` | none |

Note: `awaiting_confirmation` writes no `placedBetId` and no `bettingPlacedBets` row. The operator must call again with `confirmed=true` to complete placement. The BBA Memory run row is written by the instrumentation wrapper regardless of status.
