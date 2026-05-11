# System Audit 2026-05-11

Comprehensive read-only audit of the local Paperclip application, focused on the
CEO/CTO/BBA agents, BBA Memory, betting execution, Playwright state, local
runtime, databases, git history, and current errors.

No services were restarted. No database writes were performed. No code was
changed as part of the investigation.

## 1. Executive Summary

Paperclip master contains the BBA Memory subsystem, the betting browser
automation execute route, Phase F idempotency, request-id/logging hardening,
health endpoints, Docker/CI/deployment scaffolding, and the UI components needed
for the demo path.

The live desktop process on port 3100 is not running from the current master
worktree. It is running from `C:\Users\thepr\GitHub\paperclip`, on branch
`docs/review-pr-fork-25-phase-f-consolidated` at `cc794b7d`, while the current
master audited in `paperclip-codex` is `90f7234b`. That makes live endpoint
behavior stale: for example `/api/health` works, but root `/health` and BBA
`/metrics` do not behave like current master.

The CEO/CTO/BBA flow is not currently demo-operational. The agents exist and the
generic Paperclip issue/heartbeat system can route work to them, but CTO and BBA
runs are failing on missing secret bindings, CEO is paused by watchdog failure,
and BBA Playwright keepalive is failing to restore the Casa session.

The BBA agent has clear instructions to call
`/api/companies/:companyId/betting-browser-automation/execute` directly, and the
server route can place bets through Playwright. However, the higher-level
"CEO/CTO scan predictions -> filter -> create BBA task -> BBA executes bet"
path is not wired as a deterministic product flow. It currently depends on
generic issues, agent instructions, and possibly Telegram commands.

The BBA Memory SQLite database exists and has schema version 3, but recent rows
are keepalive failures without company metadata. Normal company-scoped API calls
therefore report zero recent runs while `?all=true` shows the failures.

The highest-risk blockers are operational rather than missing source files:
stale live runtime, missing agent secrets, broken Casa session restore, unmounted
betting ops dashboard, and unwired Telegram bot startup.

## 2. Module Map

Repository layout observed:

| Area | Purpose | Audit notes |
| --- | --- | --- |
| `server/` | Express API, agent orchestration, adapters, BBA routes/services | 133 files under `server/src/services`, 43 under `server/src/routes` |
| `ui/` | React/Vite board UI | 209 component files under `ui/src/components` |
| `packages/db/` | Drizzle schema, migrations, database client | Main app schema includes companies, agents, issues, heartbeat runs, betting tables |
| `packages/shared/` | Shared constants, schemas, validators, API helpers | Used across server and UI |
| `packages/adapters/` | Agent adapter packages | Includes local agent adapter implementations |
| `packages/adapter-utils/` | Shared adapter utilities | Adapter runtime helper layer |
| `packages/plugins/` | Plugin system packages | External adapter/plugin support |
| `scripts/` | Deployment and operational scripts | Includes deployment smoke script on master |
| `docs/` and `doc/` | Operational docs, product docs, phase docs | Mixed product docs and shipped BBA runbooks |

Files considered during audit:

- Source/docs/log candidates searched: 1,985.
- Text/code files considered after excluding generated folders: 1,784.
- Local log/text files found under Paperclip data paths: 1,264.
- Largest live server log inspected: about 5.87 million lines.

## 3. Agent System

### Live Agents

Live data from `GET /api/companies/b94fed82-38bf-4eb3-81d8-9b1a8aa84921/agents`
showed three relevant agents:

| Agent | ID | Role | Adapter | Status | Key observation |
| --- | --- | --- | --- | --- | --- |
| CEO | `039a8ee2-d7c0-46d0-adfb-8734430162c9` | `ceo` | `claude_local` | `paused` | Watchdog paused after 3 consecutive failures |
| CTO | `d9bd4d75-fb9f-4221-85fb-ff59b74b5f44` | `cto` | `codex_local` | `error` | Latest runs fail on missing `env.OpenAI` secret binding |
| BBA | `9a384d99-8770-4f6d-911a-4797c4973b99` | `general` | `claude_local` | `paused` | Watchdog paused after 3 consecutive failures |

