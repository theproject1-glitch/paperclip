# Review: PR #55 — CTO Runtime Cleanup + CDP Attach + Operator Scripts

**Branch**: `fix/cto-runtime-config`  
**Reviewer**: Claude Sonnet 4.6 (independent)  
**Date**: 2026-05-13  
**Verdict**: REQUEST CHANGES — 2 P1s must be addressed before merge

---

## Summary of Changes

PR #55 contains five distinct bundles:

1. **CDP attach** — `attachToUserChrome` / `chromeDebugPort` fields; `attachToUserChrome()` function; `shouldAttachToUserChrome()` predicate; no browser close in finally when attached
2. **Codex stderr noise filter** — extends `stripCodexRolloutNoise` → `stripCodexRuntimeNoise` to filter plugin-sync, shell-snapshot, and manifest warnings
3. **Server startup diagnostics** — `registerProcessDiagnostics()` in `server/src/index.ts` (unhandledRejection, uncaughtException, beforeExit, exit)
4. **Operator scripts** — `session-health.ps1`, `start-chrome-debug.ps1`, `trigger-test-bet.ps1`, `verify-bet.ps1`
5. **Docs** — `cdp-attach-review.md`, `cto-reliability-analysis.md`, `cto-runtime-config-fix.md`, `cto-runs-forensics.json`, `server-stability-investigation.md`

---

## P1-1 — CDP opt-in is implicit: bookmaker name = consent is wrong

**File**: `server/src/services/betting-browser-automation.ts`

```typescript
function shouldAttachToUserChrome(request: BettingAutomationRequest) {
  if (request.execution?.attachToUserChrome === true) return true;
  if (request.execution?.attachToUserChrome === false) return false;
  return isCasaPariurilorBookmaker(request.bookmakerConfig);  // ← DEFAULT ON
}
```

Any request where `bookmakerConfig.bookmaker` contains "casa pariurilor" and `execution.attachToUserChrome` is not explicitly set will attempt CDP attach to the user's live Chrome. This is a **semantic breaking change** for existing callers:

- An existing caller sending a Casa request without the new field now attaches to the user's live Chrome instead of launching an isolated Playwright browser.
- If Chrome is running with `--remote-debugging-port`, the agent **immediately begins interacting with the user's open tabs**. A tab navigation or form fill in the operator's real browser is not recoverable.
- If Chrome is not in debug mode, the call fails with an error — but this is a silent regression from the perspective of the caller who expected an isolated Playwright session.

The fundamental issue: **bookmaker name is not consent to touch the user's live browser**. That is an explicit opt-in, not a default.

**Required fix**: Change the default to `false`:

```typescript
function shouldAttachToUserChrome(request: BettingAutomationRequest) {
  // CDP attach is OPT-IN. Never default to attaching to the user's browser.
  return request.execution?.attachToUserChrome === true;
}
```

