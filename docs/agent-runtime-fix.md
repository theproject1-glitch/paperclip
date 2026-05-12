# CEO/CTO/BBA Runtime Fix Report

Date: 2026-05-12

Company: Betting AI System (`b94fed82-38bf-4eb3-81d8-9b1a8aa84921`)

Agents:

- CEO: `039a8ee2-d7c0-46d0-adfb-8734430162c9`
- CTO: `d9bd4d75-fb9f-4221-85fb-ff59b74b5f44`
- BBA: `9a384d99-8770-4f6d-911a-4797c4973b99`

## Summary

The stale local-runtime failures for CEO, CTO, and BBA were caused by live agent configuration drift, not by missing LLM API keys.

Paperclip's local adapters support subscription/session authentication:

- `claude_local` uses Claude Code local login when `ANTHROPIC_API_KEY` is absent.
- `codex_local` uses local Codex auth when `OPENAI_API_KEY` is absent.

The failures came from two live config problems:

- CEO defaulted to the broken `claude.cmd` npm shim, which pointed at a deleted Claude Code version.
- CTO and BBA had stale `env.OpenAI` secret references. Those were not needed for local CLI auth and failed before either adapter process launched.

The live agent configs were repaired via the Paperclip API. CEO and CTO completed on-demand heartbeat runs. BBA also cleared the stale `env.OpenAI` config blocker and launched Claude Code, but the real-bet path exposed a separate Playwright/Casa execution issue.

## Source Evidence

Relevant runtime code paths:

- Secret resolution failure originates in `server/src/services/secrets.ts` at `resolveSecretRef`, which throws `Secret is not bound to ... at env.X`.
- Agent runtime config is resolved before adapter execution through `resolveAdapterConfigForRuntime` in `server/src/services/heartbeat.ts`.
- Agent PATCH saves adapter config and syncs env bindings through `syncEnvBindingsForTarget` in `server/src/routes/agents.ts`.
- Claude local adapter chooses subscription auth when `ANTHROPIC_API_KEY` is absent in `packages/adapters/claude-local/src/server/execute.ts`.
- Codex local adapter chooses subscription/local auth when `OPENAI_API_KEY` is absent in `packages/adapters/codex-local/src/server/execute.ts`.

Local CLI probes:

- `C:\Users\thepr\AppData\Roaming\Claude\claude-code\2.1.128\claude.exe --version` returned `2.1.128 (Claude Code)`.
- `C:\Users\thepr\AppData\Roaming\npm\codex.cmd --version` returned `codex-cli 0.121.0`.
- `C:\Users\thepr\AppData\Roaming\npm\claude.cmd --version` failed with `The system cannot find the path specified.`

The broken Claude shim contained:

```bat
@echo off
"C:\Users\thepr\AppData\Roaming\Claude\claude-code\2.1.121\claude.exe" %*
```

The installed Claude binary was actually:

```text
C:\Users\thepr\AppData\Roaming\Claude\claude-code\2.1.128\claude.exe
```

## Live Fixes Applied

All changes below were applied to the live Paperclip instance through the API.

### CEO

Root causes:

- Recent failure: `Secret is not bound to agent:CEO at env.BraveSearch`.
- Older failure: `Claude exited with code 1: The system cannot find the path specified.`
- The path failure happened because the agent had no explicit command override and the default `claude` command resolved to the broken npm shim.
- The BraveSearch failure happened because the config still referenced `env.BraveSearch`, but the company secret binding row was not synced for CEO.

Fixes:

- Set `adapterConfig.command` to the working Claude Code binary:
  `C:\Users\thepr\AppData\Roaming\Claude\claude-code\2.1.128\claude.exe`
- Kept `env.BraveSearch`.
- Re-saved the agent config via `PATCH /api/agents/:id`, which re-synced the CEO BraveSearch binding row.

Verification:

- On-demand heartbeat run `09091633-5143-432f-a7e8-c9d205fc4ed3` completed with status `succeeded`.
- The run produced a normal Claude Code transcript and completed issue-management work instead of failing before adapter launch.

### CTO

Root cause:

- Failure: `Secret is not bound to agent:CTO at env.OpenAI`.
- The CTO uses `codex_local`, and local Codex CLI authentication is available through the host login state.
- `env.OpenAI` was a stale API-key binding, not required for local CLI operation.
- The remaining external API secret refs also needed binding rows synced for CTO.

Fixes:

- Set `adapterConfig.command` to:
  `C:\Users\thepr\AppData\Roaming\npm\codex.cmd`