Agent role and heartbeat behavior is implemented in the generic Paperclip
control plane:

- CEO role behavior is referenced in `server/src/routes/agents.ts`, including
  CEO task assignment source handling around `taskAssignSource: "ceo_role"`.
- Agent wakeups are routed through the heartbeat system. `server/src/routes/agents.ts`
  calls the heartbeat wakeup path for agent wakeups.
- Task checkout and execution locks are handled in `server/src/services/issues.ts`.
- The heartbeat orchestrator lives in `server/src/services/heartbeat.ts`; it owns
  agent run creation, work discovery, liveness, and wakeup queueing.

### Task Flow

The current product task model is:

1. Work is stored as company-scoped issues.
2. Issues can be assigned to an agent.
3. The heartbeat service wakes an agent.
4. The adapter process receives prompt/context.
5. The agent decides what tool/API call to perform.
6. For BBA, the instruction file tells the agent to call the BBA execute route.

This means BBA execution is instruction-driven, not yet an explicit first-class
workflow step like "issue of type bet -> server calls BBA execute". That is
acceptable for an agent-control-plane prototype, but it is fragile for a betting
demo.

### BBA Agent Instructions

The BBA agent instructions under the local Paperclip instance say the agent's
only job is to place bets on `casapariurilor.ro` by calling the
`betting-browser-automation/execute` API directly through PowerShell
`Invoke-RestMethod`. They explicitly say not to use browser tooling directly.

The CTO instructions include similar guidance and specify:

- Browser: Chromium.
- User data dir: `C:\Users\thepr\.paperclip\bba-playwright-profile`.
- `skipLogin: true`.

This is evidence that the intended path is "agent receives task -> agent calls
server API -> server Playwright service places bet".

## 4. CEO/CTO Error Analysis

### Critical: missing secret bindings

Recent heartbeat failed events show hard adapter startup failures:

- CTO latest failures: `Secret is not bound to agent:d9bd4d75-fb9f-4221-85fb-ff59b74b5f44 at env.OpenAI`.
- BBA latest failures: `Secret is not bound to agent:9a384d99-8770-4f6d-911a-4797c4973b99 at env.OpenAI`.
- CEO earlier failures: `Secret is not bound to agent:039a8ee2-d7c0-46d0-adfb-8734430162c9 at env.BraveSearch`.

Severity: Critical. These agents cannot reliably start until the referenced
secrets are bound to the agent records or the adapter env configuration is
changed.

### Critical: CEO command/path failure

The latest CEO manual run had adapter invocation logs and then failed quickly.
Relevant stderr:

```text
The system cannot find the path specified.
```

The invocation path included:

```text
C:\Users\thepr\AppData\Roaming\npm\claude.CMD
```

and a generated prompt-cache file path. The env value for `BraveSearch` was
redacted in the event payload, so the later CEO failure is not merely "secret not
bound"; it may also be a local Claude CLI/path/prompt-file issue.

Severity: Critical. This blocks CEO execution even after secret binding is fixed
unless the command path and prompt file path are valid.

### High: watchdog paused CEO and BBA

Both CEO and BBA are paused with:

```text
watchdog: 3 consecutive failures
```

The server log also shows repeated watchdog recovery failures after 3 minutes.

Severity: High. Even if the underlying secret/path issue is fixed, the agents may
remain paused until explicitly resumed or until watchdog recovery succeeds.

### Medium: wakeup retry conflict

The live server log showed a CEO wakeup retry returning HTTP 409 with reason
`retry_failed_run`.

Severity: Medium. This appears secondary to the failed/paused run state, but it
will make manual retry attempts confusing until the underlying adapter failure is
fixed.

## 5. BBA Integration With `/execute`

### Server route status on master

Current master includes the execute path:

- `server/src/app.ts` mounts BBA Memory and Betting Browser Automation routes.
- `server/src/routes/betting-browser-automation.ts` implements POST execute,
  request-id logging, rate limiting, idempotency claim/replay, and calls
  `bettingBrowserAutomationService.execute`.
- `server/src/services/betting-browser-automation.ts` contains the Playwright
  execution engine and inserts placed-bet records.
