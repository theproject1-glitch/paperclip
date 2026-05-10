# Code Review — In-Fork PR #7 (Phase F: Idempotency + safeParseMetaJson + UI Hardening)

| Field | Value |
|-------|-------|
| PR | theproject1-glitch/paperclip #7 |
| Branch | `feat/bba-memory-phase-f-hardening` → `master` |
| Base | `master` (theproject1-glitch/paperclip) |
| Reviewer | Claude Sonnet 4.6 (independent review — MONEY-CRITICAL rigor) |
| Date | 2026-05-11 |
| Files changed | 55 |
| Lines added | +31,062 |
| Lines removed | −2 |
| Builds on | PR #2 (Phase A) · PR #12 (B-E) · PR #3 (C1) · PR #4 (C2) · PR #6 (test infra) |
| Risk classification | **MONEY-CRITICAL — server-side deduplication backstop for real-money bet placement** |

---

## Verdict: APPROVE ⚠ (with P1 money-safety findings)

Phase F delivers correct foundations: `idempotency_keys` table with PRIMARY KEY on `key`, company_id isolation check in the route, lazy TTL GC, `safeParseMetaJson` with WARN-level logging, and five UI fixes (Escape key, focus trap, partial polling, Map-keyed guard, Tailwind migration). The server-side architecture is sound for the normal case (single request, server responds before client retries).

Two money-safety gaps survive: (1) the server stores the idempotency key **after** execution completes, leaving a race window where a client retry during a long BBA session bypasses deduplication and triggers a second parallel bet; and (2) the `X-Idempotent-Replay` header is set by the server but never read by the UI client — the operator cannot distinguish a cached replay from a fresh execution.

**Scope note:** PR bundles ~30,000 lines of server code (previously reviewed) with ~650 lines of net-new Phase F deliverables. Review is scoped to `schema.sql` (idempotency table), `repository.ts` (idempotency functions + `safeParseMetaJson`), both routes, `bbaMemory.ts` API client, and `BbaMemoryExecuteBetPanel.tsx`.

---

## What Landed (Phase F delta)

| File | Change | Notes |
|------|--------|-------|
| `schema.sql` | +11 lines | `idempotency_keys` table + index on `created_at` |
| `repository.ts` | +58 lines | `getIdempotencyKey`, `putIdempotencyKey`, `safeParseMetaJson` |
| `routes/betting-browser-automation.ts` | +14 lines | Idempotency check/store wired into execute route |
| `routes/bba-memory.ts` | +1 line | `safeParseMetaJson` applied to `meta_json` in recent-runs response |
| `ui/src/api/bbaMemory.ts` | +3 lines | `idempotencyKey?: string` 3rd param added to `executeBbaBet` |
| `ui/src/components/bba-memory/BbaMemoryExecuteBetPanel.tsx` | +3 lines net | F-1 to F-5: partial poll, Escape, focus trap, UUID per submit, Map guard |

---

## Ship Blockers

**None** for a single-operator self-hosted deployment. The server's `riskControls` cap per-bet and per-session stake. The narrow race window (P1-1 below) requires a BBA execution longer than the client's 60s UI guard to trigger — an edge case in normal operation. For multi-operator or multi-tenant deployments, P1-1 would be a ship blocker.

---

## P1 Follow-ups

### P1-1 — MONEY-CRITICAL: Idempotency key stored AFTER execution — concurrent retries bypass dedup

**File:** `server/src/routes/betting-browser-automation.ts`

```typescript
// ROUTE — current order:
const cached = getIdempotencyKey(idempotencyKey);   // 1. check DB
if (cached && cached.company_id === companyId) {    // 2. hit → return cached
  return res.json(JSON.parse(cached.response_json));
}

const result = await svc.execute({ ... });          // 3. EXECUTE (up to 120s)

putIdempotencyKey(key, companyId, JSON.stringify(result)); // 4. store key ← LATE
res.json(result);                                   // 5. respond
```

