# Architectural Decision Spec: CDP Attach — Ship Blockers

**Status**: DECISION REQUIRED before PR #55 can merge  
**PR**: `fix/cto-runtime-config` (PR #55 — CDP attach + operator scripts)  
**Raised by**: Code review `.claude/reviews/pr-55-cdp-replay.md`  
**Date**: 2026-05-13

---

## Background

PR #55 introduces `attachToUserChrome` / `chromeDebugPort` — a mechanism to attach Playwright to the operator's already-running Chrome process via CDP (Chrome DevTools Protocol) instead of launching an isolated browser. The use case: when the operator has a logged-in Casa session open, BBA can reuse that session without re-authenticating.

Two ship blockers were raised. This document specifies the required fixes.

---

## P1-1: Implicit CDP opt-in

### The problem

```typescript
function shouldAttachToUserChrome(request: BettingAutomationRequest) {
  if (request.execution?.attachToUserChrome === true) return true;
  if (request.execution?.attachToUserChrome === false) return false;
  return isCasaPariurilorBookmaker(request.bookmakerConfig);  // ← DEFAULT ON for Casa
}
```

Any Casa Pariurilor request that omits `execution.attachToUserChrome` will attempt CDP attach by default. This means:

1. **Existing callers break silently**: A Casa request that worked before (launching isolated Playwright) now attaches to the operator's live Chrome. If Chrome is open without `--remote-debugging-port`, the call fails. If Chrome *is* in debug mode, the agent begins interacting with the operator's live tabs immediately — tab navigations and form fills in real Chrome are not recoverable.

2. **Bookmaker name is not consent**: Identifying a request as "Casa" is a routing decision, not an authorization to touch the user's live browser. These are semantically different operations.

3. **BBA agent confusion**: The BBA prompt (before this fix) didn't distinguish between CDP mode and isolated mode. The agent will follow whatever defaults the API applies, which means unexpected CDP sessions.

### Decision: opt-in only, default OFF

**Required change** (`server/src/services/betting-browser-automation.ts`):

```typescript
function shouldAttachToUserChrome(request: BettingAutomationRequest) {
  // CDP attach is OPT-IN. Bookmaker identity is not consent to touch the user's live browser.
  return request.execution?.attachToUserChrome === true;
}
```

**Rationale:**
- Explicit opt-in is the only safe default for any operation that touches the user's live browser.
- The three-way logic (`true` / `false` / implicit-by-bookmaker-name) collapses to one: `=== true`. Callers that don't set the field get isolated Playwright. This is backwards-compatible with all pre-PR-#55 callers.
- `trigger-test-bet.ps1` already sets `attachToUserChrome: $true` explicitly, so the operator script continues to work.
- The BBA `bba-paste-ready.md` prompt does not reference `attachToUserChrome` (it was removed pending PR #55 merge). Once PR #55 ships with this fix, update the BBA prompt to mention CDP mode as an explicit option with the requirement `attachToUserChrome: true`.

**No API schema change needed**: `attachToUserChrome` remains optional; `undefined` (not provided) now means `false`. This is the semantics callers already expect.

---

## P1-2: CDP sessions produce no video audit trail

### The problem

```typescript
const contextOptions = {
  recordVideo: { dir: paths.videoDir, size: { width: 1280, height: 720 } },
  ...
};

if (useUserChromeAttach) {
  // contextOptions is never passed here
  const attached = await attachToUserChrome(...);
  context = attached.context;   // ← no recordVideo
} else if (userDataDir) {
  context = await browserType.launchPersistentContext(clonedUserDataDir, contextOptions); // ← has recordVideo
}
```

For CDP-attached sessions:
- `paths.videoDir` is created but stays empty.
- `contextOptions.recordVideo` is constructed but never applied (it can't be — CDP attach uses an existing browser context).
- Screenshots (`paths.screenshotsDir`) are taken correctly.
- The result object has `videoPath: paths.videoDir`, which is misleading (the directory is empty).

For disputed bets, video is the most compelling audit artifact — it shows exactly what appeared on screen, not just network traffic.

### Decision: Playwright tracing as the audit artifact for CDP sessions (Option B)

**Recommendation**: Enable `context.tracing.start()` for CDP-attached contexts and save the trace. Playwright tracing is supported on contexts connected via CDP. The trace includes:
- All network requests/responses
- All DOM snapshots (equivalent to screenshots at each action)
- Timeline of all Playwright actions
- JavaScript console output

A Playwright trace `.zip` opened in `npx playwright show-trace` provides replay-equivalent fidelity to video. This is the existing audit path for non-CDP sessions.

**Required changes** (`server/src/services/betting-browser-automation.ts`):

```typescript
if (useUserChromeAttach) {
  const attached = await attachToUserChrome(chromeDebugPort, runId);
  context = attached.context;
  // CDP path: no video recording possible. Use tracing instead.
  await context.tracing.start({ screenshots: true, snapshots: true });
  attachedToUserChrome = true;
}

// ... in the finally block, alongside trace save for non-CDP path:
if (useUserChromeAttach && context) {
  try {
    await context.tracing.stop({ path: path.join(paths.sessionDir, "trace.zip") });
  } catch { /* non-fatal */ }
}
```

**Also update `BettingAutomationResult`**:

```typescript
interface BettingAutomationResult {
  // ...
  videoRecorded: boolean;   // true for isolated Playwright sessions, false for CDP
  traceRecorded: boolean;   // true for both paths after this fix
}
```

Set `videoRecorded: false, traceRecorded: true` in the CDP result path.

**Why not Option A (document the gap)?** 
Option A documents the missing artifact without filling it. For a live-money system, a disputed bet with no video *and* no trace creates an unresolvable situation. Option B adds ~2 lines and eliminates the gap entirely. The timeline cost is a few hours; the risk cost of a dispute without an audit trail is higher.

**Fallback if tracing fails on CDP**: Wrap in try/catch and set `traceRecorded: false`. The bet placement proceeds regardless — tracing failure is not a bet failure. Log a warning so the operator knows the session has no trace.

---

## P2 items (not ship blockers, but fix before next session)

These are improvements, not blockers. Fix in PR #55 or a follow-up PR immediately after:

### P2-a: `dismissCasaOverlays` — add `form` back to container selector

The `form` selector was removed when modal patterns were broadened. Risk: inline login forms no longer protected. One-line fix:

```typescript
const container = e.closest(
  ".user-box-form, [role='dialog'], .modal, form, [class*='modal'], [class*='Modal'], [class*='popup'], [class*='Popup']"
);
```

### P2-b: Skip stealth `evaluate()` on CDP-attached sessions

`applyBrowserStealthMitigations` runs `page.evaluate(patch)` which overwrites `window.chrome` on the user's real Chrome. For CDP sessions, the real browser has no automation sentinel — stealth patching is unnecessary and could break Chrome extension interactions:

```typescript
async function applyBrowserStealthMitigations(
  context: BrowserContext, 
  page?: Page | null, 
  isCdpAttach = false
) {
  await context.addInitScript(patch);
  if (!isCdpAttach) {
    await page?.evaluate(patch).catch(() => undefined);
  }
}
```

---

## Merge gate

PR #55 may merge only when:

- [ ] `shouldAttachToUserChrome` returns `false` by default (P1-1 fix)
- [ ] CDP sessions produce a `trace.zip` in `paths.sessionDir` (P1-2 fix)
- [ ] `BettingAutomationResult` includes `videoRecorded` and `traceRecorded` fields
- [ ] `trigger-test-bet.ps1` still sends `attachToUserChrome: $true` explicitly (no regression)

P2-a and P2-b can ship in the same PR or a follow-up — they are not blockers.

---

## Effect on agent prompts

Once PR #55 ships with these fixes, update `bba-paste-ready.md`:

Replace the placeholder comment:
```
<!-- CDP attach (execution.attachToUserChrome) is in review (PR #55) — not yet available on master. -->
```

With:
```
For CDP attach (when the operator's Chrome is already open in debug mode via `scripts/start-chrome-debug.ps1`), set `execution.attachToUserChrome: true`. The server defaults to isolated Playwright if this field is absent or false. CDP sessions produce a trace.zip but no video.
```
