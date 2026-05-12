# CDP Attach Review

Date: 2026-05-12
Branch: `fix/bba-attach-to-user-chrome`

## Summary

The current `master` branch did not contain the previously referenced CDP helpers
`shouldUseCdpPersistentProfile()` and `connectChromiumProfileOverCdp()`.
Those functions exist only on stale Phase F branches such as
`origin/feat/bba-memory-phase-f-backend-plus`.

The stale implementation was also not the right behavior for the current Casa
Pariurilor account flow: it launched a new Chrome/Chromium process with a cloned
profile over CDP. The required behavior is to attach to the user's already
running real Chrome process, where the personal Casa account session is already
logged in.

## Previous CDP Logic on Stale Branches

Found with:

```powershell
git grep -n "shouldUseCdpPersistentProfile\|connectChromiumProfileOverCdp\|connectOverCDP" `
  $(git for-each-ref --format='%(refname)' refs/remotes/origin refs/heads) -- `
  server/src/services/betting-browser-automation.ts
```

Stale branch behavior:

- `shouldUseCdpPersistentProfile()` activated only when:
  - `execution.skipLogin === true`
  - resolved browser was Chromium
  - a `userDataDir` existed
  - bookmaker name included `casa pariurilor`
- `connectChromiumProfileOverCdp()` launched a new browser process with:
  - `--user-data-dir=<cloned profile>`
  - random `--remote-debugging-port`
  - stealth Chromium args
- It then called `playwright.chromium.connectOverCDP(...)` against that new process.

That path still used a different browser session than the user's current Chrome
window. It also depended on copying profile state, which is exactly the failure
mode Casa has been punishing with repeat login and cookie prompts.

## Current Master Before This Fix

Before this branch:

- No `shouldUseCdpPersistentProfile()` on master.
- No `connectChromiumProfileOverCdp()` on master.
- The execute path chose either:
  - `launchPersistentContext(clonedUserDataDir, ...)`, or
  - `browserType.launch(...)` plus a new context.
- `normalizeExecutionForPreAuth()` forced `skipLogin` into
  `DEFAULT_BBA_CHROMIUM_PROFILE`, which pushed Casa back toward a non-user
  browser session.

Relevant files after this fix:

- `server/src/services/betting-browser-automation.ts:407`
  - `shouldUseCdpPersistentProfile()` is restored as a compatibility predicate
    over the new user-Chrome attach mode.
- `server/src/services/betting-browser-automation.ts:461`
  - `attachToUserChrome()` connects to `http://127.0.0.1:9222` and reuses the
    first Casa tab it finds.
- `server/src/services/betting-browser-automation.ts:2093`
  - Casa execution now prefers user-Chrome attach mode before any persistent
    profile or bundled Chromium launch.
- `server/src/routes/betting-browser-automation.ts:121`
  - `execution.attachToUserChrome` and `execution.chromeDebugPort` are accepted
    by the API.

## Activation Conditions After This Fix

CDP attach is used when either condition is true:

1. `execution.attachToUserChrome === true`
2. `bookmakerConfig.bookmaker` contains `Casa Pariurilor` and
   `execution.attachToUserChrome !== false`

The second condition makes the user's Casa account flow the default. Operators
can still opt out with:

```json
{
  "execution": {
    "attachToUserChrome": false
  }
}
```

Default CDP port is `9222`. Override with:

```json
{
  "execution": {
    "attachToUserChrome": true,
    "chromeDebugPort": 9223
  }
}
```

## Operator-Facing Failure

Before attaching, BBA checks:

```text
http://127.0.0.1:9222/json/version
```

If unavailable, `/execute` fails with a clear action:

```text
Chrome CDP endpoint is not available on localhost:9222. Please start Chrome
with remote debugging enabled by running scripts/start-chrome-debug.ps1 before
triggering BBA.
```

## Important Safety Behavior

When attached to user Chrome:

- BBA does not close the browser at the end of execution.
- BBA does not copy or delete the user's Chrome profile.
- BBA reuses an existing Casa tab if one is already open.
- If no Casa tab exists, BBA opens one in the existing user Chrome context.

## Current Local State

During this investigation, `http://localhost:9222/json/version` became available
and reported:

```text
Chrome/147.0.7727.138
```

No live preview bet was executed because the task explicitly requires operator
confirmation before BBA manipulates the live Casa session.