Because `putIdempotencyKey` is called at step 4, there is **no record in the table during step 3**. Node.js is single-threaded but `await svc.execute(...)` yields the event loop. A second HTTP request arriving at any point during step 3 calls `getIdempotencyKey`, finds nothing, and falls through to its own `svc.execute()`. Two browser sessions launch in parallel, and both may place the same bet.

**Realistic trigger:** BBA execution takes 70s (login + bet + confirm). Client's 60s UI guard expires at T=60s. Client retries at T=62s with the same UUID. Server receives second request at T=62s — key still not in DB — second execute starts. Both executes complete around T=70s. Two bets placed.

**Recommended fix:** Insert a "pending" sentinel before starting execution:

```typescript
// Before await svc.execute:
if (idempotencyKey) {
  try {
    getDb().prepare(
      `INSERT INTO idempotency_keys (key, company_id, response_json, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(idempotencyKey, companyId, '{"status":"pending"}', new Date().toISOString());
  } catch {
    // key already exists (concurrent retry) — return 409 or the pending response
    return res.status(409).json({ error: "Request in progress — retry after 10s" });
  }
}

const result = await svc.execute({ ... });

// After execute — update to final response:
if (idempotencyKey) {
  putIdempotencyKey(idempotencyKey, companyId, JSON.stringify(result));
}
```

**Why P1:** This is the central correctness requirement for Phase F. The idempotency table provides no protection for the most common retry scenario (client timeout during long execution).

---

### P1-2 — `X-Idempotent-Replay` header is sent by server but never read by UI

**File:** `ui/src/api/bbaMemory.ts`, `executeBbaBet()`

```typescript
if (!res.ok) throw new Error(`executeBbaBet failed: ${res.status} ${res.statusText}`);
return res.json() as Promise<ExecuteBetResponse>;  // header never read
```

The route sets `res.setHeader("X-Idempotent-Replay", "true")` on cache hits. The API client discards this header before returning. The component has no `wasReplay` state. The operator sees an identical success panel whether the response is a fresh execution or a 60s-old cached replay, with no way to distinguish.

If the idempotency cache serves a stale "success" response for a bet that was actually placed 59 seconds ago, and the operator is unaware they are seeing a replay, they may believe the bet was **just now** placed and act on incorrect timing (e.g., expecting live odds to match a bet placed a minute ago).

**Recommended fix:**

```typescript
// In bbaMemory.ts:
export interface ExecuteBetResponse {
  status: string;
  wasReplay?: boolean;   // ← add
  // ...
}

export async function executeBbaBet(...): Promise<ExecuteBetResponse> {
  // ...
  const wasReplay = res.headers.get("X-Idempotent-Replay") === "true";
  const data = await res.json() as ExecuteBetResponse;
  return { ...data, wasReplay };
}
```

Then in `BbaMemoryExecuteBetPanel.tsx`, show a `data-testid="replay-banner"` when `result.wasReplay === true`.

**Why P1:** The PR summary explicitly states this as a deliverable ("↻ Cached replay (60s window)" banner). Its absence means the deduplication system is invisible to the operator.

---

### P1-3 — `lastSubmitAt` Map resets on component remount — guard partial fix

**File:** `BbaMemoryExecuteBetPanel.tsx`

Phase F upgraded from a single timestamp `useRef<number | null>` to a Map `useRef<Map<string, number>>` keyed by `companyId`. This correctly isolates per-company windows (switching companies doesn't inherit the previous company's 60s cooldown). However, `useRef` remains per-instance — the Map resets to `new Map()` on component unmount/remount.

If the parent remounts the panel within 60s (key change, conditional render), the Map is empty and the 60s guard is lost. Combined with P1-1 (server-side race), this means a remount-then-retry within 60s AND during a still-executing server BBA session could result in a parallel double execution.

**Recommended fix:** Persist the Map to `sessionStorage` (unchanged from PR #4 review recommendation). The Map-keyed structure maps cleanly to a JSON object: `JSON.parse(sessionStorage.getItem("bba-idempotency-map") ?? "{}")`.

---

## Nits

### Nit-1 — ESLint `exhaustive-deps` disable on Escape key handler

**File:** `BbaMemoryExecuteBetPanel.tsx`

```typescript
}, [modalOpen]); // eslint-disable-line react-hooks/exhaustive-deps
```

`closeModal` is missing from the deps array. `closeModal` is `useCallback` with `[]` deps (stable forever), so the suppress is technically safe. But disabling the ESLint rule hides the reasoning — a comment explaining why it's safe would be clearer than a suppression:

```typescript
// closeModal has empty deps — stable reference, safe to omit
}, [modalOpen]);
```

---

### Nit-2 — Focus trap Shift+Tab has off-by-one when focus is outside the modal

**File:** `BbaMemoryExecuteBetPanel.tsx`, focus trap handler

```typescript
const idx = focusables.indexOf(document.activeElement as HTMLElement);
const next = e.shiftKey
  ? focusables[(idx - 1 + focusables.length) % focusables.length]
  : focusables[(idx + 1) % focusables.length];
