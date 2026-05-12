# CTO runtime config cleanup

Date: 2026-05-13

## Summary

The CTO agent no longer has the stale `env.OpenAI` binding that previously produced `Secret is not bound at env.OpenAI`. Live config shows `adapterType=codex_local`, command `C:\Users\thepr\AppData\Roaming\npm\codex.cmd`, and secret bindings only for sports/search data APIs.

I tightened session compaction live through `PATCH /api/agents/d9bd4d75-fb9f-4221-85fb-ff59b74b5f44`:

- `runtimeConfig.heartbeat.sessionCompaction.maxSessionRuns`: `15` -> `8`
- `runtimeConfig.heartbeat.sessionCompaction.maxRawInputTokens`: `800000` -> `500000`
- `runtimeConfig.heartbeat.sessionCompaction.maxSessionAgeHours`: `24` -> `12`

This keeps CTO on shorter Codex sessions and reduces context-overflow / stale-session behavior without changing the CTO identity prompt.

## Findings by issue

### 1. Stale `env.OpenAI`

Status: addressed before this branch, verified live.

Evidence:

- `GET /api/agents/d9bd4d75-fb9f-4221-85fb-ff59b74b5f44` returned no `OpenAI`, `OPENAI_API_KEY`, `Anthropic`, or `ANTHROPIC_API_KEY` binding in `adapterConfig.env`.
- Existing bindings are `API_Sports`, `BraveSearch`, `THE_ODDS_API_KEY`, `SPORTS_DATA_API_KEY`, and `SPORTS_GAME_ODDS_API_KEY`.

No code change was needed for this item.

### 2. Context compaction overflows

Status: addressed by live runtime config.

The previous compaction threshold allowed long CTO sessions: 15 session runs, 800k raw input tokens, and 24h age. The live config now rotates at 8 runs, 500k raw input tokens, or 12h age.

Follow-up if this is still noisy: lower `maxSessionRuns` to 5 and set `maxRawInputTokens` to 350k.

### 3. Process handle loss

Status: investigated; existing adapter-utils cleanup is present.

Evidence:

- `packages/adapter-utils/src/server-utils.ts` pauses streams during log append, records `runningProcesses`, deletes the handle on child `error` and `close`, and signals `SIGTERM` then `SIGKILL` on timeout.
- `packages/adapters/codex-local/src/server/execute.ts` always stops the Paperclip bridge and restores remote workspaces in `finally`.

The "lost process handle" reports are most likely a server restart / in-memory registry loss symptom rather than an unclosed Codex child in the adapter. I did not add duplicate process-kill logic because the current lower-level utility already owns it.

### 4. Codex plugin-sync warnings

Status: addressed in code.

Change:

- `packages/adapters/codex-local/src/server/execute.ts` now filters known non-fatal Codex startup noise before writing stderr to run logs or deriving the user-facing error message.

Filtered categories:

- `codex_core::plugins::manager` featured-plugin cache failures
- `codex_core::plugins::startup_sync` remote plugin sync failures
- PowerShell shell-snapshot warnings
- external plugin manifest `interface.defaultPrompt` compatibility warnings

These warnings can contain large HTTP error bodies and previously became the first stderr line shown as the run failure, even when the local CLI auth and actual execution path were fine.

## Verification

- Live CTO runtime config was patched successfully and read back from the API.
- Manual CTO heartbeat run `bf67263d-b67f-4c6e-a5ee-7d451a96b137` succeeded with exit code `0`.
- The post-fix heartbeat had no `stderrExcerpt`, no `errorCode`, and reported `billingType=subscription_included`, confirming Codex local CLI auth was used instead of a missing API secret.
- Code paths changed:
  - `packages/adapters/codex-local/src/server/execute.ts:54`
  - `packages/adapters/codex-local/src/server/execute.ts:61`
  - `packages/adapters/codex-local/src/server/execute.ts:724`
  - `packages/adapters/codex-local/src/server/execute.ts:729`

I did not change CTO capabilities or identity text.