- Removed stale `adapterConfig.env.OpenAI`.
- Kept sports/search API env refs.
- Re-saved the agent config via `PATCH /api/agents/:id`, which re-synced the remaining CTO secret binding rows.

Verification:

- On-demand heartbeat run `adeacb38-099c-49a4-b7ba-1035617c51fe` completed with status `succeeded`.
- The run produced a normal Codex transcript and closed its diagnostic issue.

### BBA

Root cause:

- Failure: `Secret is not bound to agent:BBA at env.OpenAI`.
- BBA uses `claude_local`, so `env.OpenAI` was wrong for this agent and not needed for local CLI operation.
- The remaining external API secret refs needed binding rows synced for BBA.

Fixes:

- Set `adapterConfig.command` to the working Claude Code binary:
  `C:\Users\thepr\AppData\Roaming\Claude\claude-code\2.1.128\claude.exe`
- Removed stale `adapterConfig.env.OpenAI`.
- Kept sports/search API env refs.
- Re-saved the agent config via `PATCH /api/agents/:id`, which re-synced the remaining BBA secret binding rows.
- Resumed BBA from watchdog pause.

Verification:

- The stale `env.OpenAI` failure disappeared.
- On-demand heartbeat run `53515f53-6057-4afb-a706-170aee840d11` launched Claude Code and ran a long BBA execution attempt, then failed with `error_max_turns` rather than the stale config error.
- Post-fix BBA automation runs `68a3aad4-395f-40a2-b0f0-1eb2af1bad12` and `6e0772b8-e885-48f2-8a13-99b12800101d` completed with status `succeeded`.

The BBA local-runtime blocker is fixed, but the real-bet browser path still needs a separate follow-up. The BBA transcript found:

- Playwright Chromium crashes with the non-empty profile.
- The profile appears to have been written by Chrome 147 while bundled Chromium is 145.
- No-profile browser launches, but the Casa login modal flow is not stable.
- The automation likely dismisses the Casa login modal by pressing Escape during overlay cleanup after clicking `CONECTARE`.

## Late Runtime Note

After the verification runs, `localhost:3100` stopped accepting connections. The last server log entries showed active Paperclip API traffic and a BBA `/betting-browser-automation/execute` request before the connection refusal was observed.

This late server loss was not the original CEO/CTO/BBA config failure. It should be treated as a separate runtime stability finding, likely related to the active BBA real-bet/browser attempts and the local server/watchdog process state.

## Telegram Cleanup

Telegram cleanup was not performed in this pass.

Reason: after the agent runtime fixes, BBA exposed a separate real-bet Playwright/Casa blocker and multiple BBA runs were active. I kept the repository changes limited to the runtime report rather than removing Telegram code in the same pass.

Telegram references still present:

- `server/src/services/telegram-bot.ts`
- `server/src/services/telegram-gateway.ts`
- `server/src/services/watchdog.ts`
- `server/src/services/betting-stop-loss.ts`
- `server/src/routes/betting-browser-automation.ts`

Recommended follow-up: remove Telegram in a dedicated PR with a server build and targeted route/service tests.

## Recommended Next Fixes

1. Reduce BBA concurrency before the next real-money test.
   BBA currently allowed multiple automation runs to overlap during verification. For real bet placement, set BBA `runtimeConfig.maxConcurrentRuns` to `1` or pause timer-driven BBA heartbeats while a real bet issue is active.

2. Fix the BBA Playwright/Casa browser path.
   Prefer one of:
   - Use an installed Chrome channel that matches the active profile.
   - Create a fresh BBA profile and complete manual Casa login once.
   - Clone/sanitize the Chrome profile before Playwright launches it.

3. Fix Casa login modal handling.
   Audit `dismissCasaOverlays` around the `CONECTARE` click so it does not close the login modal that it just opened.

4. Restart Paperclip cleanly from the intended master worktree.
   The server was previously running from `C:\Users\thepr\GitHub\paperclip`, while this fix was executed from `C:\Users\thepr\GitHub\paperclip-codex`.

5. Remove Telegram in a separate cleanup PR.

## Verification Matrix

| Agent | Config blocker cleared | Heartbeat result after fix | Remaining issue |
| --- | --- | --- | --- |
| CEO | Yes | `succeeded` (`09091633-5143-432f-a7e8-c9d205fc4ed3`) | None observed in verification |
| CTO | Yes | `succeeded` (`adeacb38-099c-49a4-b7ba-1035617c51fe`) | None observed in verification |
| BBA | Yes | Post-fix automation runs `succeeded`; on-demand run reached Claude Code and failed `error_max_turns` | Separate Playwright/Casa real-bet browser issue |