Callers that want CDP attach must pass `execution.attachToUserChrome: true` explicitly. Update `docs/cdp-attach-review.md` and `trigger-test-bet.ps1` accordingly (the script already sets `attachToUserChrome: $true` explicitly, so it doesn't break).

---

## P1-2 — CDP-attached sessions produce no video — audit trail gap

**File**: `server/src/services/betting-browser-automation.ts`

```typescript
const contextOptions = {
  ...
  recordVideo: { dir: paths.videoDir, size: { width: 1280, height: 720 } },
  ...
};
if (useUserChromeAttach) {
  // contextOptions never used — recordVideo never applied
  const attached = await attachToUserChrome(...);
  ...
} else if (userDataDir) {
  // contextOptions used here
  context = await browserType.launchPersistentContext(clonedUserDataDir, contextOptions);
```

CDP-attached sessions have **no video recording**. `contextOptions.recordVideo` is set but never passed to any context in the CDP path. The `paths.videoDir` directory is created but stays empty. Screenshots are taken correctly, but video is a required audit artifact for disputed bets.

This must be explicitly addressed before merge. Two options:

**Option A** (document the gap): Add `videoRecorded: false` to the `BettingAutomationResult` type and set it accordingly in the CDP path. Update `cdp-attach-review.md` to state that CDP sessions produce screenshots + trace but no video, and that the operator must use Playwright Trace Viewer for replay.

**Option B** (fill the gap): Enable `context.tracing.start()` for CDP-attached contexts and save the trace as a `.zip` in `paths.videoDir`. Playwright supports tracing on connected contexts. This produces an equivalent audit artifact.

Option A is the minimum fix. Option B is preferable if the timeline allows.

---

## Non-issues investigated

### Safety in `finally` block
`attachedToUserChrome` flag correctly prevents `context.close()` and `browser.close()` when the user's Chrome is reused. The `clonedUserDataDir` cleanup still runs (and is `null` on the CDP path, so the `fs.rm` call is a no-op). The browser is left open as documented. ✅

### `trigger-test-bet.ps1` stake cap
```powershell
if ($Stake -gt 2.0) {
  throw "Test mode: stake is capped at 2 RON. Requested: $Stake RON."
}
```
Hard cap at 2 RON. The `riskControls.maxStakePerBet = 2.0` in the payload is consistent with this. ✅

### `start-chrome-debug.ps1` safety
Script refuses to kill live Chrome (`Write-Warning "This script will not kill Chrome for you"`). It warns and exits 1 if Chrome is running without debug mode. ✅

### `normalizeExecutionForPreAuth` change
```typescript
if (execution?.skipLogin !== true || execution.attachToUserChrome === true) {
  return execution;
}
```
For CDP attach with `attachToUserChrome=true`: `attachToUserChrome === true` fires the early return — the persistent profile override is skipped. Correct. ✅

### Codex noise filter regexes
`CODEX_PLUGIN_SYNC_NOISE_RE` / `CODEX_SHELL_SNAPSHOT_NOISE_RE` / `CODEX_PLUGIN_MANIFEST_NOISE_RE` — all three are narrow patterns anchored to specific Rust module paths. They won't accidentally suppress real errors. The full-string `test()` on multiline chunks is correct (only filters chunks entirely matching noise). ✅

### Server diagnostics registration guard
`processDiagnosticsRegistered` boolean prevents double-registration if `registerProcessDiagnostics()` is accidentally called twice. `isMainModule()` check prevents hooks from firing in test imports. ✅

### `readUserChromeDebugVersion` error message
Error message is operator-actionable: it names the exact localhost port and instructs the operator to run `start-chrome-debug.ps1`. ✅

---

## P2 — `dismissCasaOverlays` regression: `form` removed from password-container guard

**File**: `server/src/services/betting-browser-automation.ts`

Before:
```javascript
const container = e.closest(".user-box-form, [role='dialog'], .modal, form");
if (container?.querySelector("input[type='password']")) return false;
```

After:
```javascript
const container = e.closest(
  ".user-box-form, [role='dialog'], .modal, [class*='modal'], [class*='Modal'], [class*='popup'], [class*='Popup']"
);
if (container?.querySelector("input[type='password']")) return false;
```

Removing `form` from the container selector reduces the scope of the password-input protection. If Casa has an inline login form that is not wrapped in a `[class*='modal']` or `[class*='popup']` container, the overlay dismisser could now click a close button inside that form where it previously would not.

The broader container selectors (`[class*='modal']`, `[class*='popup']`) are good additions (they catch more modal patterns). The `form` removal is the risk. The fix is simple: add `form` back:

```javascript
const container = e.closest(
  ".user-box-form, [role='dialog'], .modal, form, [class*='modal'], [class*='Modal'], [class*='popup'], [class*='Popup']"
);
```

---

## P2 — `applyBrowserStealthMitigations` `page.evaluate()` on attached real Chrome

**File**: `server/src/services/betting-browser-automation.ts`

```typescript
async function applyBrowserStealthMitigations(context: BrowserContext, page?: Page | null) {
  await context.addInitScript(patch);
  await page?.evaluate(patch).catch(() => undefined);  // ← fires on current page
}
```

For CDP-attached sessions, `page.evaluate(patch)` runs the stealth patch on the current Casa page in the user's real Chrome. The patch overwrites `window.chrome` (if already defined on a real Chrome), deletes `window.__playwright` and `window.__pw_manual`. These deletions are benign for Playwright's own automation but could interfere with Casa's JavaScript if it stores initialization data in `window.__playwright` (unlikely but possible).

For real Chrome, `navigator.webdriver` is already `undefined` and `window.chrome` is the real Chrome extension API. Overwriting `window.chrome` with the stub could break Chrome extension interactions on the page.

**Recommendation**: Skip `page.evaluate(patch)` on CDP-attached sessions (it's not needed — the real browser has no automation sentinel):

```typescript
async function applyBrowserStealthMitigations(context: BrowserContext, page?: Page | null, isCdpAttach = false) {
  await context.addInitScript(patch);
  if (!isCdpAttach) {
    await page?.evaluate(patch).catch(() => undefined);
  }
}
```

---

## Nits

### N1 — `cto-runs-forensics.json` belongs in `.claude/`, not `docs/`

Raw JSON debug data in `docs/` is noise for anyone reading the documentation. Move to `.claude/data/` or `.claude/forensics/`.

### N2 — `handleCasaInactivityPrompt` is called 3× per session (adds ~4–6s latency)

```typescript
// 1. After addLocatorHandler setup (~2s timeout)
await handleCasaInactivityPrompt(activePage, paths);
// 2. Before the bet loop (~2s timeout)
if (isCasaPariurilorBookmaker(...)) await handleCasaInactivityPrompt(page, paths);
// 3. Before each leg (~2s timeout × N legs)
if (isCasaPariurilorBookmaker(...)) await handleCasaInactivityPrompt(page, paths);
```

The `addLocatorHandler` registered just before call 1 handles this popup reactively on every subsequent Playwright action. Calls 2 and 3 are redundant with the handler (they check the same locators). They add up to `(1 + N_legs) × 2s = 4-6s` of extra polling per session.

**Suggestion**: Keep call 1 as a one-time initial check before the handler is fully active. Remove calls 2 and 3 — the `addLocatorHandler` will fire reactively during `maybeClickOptional`, `navigateToEventPage`, and `resolveSelectionButton`.

### N3 — Missing auth token on `trigger-test-bet.ps1`

The script sends the execute request without an `Authorization` header. If `assertCompanyAccess` is enforced on the route, the request will 401. The script should accept a `-Token` parameter and pass it as `Authorization: Bearer {token}`.

---

## Summary

| Finding | Severity | Fix |
|---|---|---|
| CDP opt-in defaults to ON for all Casa requests | **P1** | Change `shouldAttachToUserChrome` default to `false` |
| CDP sessions produce no video | **P1** | Document (Option A) or add tracing (Option B) |
| `dismissCasaOverlays` `form` guard removed | P2 | Add `form` back to container selector |
| `applyBrowserStealthMitigations` patching real Chrome | P2 | Skip `evaluate()` on CDP attach path |
| Forensics JSON in `docs/` | Nit | Move to `.claude/` |
| Triple `handleCasaInactivityPrompt` calls | Nit | Remove calls 2 and 3 |
| Missing auth header in `trigger-test-bet.ps1` | Nit | Add `-Token` parameter |

**Ship blockers**: 2 (P1-1, P1-2)

The noise filter, server diagnostics, operator scripts, and documentation are all good work and can merge once the two P1s are addressed. The CDP implementation fundamentals are correct (browser not closed, error message is actionable, preflight check before attach). The only issue with CDP is the opt-in story and the missing video audit trail.