- `server/src/services/bba-memory/repository.ts` contains
  `claimIdempotencyKey`, `getIdempotencyKey`, `putIdempotencyKey`, and
  `safeParseMetaJson`.

The UI client path also exists:

- `ui/src/api/bbaMemory.ts` sends `Idempotency-Key` and reads
  `X-Idempotent-Replay`.
- `ui/src/components/bba-memory/BbaMemoryExecuteBetPanel.tsx` uses
  sessionStorage-based last-submit protection and displays replay state.

### Product orchestration status

The concrete user-described flow:

```text
CEO/CTO scan predictions -> filter -> create BBA task -> BBA executes bet
```

is not fully wired as a deterministic server-side pipeline.

Evidence:

- The BBA agent can execute a task if assigned an issue whose prompt tells it to
  call `/execute`.
- `server/src/services/telegram-bot.ts` has a `/bet` command that can create a
  BBA issue and wake the BBA agent.
- Searches found `createTelegramBot` defined, but no startup call in
  `server/src/index.ts` or `server/src/app.ts`. The global Telegram bot object is
  referenced by other services, but not obviously initialized by the main app.
- A betting ops dashboard route exists in `server/src/routes/betting-ops-dashboard.ts`,
  but it is not mounted in the app, and the live route returned 404.

### Live execution status

Local BBA artifacts show the BBA agent attempted to call the execute API. The
observed API result failed before real bet placement:

```text
Login form did not become visible after opening the login entrypoint.
```

Recent BBA Memory rows are keepalive failures, not successful bet placements.

### Verdict

Integration verdict for BBA -> CEO/CTO: Red.

The low-level `/execute` API exists on current master, and the BBA agent has
instructions to call it, but the live CEO/CTO/BBA system is not currently
operational. Agent adapter failures, paused watchdog state, stale runtime, and
Casa session failure block the end-to-end path.

## 6. Playwright State

Observed Playwright state:

- Playwright version: `1.58.2`.
- Persistent profile directory exists:
  `C:\Users\thepr\.paperclip\bba-playwright-profile`.
- Profile size: about 241 MB, 1,255 files.
- Profile `Default\Network\Cookies` was recently modified.
- BBA artifact directory exists under
  `C:\Users\thepr\.paperclip\instances\default\data\betting-browser-automation`.
- Artifact size: about 1.2 GB, 2,094 files.

Recent BBA session logs show the persistent profile path is being cloned/enabled,
so the CDP/persistent-profile strategy appears to be running.

However, Casa auth/session restore is failing:

- BBA Memory failures say `session not restored after autofill attempt`.
- Keepalive rows say `auto-relogin failed - manual login may be required`.
- Browser debug log included Casa-side JavaScript and iframe issues, including:

```text
Cannot read properties of null (reading 'appendChild')
Refused to display 'https://login.casapariurilor.ro/' in a frame because it set 'X-Frame-Options' to 'sameorigin'.
```

Conclusion: Playwright is installed and profile state exists, but the profile is
not currently sufficient to place a bet without re-authentication. This is a
blocking operational issue for the BBA demo.

## 7. Database State

### App database

The local server reports `/api/health` as OK and returns two companies:

- `951ddacf-ad83-469d-a4dc-99db08963564` - RegimeTrader AI Systems.
- `b94fed82-38bf-4eb3-81d8-9b1a8aa84921` - Betting AI System.

The Betting AI System company has 214 issues:

- `done`: 180.
- `cancelled`: 22.
- `blocked`: 11.
- `in_progress`: 1.

Important open/blocked issues:

- `BET-217`: live single bet end-to-end validation, blocked, assigned to BBA.
- `BET-216`: combo bet validation, blocked, assigned to BBA.
- `BET-163`: original Romanian BBA autonomy goal, blocked, assigned to CEO.
- `BET-223`: unblock critical bets, blocked, assigned to CTO.

There is one stale-looking `in_progress` issue:

- `BET-126`: "CEO: Monthly Strategic Requirements..."
- No assignee, checkout run, or execution run was observed.

### BBA Memory SQLite

BBA Memory database:

```text
C:\Users\thepr\.paperclip\bba-memory\bba-memory.db
```

Observed state:

