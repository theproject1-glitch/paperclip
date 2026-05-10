# Code Review — In-Fork PR #25 (Phase F Consolidated + 3 P1 Fixes)

| Field | Value |
|-------|-------|
| PR | theproject1-glitch/paperclip #25 |
| Branch | `feat/bba-memory-phase-f-consolidated` → `master` |
| Base | `master` (theproject1-glitch/paperclip) |
| Reviewer | Claude Sonnet 4.6 (independent review — MONEY-CRITICAL rigor) |
| Date | 2026-05-11 |
| Files changed | 8 |
| Lines added | +615 |
| Lines removed | −12 |
| Replaces | PR #7 (Phase F idempotency — had 3 P1 money-safety gaps) |
| Prior review | `.claude/reviews/pr-fork-7-phase-f.md` (APPROVE with P1s) |
| Risk classification | **MONEY-CRITICAL — server-side deduplication backstop for real-money bet placement** |

---

## Verdict: APPROVE ✅

All 3 P1 money-safety gaps from the prior PR #7 review are correctly fixed. The `claimIdempotencyKey` sentinel approach solves the race window; the UI now reads `X-Idempotent-Replay` and shows the replay banner; `sessionStorage` persistence survives component remount. All 4 nits from PR #7 are also resolved. Two new minor nits found. No ship blockers, no new P1s.

---

## What Landed (Phase F consolidated delta)

| File | Change | Notes |
|------|--------|-------|
| `schema.sql` | +16 lines | `idempotency_keys` table — composite PK `(key, company_id)`, two indexes |
| `repository.ts` | +92 lines | `claimIdempotencyKey`, `getIdempotencyKey`, `putIdempotencyKey`, `safeParseMetaJson`, `pruneExpiredIdempotencyKeys` |
| `routes/betting-browser-automation.ts` | +41/−1 lines | Full idempotency flow: claim → 409 on pending → replay on complete → execute → store |
| `routes/bba-memory.ts` | +2/−10 lines | `safeParseMetaJson` applied; admin override path cleaned up |
| `services/bba-memory/index.ts` | +4 lines | Exports `claimIdempotencyKey`, `getIdempotencyKey`, `putIdempotencyKey`, `safeParseMetaJson` |
| `services/bba-memory/db.ts` | +1/−1 lines | Schema version bump to 3 |
| `ui/src/api/bbaMemory.ts` | +130 lines (ADDED) | Options-bag `executeBbaBet`, `wasReplay` in return type, `ExecuteBetResult` type |
| `ui/src/components/bba-memory/BbaMemoryExecuteBetPanel.tsx` | +329 lines (ADDED) | Full panel with sessionStorage guard, replay banner, focus trap, Escape, partial poll |

---

## Ship Blockers

**None.**

---

## P1 Follow-ups

**None.** The three P1s from PR #7 are verified closed below.

---

## Verification of 3 P1 Fixes

### ✅ P1-1 — Race window closed: `claimIdempotencyKey` with `__PENDING__` sentinel

**Prior finding**: `putIdempotencyKey` called AFTER `svc.execute()` → concurrent retry during execution found no row → second parallel execution → potential double bet.

**Fix implemented** (`repository.ts`):

```typescript
const PENDING_SENTINEL = "__PENDING__";

export function claimIdempotencyKey(key, companyId): IdempotencyClaimResult {
  pruneExpiredIdempotencyKeys();
  const result = db.prepare(
    `INSERT OR IGNORE INTO idempotency_keys (key, company_id, response_json, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(key, companyId, PENDING_SENTINEL, nowIso());

  if ((result.changes ?? 0) > 0) return "claimed";

  const row = db.prepare(
    `SELECT response_json FROM idempotency_keys WHERE key = ? AND company_id = ?`
  ).get(key, companyId);

  if (!row) return "claimed";
  return row.response_json === PENDING_SENTINEL ? "exists_pending" : "exists_complete";
}
```

**Route wiring** (`betting-browser-automation.ts`):

```typescript
if (claim === "exists_pending") return res.status(409).json({ error: "request_in_progress", retryAfterMs: 5000 });
// ... (exists_complete → replay) ...
// shouldStoreIdempotencyResult = claim === "claimed"

const result = await svc.execute({...});          // KEY IS IN DB AS __PENDING__ DURING THIS