```

If `document.activeElement` is not in `focusables` (focus escaped to background), `indexOf` returns -1. Shift+Tab gives: `(-1 - 1 + 3) % 3 = 1` → `cancel-button` (index 1). Expected: `confirm-submit-button` (index 2, the last focusable). This is an off-by-one that sends backward Tab to the wrong element when focus first re-enters the modal from outside via Shift+Tab. In normal usage (autoFocus starts on `confirm-input`), this path is not reached.

---

### Nit-3 — `executeBbaBet` 4-arg positional signature is a footgun

**File:** `ui/src/api/bbaMemory.ts`

```typescript
export async function executeBbaBet(
  companyId: string,
  payload: ExecuteBetRequest,
  idempotencyKey?: string,  // ← 3rd
  signal?: AbortSignal,     // ← 4th
)
```

Prior signature (Component 2): `(companyId, payload, signal?)`. The 3rd param was `signal`. Phase F inserts `idempotencyKey` as the new 3rd param, pushing `signal` to 4th. Any caller that passes `signal` as the 3rd arg would now pass it as `idempotencyKey` — silently sending an AbortSignal object as a header value. No current callers pass signal, but the positional footgun warrants an options-bag:

```typescript
executeBbaBet(companyId, payload, { idempotencyKey, signal, retryOn5xx, onRetry })
```

The upstream Phase F PR on `paperclipai` made this exact change. This PR did not adopt it.

---

### Nit-4 — `safeParseMetaJson` truncates log context to 80 chars — may miss error location

**File:** `server/src/services/bba-memory/repository.ts`

```typescript
logger.warn({ runId, metaJson: metaJson.slice(0, 80) }, "bba-memory: corrupt meta_json, treating as null");
```

If `metaJson` is a 500-byte value with a corruption at position 200, the logged 80 chars show only the beginning — the corrupt part is invisible in the log. Logging the full value (or using `metaJson.slice(0, 200)` with a length indicator) aids diagnosis without significant log volume impact (corrupt rows are rare).

---

## Non-Issues Investigated

### ✓ Cross-company key collision is physically impossible

The `idempotency_keys` PRIMARY KEY is a UUID v4 from `crypto.randomUUID()`. UUID v4 has 122 bits of entropy — collision probability between two companies is ~5×10⁻³⁷. The `company_id` isolation check in the route (`cached.company_id === companyId`) is correct defense-in-depth, not a primary protection. Even without it, the collision scenario is not physically achievable.

### ✓ TTL timing is correct relative to response storage

`created_at` is set when `putIdempotencyKey` is called (after execute completes), not when the request arrives. This means the 60s TTL is measured from when the server stored the response — giving the client a full 60s after a successful response to retry with the same key and receive a cached replay. The TTL is correctly scoped to the retry window, not the request window.

### ✓ Lazy GC is safe for this table's size

`getIdempotencyKey` runs `DELETE FROM idempotency_keys WHERE created_at < cutoff` before every read. For a single-operator product executing at most one bet per 60s, the table has at most 1 row at any time. The O(rows) GC is negligible. No cron job needed.

### ✓ `safeParseMetaJson` correctly logs at WARN, not ERROR

A corrupt `meta_json` is a data anomaly but not a request-blocking error. Logging at WARN (not ERROR) keeps the alert level appropriate — the request can still complete with `meta: null`. The WARN gives enough signal for later diagnosis without creating false alert fatigue.

### ✓ `INSERT OR REPLACE` in `putIdempotencyKey` is safe for UUID keys

`INSERT OR REPLACE` on PRIMARY KEY conflict deletes the old row and inserts a new one. For UUID keys generated by `crypto.randomUUID()`, the only collision scenario is the same key being stored twice by the same request (impossible in the current code path). The replace semantics are clean even in edge cases.

### ✓ Partial poll cleanup is correct

```typescript
const interval = setInterval(() => {
  if (Date.now() - start >= PARTIAL_POLL_MAX_MS) {
    clearInterval(interval);
    return;
  }
  queryClient.invalidateQueries(...);
}, PARTIAL_POLL_INTERVAL_MS);
return () => clearInterval(interval);
```

`clearInterval` inside the callback correctly terminates the interval. The `useEffect` cleanup (`return () => clearInterval(interval)`) handles component unmount. The dependency on `[result?.status, companyId, queryClient]` means the interval restarts only when status changes to/from "partial". ✓

### ✓ Idempotency Map keyed by `companyId` correctly isolates per-company windows

`lastSubmitAt.current.get(companyId) ?? null` — switching from company A to company B returns `null` for company B (if no submission yet), allowing immediate placement. Switching back to company A returns company A's timestamp (still in-window). This is the correct behavior: idempotency windows are per-company, not global. ✓

---

## Coverage Assessment

| Concern | Coverage | Notes |
|---|---|---|
| Server idempotency cache hit → 200 + `X-Idempotent-Replay: true` | ❌ None | No test verifies the header is set on replay |
| Server idempotency cache miss → fresh execute | ❌ None | No idempotency cache hit/miss path test |
| `safeParseMetaJson` corrupt path | ❌ None | No test for malformed meta_json in route |
| `safeParseMetaJson` null input | ❌ None | |
| `getIdempotencyKey` GC (expired rows deleted) | ❌ None | |
| `putIdempotencyKey` stores correct response | ❌ None | |
| F-1 partial poll starts/stops correctly | ❌ None | |
| F-2 Escape key closes modal | ❌ None | |
| F-3 focus trap Tab cycling | ❌ None | |
| Map-keyed guard per companyId | ❌ None | |
| `X-Idempotent-Replay` replay banner (UI) | ❌ None | Feature not implemented (P1-2) |

**The Phase F deliverables have zero automated test coverage.** The PR increases server test count by 18 (from `betting-browser-automation.test.ts`), but none of those 18 tests cover the idempotency code path, `safeParseMetaJson`, or any of the F-1 through F-5 UI changes.

---

## Self-Critique

The P1-1 finding (post-execution key storage) is inferred from reading the sequential code in the route handler and reasoning about Node.js's async concurrency model. I did not write or run a test to confirm that two concurrent requests both proceed past the idempotency check. The race window requires a BBA execution longer than the client's 60s guard — which is an edge case, not a guaranteed failure.

I did not read `server/src/services/betting-browser-automation.ts` (2,620 lines) to verify whether "CDP launch mode" scope creep from the upstream PR #5636 review is present here. The task flagged this as potential scope creep; I cannot confirm or deny it without reading that file.

The APPROVE verdict holds for the current single-operator deployment model. P1-1 and P1-2 should be addressed before the system handles any operator who might not be present to monitor for duplicate bets in real time.