- Exists: yes.
- Size: 266,240 bytes.
- Last modified: 2026-05-11 12:42:17.
- Schema version rows: 3.
- Tables: `runs`, `training_sessions`, `selectors_observed`,
  `popups_seen`, `failures`, `idempotency_keys`, `schema_version`.

Row counts:

| Table | Rows |
| --- | ---: |
| `runs` | 4 |
| `training_sessions` | 12 |
| `selectors_observed` | 37 |
| `popups_seen` | 0 |
| `failures` | 4 |
| `idempotency_keys` | 0 |

Recent rows:

- Run IDs 504-507.
- `source=keepalive`.
- `trigger=auto-30min`.
- `outcome=failure`.
- `failure_class=UNKNOWN`.
- Notes indicate auto-relogin/manual login required.

Important drift:

- The BBA Memory `runs` table does not have a physical `company_id` column.
- Current code filters company-scoped recent runs via `meta_json.companyId`.
- Keepalive rows do not appear to include that company metadata.
- Result: company-scoped `/recent-runs` returned zero rows, while `?all=true`
  returned the keepalive failures.

This is not necessarily schema corruption, but it is a product observability gap.

## 8. Server Runtime State

Port 3100 is reachable.

Observed process:

| Field | Value |
| --- | --- |
| Process | `node` |
| PID | `48928` |
| Started | 2026-05-11 23:51:10 |
| Working set | about 375 MB |
| Worktree | `C:\Users\thepr\GitHub\paperclip` |
| Branch | `docs/review-pr-fork-25-phase-f-consolidated` |
| Commit | `cc794b7d` |

The audited source tree in `paperclip-codex` is current master at:

```text
90f7234b939fef0f41621103487e12d909ab039a
```

This mismatch matters. Live endpoint behavior does not fully match master:

- `/api/health` returns OK.
- `/health` returns the UI fallback HTML instead of current master's root health
  response.
- `/api/companies/.../bba-memory/metrics` returned 404 on the live server.

Conclusion: before judging the shipped production-readiness changes, the live
desktop app should be restarted from current master or the production tag.

## 9. Git/PR Snapshot

Audited master:

```text
90f7234b docs+scripts: production deployment runbook + smoke test (#42)
dfda9921 feat(cicd): test + build + release workflows (#39)
d162b247 feat(deploy): Dockerfile + docker-compose for production (#38)
925ba19e test(server): BBA integration tests - replacement for #41 (#43)
575ac706 feat(server): /health endpoint + structured logging on BBA routes (#40)
c672d3ef fix(server): typecheck errors in plugin-host-services.ts (#37)
d7fb7708 chore: sync lockfile and TS fixes after demo wave
```

Recent tags include:

- `v2026.05.11-demo`.
- `v2026.05.11-demo.1`.
- `v2026.05.11-demo.2`.

Open PRs at audit time:

| PR | Title |
| --- | --- |
| #8 | Phase F+ UI - auto-retry + replay banner |

No PRs were merged or modified during this audit.

## 10. Known Broken Things

### Critical

1. Live app is running from a stale worktree/branch, not current master.
   - Impact: endpoint behavior and health checks do not reflect the shipped code.

2. CEO/CTO/BBA agents are blocked by adapter startup failures.
   - CTO and BBA are missing `env.OpenAI` secret bindings.
   - CEO has had `env.BraveSearch` binding failures and a command/path failure.

3. BBA cannot currently complete Casa auth/session restore.
   - Keepalive rows are failures.
   - Latest direct BBA attempt failed before login/bet placement.

4. The prediction-to-BBA product path is not first-class wired.
   - The low-level execute route exists.
   - Agent instructions exist.
   - But betting ops dashboard is not mounted and Telegram bot startup is not
     clearly wired.

### High

1. BBA Memory company-scoped API hides keepalive failures because rows lack
   `meta_json.companyId`.

2. Critical betting issues remain blocked:
   - `BET-217`.
   - `BET-216`.
   - `BET-163`.
   - `BET-223`.

3. CEO latest run has a local command/path error after the prompt cache safety
   valve starts a fresh session.

4. A stale `in_progress` issue exists with no assignee/run linkage.