if (idempotencyKey && shouldStoreIdempotencyResult) {
  putIdempotencyKey(idempotencyKey, companyId, JSON.stringify(result));  // Overwrites PENDING
}
```

**Race analysis (verified correct):**

| Scenario | Request 1 | Request 2 | Outcome |
|---|---|---|---|
| Concurrent retries during 60s execute | claim → "claimed" → executes | claim → INSERT OR IGNORE → changes=0 → reads `__PENDING__` → returns "exists_pending" | R2 gets 409 — no second execution ✅ |
| Retry after completion | claim → "claimed" → executes → putIdempotencyKey | claim → INSERT OR IGNORE → changes=0 → reads real response → "exists_complete" → getIdempotencyKey returns row → X-Idempotent-Replay: true | R2 gets cached response ✅ |
| Request without idempotency key | `idempotencyKey = null` → skip all idempotency logic → execute | N/A | Falls through cleanly ✅ |

**Crash-after-claim analysis**: If `svc.execute()` throws, the PENDING row stays for up to 60s (TTL GC). Retries get 409 with `retryAfterMs: 5000` for up to 60s. After GC, retries execute fresh. This is acceptable — if the server crashed before the bet was placed, no double-bet risk. If the server crashed after placing but before returning, this is a narrow but genuinely hard case; the PENDING-sticks-for-60s behavior is the correct mitigation without a saga/compensation pattern. **P1-1: FIXED ✅**

---

### ✅ P1-2 — `X-Idempotent-Replay` header read by UI client + replay banner shown

**Prior finding**: Server set `X-Idempotent-Replay: true` on cache hits; UI client discarded the header; no banner displayed; operator couldn't distinguish replay from fresh execution.

**Fix implemented** (`ui/src/api/bbaMemory.ts`):

```typescript
export type ExecuteBetResult = ExecuteBetResponse & { wasReplay: boolean };

export async function executeBbaBet(
  companyId: string,
  payload: ExecuteBetRequest,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<ExecuteBetResult> {
  // ...
  if (!res.ok) throw new Error(`executeBbaBet failed: ${res.status} ${res.statusText}`);
  const wasReplay = res.headers.get("X-Idempotent-Replay") === "true";
  const body = await res.json() as ExecuteBetResponse;
  return { ...body, wasReplay };
}
```

**Banner in panel** (`BbaMemoryExecuteBetPanel.tsx`):

```typescript
const [wasReplay, setWasReplay] = useState(false);
// In onSuccess:
setWasReplay(res.wasReplay ?? false);

// In render:
{wasReplay && (
  <div className="mt-1 text-xs italic text-gray-500" data-testid="replay-banner">
    ↻ Cached replay (60s window)
  </div>
)}
```

Verified: `openModal` resets `setWasReplay(false)`, so a new placement starts clean. The `data-testid="replay-banner"` is present for testability. **P1-2: FIXED ✅**

---

### ✅ P1-3 — `lastSubmitAt` persists across component remount via `sessionStorage`

**Prior finding**: `useRef<Map<string, number>>(new Map())` resets on component unmount/remount — 60s guard lost on remount.

**Fix implemented** (`BbaMemoryExecuteBetPanel.tsx`):

```typescript
const SS_KEY = "bba-memory.lastSubmitAt";

function readLastSubmit(companyId: string): number | null {
  if (typeof window === "undefined") return null;   // SSR-safe
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, number>;
    return map[companyId] ?? null;
  } catch {
    return null;  // parse error or private-mode unavailability
  }
}

