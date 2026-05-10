# Code Review — In-Fork PR #6 (Test Infrastructure: testing-library + 43 UI Tests)

| Field | Value |
|-------|-------|
| PR | theproject1-glitch/paperclip #6 |
| Branch | `feat/bba-memory-ui-tests-infra` → `master` |
| Base | `master` (theproject1-glitch/paperclip) |
| Reviewer | Claude Sonnet 4.6 (independent senior review) |
| Date | 2026-05-10 |
| Files changed | 64 |
| Lines added | +32,029 |
| Lines removed | −4 |
| Builds on | PR #2 (Phase A) · PR #12 (Phase B-E) |

---

## Verdict: APPROVE

The testing-library setup is correct: happy-dom environment, jest-dom matchers loaded via `@testing-library/jest-dom/vitest`, `afterEach(cleanup)` preventing DOM leakage, TanStack Query wrappers with `retry: false` and `refetchInterval: false` preventing flake. 43 tests cover the full UI surface — all three API functions, the `useBbaMemoryRuns` hook (success/loading/error/options/refetch), and four components (render states + interaction flows + snapshots). Two genuine issues: a timezone-dependent inline snapshot and a localStorage polyfill that never fires in the chosen environment.

**Scope note:** PR bundles 29,000 lines of server code (already reviewed in PR #12) with ~1,800 lines of net-new UI deliverables. Review is scoped to the UI test infrastructure and the 6 test files. The server layer is not re-reviewed.

---

## What Landed (UI-specific delta)

| File | Lines | Notes |
|------|-------|-------|
| `ui/vitest.config.ts` | 1 change | `"node"` → `"happy-dom"` — the key infra change |
| `ui/vitest.setup.ts` | +9 | localStorage polyfill + jest-dom matchers + cleanup |
| `ui/package.json` | +6 / −2 | Adds `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `happy-dom` |
| `ui/src/api/bbaMemory.ts` | 120 | Full API client: `fetchRecentBbaRuns`, `fetchBbaStats`, `executeBbaBet` (+ typed request/response shapes) |
| `ui/src/components/bba-memory/useBbaMemoryRuns.ts` | 72 | TanStack Query hook bundling runs + stats queries |
| `ui/src/components/bba-memory/__tests__/bbaMemory.api.test.tsx` | 133 | 12 tests — all 3 API functions |
| `ui/src/components/bba-memory/__tests__/useBbaMemoryRuns.test.tsx` | 111 | 5 tests — hook lifecycle |
| `ui/src/components/bba-memory/__tests__/BbaMemoryExecuteBetPanel.test.tsx` | 167 | 10 tests — modal + execute flow |
| `ui/src/components/bba-memory/__tests__/BbaMemoryRecentRunsPanel.test.tsx` | 176 | 6 tests — loading/empty/table/error/stats/snapshot |
| `ui/src/components/bba-memory/__tests__/BbaOperatorPlayground.test.tsx` | 110 | 7 tests — unit (child components mocked) |
| `ui/src/components/bba-memory/__tests__/BbaOperatorPlayground.integration.test.tsx` | 67 | 3 tests — integration (full mount) |

**Test count breakdown:** 12 + 5 + 10 + 6 + 7 + 3 = **43 tests** ✓

---

## Ship Blockers

**None.**

---

## P1 Follow-ups

### P1-1 — Timezone-dependent inline snapshot will fail on UTC CI servers

**File:** `ui/src/components/bba-memory/__tests__/BbaMemoryRecentRunsPanel.test.tsx`, "snapshot of populated state" test

```typescript
// Test fixture:
startedAt: "2026-05-10T12:00:00Z",

// Snapshot asserts:
`"...5/10/2026, 3:00:00 PM..."`
```

The fixture is UTC noon (`12:00:00Z`). The snapshot captures `3:00:00 PM` — Romanian EET (UTC+3). On any CI runner in UTC (the default for GitHub Actions), `toLocaleString()` renders `12:00:00 PM` and the inline snapshot doesn't match.

This is a silent always-fail on CI. Every other environment (UTC dev machine, Docker container) will reproduce the break. The component appears to use `new Date(run.startedAt).toLocaleString()` without a fixed locale/timezone argument.

**Recommended fix — two options:**

Option A (component): Pass explicit locale + timezone to `toLocaleString`:
```typescript
new Date(run.startedAt).toLocaleString("en-US", { timeZone: "Europe/Bucharest" })
```
Then the snapshot is deterministic everywhere.

Option B (test): Replace the toLocaleString output in the snapshot with a pattern or assert only non-time fields:
```typescript
// Instead of textContent snapshot, assert structured data:
expect(screen.getByTestId("run-started-cell").textContent).toContain("2026");
```

**Why P1:** This test will fail in CI and every development environment outside EET. It's not a style issue — it's a broken test.

---

### P1-2 — `localStorage` polyfill in `vitest.setup.ts` is dead code in `happy-dom`

**File:** `ui/vitest.setup.ts` lines 1–26

```typescript
if (
  typeof globalThis.localStorage?.getItem !== "function"
  || typeof globalThis.localStorage?.setItem !== "function"
  // ...
) {
  installStorageMock(globalThis);
}
```

`happy-dom` fully implements the Web Storage API (`localStorage`, `sessionStorage`). The condition `typeof globalThis.localStorage?.getItem !== "function"` evaluates to `false` in happy-dom — the polyfill is never installed. The 26-line Map-backed localStorage implementation and the `window !== globalThis.localStorage` branch are both dead code.

This is misleading: a future maintainer adding localStorage-dependent code might assume the Map-backed mock is active (providing test isolation), when in fact happy-dom's own localStorage is running — and happy-dom's localStorage is **shared across tests within a file** (not cleared between `afterEach` calls). If two tests in the same file touch localStorage, they can interfere.

**Recommended fix:**

```typescript
// Option A: Delete the dead polyfill block (happy-dom handles it)
// Option B: Replace with explicit clear in afterEach:
afterEach(() => {
  localStorage.clear(); // happy-dom localStorage — clears between tests
});
```

**Why P1:** The polyfill creates a false sense of test isolation. Its presence discourages investigation of actual happy-dom localStorage behavior, which leaks state between tests.

---

## Nits

### Nit-1 — No coverage thresholds configured

**File:** `ui/vitest.config.ts`

The config has no `coverage` block. Running `vitest run --coverage` reports coverage but doesn't gate on any threshold. For a new test suite this is fine initially, but adding minimum thresholds (even permissive ones like 50% line coverage) creates a floor that prevents future regressions from silently dropping coverage.

```typescript
// Suggested addition:
coverage: {
  include: ["src/components/bba-memory/**"],
  thresholds: { lines: 50, functions: 50 },
},
```

---

### Nit-2 — `toHaveBeenCalledWith("c1", PAYLOAD)` doesn't survive signal addition

**File:** `BbaMemoryExecuteBetPanel.test.tsx`, test 5 ("calls executeBbaBet and shows success result panel")

```typescript
expect(mockExecute).toHaveBeenCalledWith("c1", PAYLOAD);
```

`executeBbaBet` has a 3rd optional `signal?: AbortSignal` parameter. If the component is updated to pass an `AbortController.signal` (e.g., for unmount cancellation), this assertion fails because `toHaveBeenCalledWith` is an exact argument match. The test is silently coupled to the absence of signal forwarding.

**Suggestion:** Use `expect.objectContaining` or add `undefined` as the explicit 3rd arg to document the intention:

```typescript
expect(mockExecute).toHaveBeenCalledWith("c1", PAYLOAD, expect.anything());
// or:
expect(mockExecute).toHaveBeenCalledWith("c1", PAYLOAD, undefined);
```

---

### Nit-3 — AbortSignal forwarding in `useBbaMemoryRuns` is untested

**File:** `ui/src/components/bba-memory/useBbaMemoryRuns.ts`, `useBbaMemoryRuns.test.tsx`

The hook correctly passes `signal` from TanStack Query's `queryFn` context to both `fetchRecentBbaRuns` and `fetchBbaStats`. This enables query cancellation on unmount. No test verifies that the signal is forwarded — a future refactor dropping the `{ signal }` spread would silently break cancellation with no test catch.

```typescript
// Suggested addition to useBbaMemoryRuns.test.tsx:
it("forwards AbortSignal to API functions", async () => {
  mockedFetchRuns.mockImplementation(async (_id, opts) => {
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
    return { companyId: "c1", limit: 20, total: 0, runs: [] };
  });
  // ...
});
```

---

### Nit-4 — `container.querySelector("hr")` is fragile to markup changes

**File:** `BbaOperatorPlayground.test.tsx`, "renders divider between execute panel and recent runs panel" test

```typescript
const divider = container.querySelector("hr");
expect(divider).toBeInTheDocument();
```

If the visual divider changes from `<hr>` to a `<div className="border-t">` (a common Tailwind pattern), this test fails even though the layout is still correct. The `compareDocumentPosition` ordering check is also semantically fragile — it's testing DOM structure, not user-visible behavior.

**Suggestion:** Use a `data-testid="bba-divider"` and assert it appears between the two panels, or drop the structural position test in favor of a layout integration test.

---

## Non-Issues Investigated

### ✓ `environment: "happy-dom"` applied globally to ui package is safe

The change from `environment: "node"` to `environment: "happy-dom"` applies to all tests in the `ui` package. This could break pre-existing tests that assume a node-only environment. Checked: the `ui` package had no pre-existing test files before this PR (the `package.json` had no `test` script). The blanket `happy-dom` setting is safe.

### ✓ `@testing-library/jest-dom/vitest` is the correct import for Vitest

`vitest.setup.ts` imports `@testing-library/jest-dom/vitest` (not `@testing-library/jest-dom`). The plain import targets Jest's `expect` extension API. The `/vitest` subpath correctly extends Vitest's `expect` with DOM matchers (`toBeInTheDocument`, `toHaveClass`, `toHaveStyle`, etc.). This is the documented pattern in `@testing-library/jest-dom` v6+.

### ✓ TanStack Query wrapper pattern (`retry: false, refetchInterval: false`) is correct

Every test file creates a fresh `QueryClient` per test via `makeWrapper()`. `retry: false` prevents Vitest from waiting through multiple retry backoffs on expected errors. `refetchInterval: false` prevents background polling from firing unexpected network requests during assertions. The fresh-per-test `QueryClient` ensures query cache doesn't leak between tests. Idiomatic and correct.

### ✓ `vi.hoisted()` usage in `BbaOperatorPlayground.test.tsx` is correct

```typescript
const { mockExecutePanel, mockRunsPanel } = vi.hoisted(() => ({
  mockExecutePanel: vi.fn(),
  mockRunsPanel: vi.fn(),
}));
```

`vi.hoisted()` runs its callback before module-level code, making the mock factory references available to `vi.mock()` calls that are hoisted to the top of the module. Without `vi.hoisted()`, the `mockExecutePanel` reference would be `undefined` when `vi.mock()` runs. Correct pattern for Vitest ≥ 1.x.

### ✓ Text-only snapshots are intentionally stable

Three snapshot tests use `container.firstChild?.textContent` or `asFragment().textContent` rather than full DOM structure. Text snapshots don't capture class names, attribute changes, or structural reorganization — they only catch visible text regressions. This is a deliberate trade-off: lower maintenance cost (no snapshot updates for CSS/structure changes) at the price of lower structural coverage. Acceptable for a first-pass test suite.

---

## Coverage Assessment

| Concern | Covered | Notes |
|---------|---------|-------|
| `fetchRecentBbaRuns` URL, params, error | ✅ 4 tests | URL-encoding tested |
| `fetchBbaStats` URL, params, error | ✅ 3 tests | windowDays param tested |
| `executeBbaBet` method, headers, body, error | ✅ 5 tests | credentials header tested |
| `useBbaMemoryRuns` success/loading/error | ✅ 3 tests | Core query states |
| `useBbaMemoryRuns` custom options | ✅ 1 test | limit, windowDays forwarded |
| `useBbaMemoryRuns` refetch | ✅ 1 test | Both queries re-triggered |
| ExecuteBetPanel modal gate (CONFIRM) | ✅ 1 test | Type-to-confirm UX |
| ExecuteBetPanel all 3 outcome states | ✅ 3 tests | success / failure / partial |
| ExecuteBetPanel error + idempotency | ✅ 2 tests | 60s cooldown tested |
| RecentRunsPanel loading / empty / table | ✅ 3 tests | |
| RecentRunsPanel error + stats card | ✅ 2 tests | |
| BbaOperatorPlayground preset switching | ✅ 4 tests | bookmaker + bet presets |
| BbaOperatorPlayground integration | ✅ 3 tests | Full mount including TanStack |
| AbortSignal forwarding | ❌ None | See Nit-3 |
| localStorage isolation between tests | ❌ Unclear | See P1-2 |

**Test count: 43.** Coverage of the intended UI surface is comprehensive for a first-pass test suite.

---

## Self-Critique

Review was conducted via static analysis on a branch with no changes to master; the 43 tests were not executed locally. The timezone P1 (P1-1) is inferred from the `startedAt: "2026-05-10T12:00:00Z"` fixture vs. `3:00:00 PM` snapshot text, and assumes the component uses `Date.toLocaleString()` without explicit timezone — I did not read the component implementation to confirm. If the component uses a fixed locale/timezone, P1-1 is a false positive.

I did not audit `ui/src/components/bba-memory/BbaMemoryExecuteBetPanel.tsx`, `BbaMemoryRecentRunsPanel.tsx`, or `BbaOperatorPlayground.tsx` — the source of truth for whether `data-testid` attributes and `data-outcome` attributes actually exist. Tests asserting on those attributes could be testing against attributes that the component doesn't emit.

The APPROVE verdict is appropriate: the test infrastructure is correctly configured, the testing patterns are idiomatic for React + Vitest + TanStack Query, and 43 tests is a meaningful baseline for a new UI subsystem.