5. BBA `/metrics` was unavailable on the running server because the process is
   stale relative to master.

### Medium

1. Server log volume is very high. The main server log is hundreds of MB and
   millions of lines.

2. BBA browser artifacts are large, about 1.2 GB.

3. Watchdog recovery loops can hide the original agent error unless logs/events
   are inspected.

4. PR #8 remains open as a post-demo enhancement.

### Low

1. Documentation now mostly reflects the production/deployment path, but the
   local runtime was not restarted onto the latest master.

2. The current local demo state depends on manual cleanup of blocked issues and
   agent pause state after secrets/session are fixed.

## 11. Recommended Next Steps

### First: make the running app match current master

Estimated time: 10-20 minutes.

Restart the local Paperclip process from current master or from
`v2026.05.11-demo.2`, then re-check:

- `/api/health`.
- `/health`.
- `/health/deep`.
- BBA `/metrics`.
- BBA recent runs.

This removes the stale-runtime variable before debugging product logic.

### Second: fix agent secret bindings and resume agents

Estimated time: 20-40 minutes.

Bind or correct:

- CTO `env.OpenAI`.
- BBA `env.OpenAI`.
- CEO `env.BraveSearch`.

Then verify the Claude/Codex command paths. After that, resume CEO/BBA from
watchdog pause and trigger a minimal heartbeat run for each.

### Third: restore Casa session manually, then verify BBA keepalive

Estimated time: 30-60 minutes.

The Playwright profile exists, but session restore is failing. A practical order:

1. Open the persistent profile manually.
2. Log into Casa Pariurilor.
3. Run the BBA session check/keepalive path.
4. Confirm a successful BBA Memory run appears for the Betting AI System company.

### Fourth: wire or expose the prediction-to-execution path

Estimated time: 1-3 hours depending on desired UX.

Pick one path:

- Mount and expose Betting Ops Dashboard in the server/app UI.
- Wire Telegram bot startup if Telegram is the intended operator path.
- Add a deterministic server endpoint that turns an approved prediction into a
  BBA issue or direct `/execute` request.

### Fifth: clean up observability drift

Estimated time: 30-60 minutes.

Either store `companyId` directly on BBA Memory runs or ensure all system-created
BBA rows include `meta_json.companyId`, including keepalive. This will make
company-scoped recent runs and metrics match operator expectations.

### Sixth: unblock/triage stale issues

Estimated time: 30-60 minutes after agents are healthy.

Review and update:

- `BET-217`.
- `BET-216`.
- `BET-163`.
- `BET-223`.
- `BET-126`.

## 12. Open Questions for Costel

1. Should BBA ever place a real bet automatically from CEO/CTO output, or should
   there be an explicit human/board approval gate before `/execute`?

2. Which secrets are intended for each agent? Specifically, should Claude-backed
   agents have an `OpenAI` env binding, or is that a stale adapter configuration?

3. Is Telegram intended to be part of the live product flow now, or was it only a
   development convenience?

4. Should the Betting Ops Dashboard be mounted and exposed in the main UI for the
   demo?

5. Should BBA Memory be globally observable, company-scoped, or both? This
   determines whether keepalive/system rows need a first-class company column.

6. Which worktree should the desktop runner use going forward:
   `paperclip`, `paperclip-codex`, or a separate release checkout?

7. Should PR #8 remain post-demo, or should its auto-retry/replay banner work be
   merged before the next live betting attempt?

## Appendix: Commands And Endpoints Used

Representative read-only checks included:

```powershell
git status
git rev-parse HEAD
git log --oneline master -50
gh pr list --repo theproject1-glitch/paperclip --state open
Invoke-RestMethod http://localhost:3100/api/health
Invoke-RestMethod http://localhost:3100/api/companies
Invoke-RestMethod http://localhost:3100/api/companies/b94fed82-38bf-4eb3-81d8-9b1a8aa84921/agents
Invoke-RestMethod http://localhost:3100/api/companies/b94fed82-38bf-4eb3-81d8-9b1a8aa84921/bba-memory/recent-runs?limit=5
```

SQLite was inspected read-only through Node's `node:sqlite` module because the
`sqlite3` CLI was not available.

No secret values were printed or copied into this report.