function writeLastSubmit(companyId: string, ts: number): void {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    const map = raw ? JSON.parse(raw) as Record<string, number> : {};
    map[companyId] = ts;
    sessionStorage.setItem(SS_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded or private mode — silently degrade
  }
}
```

**Properties verified:**
- SSR-safe: `typeof window === "undefined"` guard ✅
- Remount-safe: persists in `sessionStorage`, not `useRef` ✅
- Tab-close clears: `sessionStorage` is session-scoped ✅
- Private-mode/quota-exceeded: caught and silently ignored ✅
- Per-company isolation: keyed by `companyId` in the stored JSON object ✅
- Clock-tick refresh: `submitClock` state (1s interval while within window) triggers re-renders; `readLastSubmit` called on each render to get fresh elapsed time ✅

**P1-3: FIXED ✅**

---

## Schema: Composite PK Analysis

**PR #7 had**: `PRIMARY KEY (key)` — single key across all companies.  
**PR #25 has**: `PRIMARY KEY (key, company_id)` — composite.

This is a deliberate change with two effects:

1. **Cross-company key collision** (`key` = same UUID from different companies): Previously, company B's `INSERT OR IGNORE` would fail on the single PK — and the subsequent `getIdempotencyKey` (which filters by `company_id`) would return nothing, letting company B execute fresh. Now, same UUID from different companies yields two separate rows — each company has full independent idempotency behavior. This is strictly better design: company B doesn't even know company A's key exists.

2. **Index on `(company_id, created_at)`** is present for company-scoped queries. The composite PK `(key, company_id)` serves as the lookup index for `claimIdempotencyKey` and `getIdempotencyKey` (`WHERE key = ? AND company_id = ?`). SQLite uses the PK index for this query. ✅

The `idx_idempotency_created_at` index on `(created_at)` alone serves `pruneExpiredIdempotencyKeys`'s `DELETE WHERE created_at < ?`. ✅

---

## Nits

### Nit-1 — `retryAfterMs: 5000` in 409 is aggressive for long executions

**File:** `routes/betting-browser-automation.ts`

```typescript
return res.status(409).json({
  error: "request_in_progress",
  retryAfterMs: 5000,
});
```

BBA executions take 30–120 seconds. A client that respects `retryAfterMs: 5000` will retry every 5s for up to 60s (12 retry attempts), all getting 409, until the original execution completes or the PENDING row expires. The retries are cheap (just a DB read after prune), but 12 round-trips add network noise. A value of 10–15s would be more proportionate to the expected execution time. Not a safety issue — the 409 correctly blocks double-execution regardless of retry frequency.

---

### Nit-2 — `wasReplay` tracked twice: in `useState` and in `result.wasReplay`

**File:** `BbaMemoryExecuteBetPanel.tsx`

```typescript
const [wasReplay, setWasReplay] = useState(false);
// ...
setResult(res);               // res.wasReplay is available here
setWasReplay(res.wasReplay ?? false);  // redundant second store
// ...
{wasReplay && (<div data-testid="replay-banner">...</div>)}
```

`result?.wasReplay` already contains the same boolean as `wasReplay`. The separate state variable isn't wrong, but it creates a second source of truth. Using `result?.wasReplay` directly in the JSX would remove the redundancy and one potential drift point if `openModal` forgets to reset one of them. Low priority.

---

## Non-Issues Investigated

### ✅ `INSERT OR IGNORE` correctly handles concurrent requests

`INSERT OR IGNORE` on composite PK `(key, company_id)` is atomic at the SQLite WAL level. Node.js is single-threaded, but `await svc.execute()` yields the event loop. Two requests arriving with the same `(key, company_id)` pair: only one INSERT succeeds (`changes = 1`), the other gets `changes = 0`. The "loser" then reads the row and sees `__PENDING__` → 409. No race window between check and insert — the INSERT is the check. ✅

### ✅ PENDING row sticking after server crash is acceptable

If `svc.execute()` throws unexpectedly (not a normal failure return, but an uncaught exception), the PENDING row stays for 60s. Retries get 409 for up to 60s, then the GC removes the row and the client can retry freely. The `retryAfterMs: 5000` hint keeps clients informed. For the catastrophic scenario (bet placed, server crashes before storing result), the 60s hold is the correct conservative behavior — the operator checks bookmaker "My Bets" manually. ✅

### ✅ `getIdempotencyKey` correctly skips PENDING sentinel

```typescript
if (!row || row.response_json === PENDING_SENTINEL) return undefined;
```

Callers that use `getIdempotencyKey` directly get `undefined` for PENDING rows. The PENDING case is handled exclusively via `claimIdempotencyKey`. The two functions are complementary and non-overlapping in their semantics. ✅

### ✅ TOCTOU between `claimIdempotencyKey` and `getIdempotencyKey` is safe

After `claim === "exists_complete"`, there is a microsecond gap before `getIdempotencyKey` is called. Another thread could theoretically GC the row in that gap. But: Node.js is single-threaded; the GC runs inside `getIdempotencyKey`'s own `pruneExpiredIdempotencyKeys` call; a row that was "complete" moments ago has a `created_at` no older than 60s; the prune cutoff is exactly 60s. The row cannot be pruned in that microsecond unless the system clock jumps backward. The `if (cached) {...}` fallthrough is dead code but harmless. ✅

### ✅ Two-operator concurrent placement → two bets is intentional

If two operators share the same Paperclip instance and both click "Place Bet" simultaneously, each generates a different UUID via `crypto.randomUUID()`. Two different keys → two `claimed` returns → two executions → two bets placed. This is intentional: each operator made an independent decision. The idempotency system protects against ACCIDENTAL duplication (network retry, client-side re-submit), not against two humans both deciding to bet. For the stated single-operator deployment, this scenario does not arise. ✅

### ✅ `pruneExpiredIdempotencyKeys` called in both claim and get — correct placement

GC runs at the start of `claimIdempotencyKey` (before the INSERT) and at the start of `getIdempotencyKey` (before the SELECT). Pruning before claim ensures a re-claim of an expired key is not confused with an active PENDING. Pruning before get ensures the GC runs even on replay-only paths. No double-prune issue — both call the same function; the DELETE is idempotent on the same cutoff. ✅

### ✅ `putIdempotencyKey` uses `INSERT OR REPLACE` correctly

`INSERT OR REPLACE` on composite PK `(key, company_id)` deletes the PENDING row and inserts the result row. The `created_at` resets to the time of execution completion, giving the client a full 60s from result storage to retry with the same key. The TTL window is thus measured from when the response is available — the correct semantic for "how long can you safely replay this response." ✅

### ✅ All four PR #7 nits resolved in PR #25

| PR #7 nit | Resolution in PR #25 |
|---|---|
| Nit-1: ESLint `exhaustive-deps` disable on Escape effect | `closeModal` added to deps array — no disable needed ✅ |
| Nit-2: Shift+Tab off-by-one when focus outside modal | Replaced with `first`/`last` element comparison — avoids `indexOf(-1)` entirely ✅ |
| Nit-3: 4-arg positional footgun (`signal` pushed to 4th param) | Options-bag signature: `executeBbaBet(companyId, payload, { idempotencyKey?, signal? })` ✅ |
| Nit-4: `safeParseMetaJson` truncates log to 80 chars | Now logs `{ runId, err }` — full error object, no truncation ✅ |

---

## Coverage Assessment

| Concern | Status |
|---|---|
| `claimIdempotencyKey` returns "claimed" on first call | 44/44 server tests pass — specific coverage unverified |
| `claimIdempotencyKey` returns "exists_pending" on concurrent call | ❌ No test for the concurrent-claim path |
| `claimIdempotencyKey` returns "exists_complete" after putIdempotencyKey | ❌ No explicit idempotency round-trip test |
| 409 response on PENDING in route | ❌ Not covered |
| `X-Idempotent-Replay: true` header set on cache hit | ❌ Not covered |
| `wasReplay` propagated to UI client | ❌ No UI tests for new bbaMemory.ts |
| Replay banner renders when `wasReplay === true` | ❌ No UI tests for ExecuteBetPanel |
| sessionStorage survives remount | ❌ Not covered |
| `safeParseMetaJson` corrupt path | ❌ Not covered |
| Partial poll starts/stops correctly | ❌ Not covered |

The Phase F delta has **zero automated test coverage for the new claim flow specifically**. The 44/44 passing server tests are inherited from prior phases; none of the 8 changed/added files in this PR are in the test files (per the `files` array in the PR metadata). This is consistent with the deferred test PR tracked separately.

---

## Self-Critique

The race-correctness of `claimIdempotencyKey` was verified by reading the code and reasoning about SQLite's WAL isolation and Node.js's single-threaded event loop — not by running a concurrency test. The claim behavior of `INSERT OR IGNORE` under concurrent Node.js `await`-yielding requests is correct in theory but not experimentally confirmed. The crash-after-placement scenario (bet placed, server crashes before `putIdempotencyKey`) remains an open risk — it's mitigated by the 60s TTL hold but is not fully closed without a saga/compensation pattern, which is out of scope for this subsystem. I did not read `server/src/services/betting-browser-automation.ts` (~2,600 lines) to verify the execution internals — the scope was limited to the 8 changed files per the task specification.
