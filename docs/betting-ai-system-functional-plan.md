# Betting AI System Functional Plan

Prepared: 2026-05-12
Prior audit: `docs/system-audit-2026-05-11.md` (PR #44)
Baseline inspected: `master` at `90f7234b939fef0f41621103487e12d909ab039a`
Branch: `docs/betting-ai-functional-plan`
Scope: read-only investigation plus implementation roadmap. No code, schema, secret, runtime, or database changes were made while preparing this file.

## 1. Executive summary

1. Betting AI System has the core primitives now: agents, issues, approvals, secrets, Playwright BBA execution, BBA Memory, and betting tables.
2. It is not yet a complete product loop because predictions do not deterministically become approved BBA execution tasks.
3. The current live desktop process on port 3100 is running from `C:\Users\thepr\GitHub\paperclip`, but that worktree is stale: `docs/review-pr-fork-25-phase-f-consolidated` at `cc794b7d`.
4. Current `master` is `90f7234b` in `C:\Users\thepr\GitHub\paperclip-codex`; align runtime before judging any new work.
5. CEO, CTO, and BBA agents exist, but their adapter/env bindings do not match the desired secret model.
6. `claude_code` is not a literal adapter type. The current Claude Code adapter is `claude_local`, labeled `Claude Code (local)` in UI.
7. CTO is already `codex_local`, but the live env key is `OpenAI`; Codex expects canonical `OPENAI_API_KEY`.
8. CEO is `claude_local` but only showed a search env binding; it needs `ANTHROPIC_API_KEY` before reliable Claude runs.
9. BBA is `claude_local` and needs the same `ANTHROPIC_API_KEY` binding.
10. Telegram should be deleted; it is no longer the operator surface and still has stale global bot callers.
11. Betting Ops Dashboard should be kept and mounted because it already aggregates predictions, placed bets, bankroll, matches, agents, and reports.
12. BBA Memory currently scopes company runs by `meta_json.companyId`; keepalive rows have no company id and disappear from company views.
13. Observability needs first-class `company_id` and system/company run scope, not JSON metadata filtering.
14. The high-value build is a narrow, auditable flow: prediction -> CEO/CTO approval -> BBA issue -> BBA `/execute`.
15. Recommended order: align runtime, bind secrets, delete Telegram, mount dashboard, fix BBA Memory scope, implement approval-to-BBA workflow.

## 2. Decision matrix from user

| Decision | Ground truth | Plan implication |
|---|---|---|
| Auto-place with CEO/CTO approval gate | Agent-level approval before BBA execution, not a human gate before `/execute` | Build approval-backed BBA issue creation. |
| CEO adapter | `claude_code` | Use existing `claude_local` unless a real alias is added. |
| BBA adapter | `claude_code` | Same: `claude_local` is the current Claude Code adapter. |
| CTO adapter | `codex_local` | Keep it; fix env key to `OPENAI_API_KEY`. |
| Secrets | CEO+BBA Anthropic, CTO OpenAI | Bind `env.ANTHROPIC_API_KEY` and `env.OPENAI_API_KEY`. |
| Telegram | Delete | Remove services and stale callers. |
| Betting Ops Dashboard | Decide by behavior | KEEP & MOUNT. |
| BBA Memory observability | Company execute runs plus separate system runs | Add first-class scope/company fields. |
| Control surface | Everything from Paperclip UI | Dashboard + approvals + BBA controls must live in Paperclip. |
| PR #8 | Closed/post-demo | Do not include auto-retry. |

## 3. Desktop runtime alignment

Current runtime evidence:

- `git worktree list` shows main worktree `C:/Users/thepr/GitHub/paperclip` at `cc794b7d` on `docs/review-pr-fork-25-phase-f-consolidated`.
- Codex worktree is current enough for planning: `C:/Users/thepr/GitHub/paperclip-codex` at `90f7234b`.
- Port 3100 process is `node` PID `48928`, command line points to `C:\Users\thepr\GitHub\paperclip\...\tsx ... src/index.ts`.
- `GET http://localhost:3100/api/health` returns ok, but from the stale process.
- `GET http://localhost:3100/health` returns the UI HTML shell in dev mode; use `/api/health` for API health.

Source anchors:

- `scripts/dev-runner.ts:24-27` bootstraps worktree env and warns if linked worktree env setup is missing.
- `scripts/dev-runner.ts:182` resolves the server port from `PORT` or default `3100`.
- `server/src/config.ts:32-43` loads the Paperclip instance `.env` and repo `.env`.
- `server/src/paths.ts:24-33` resolves `.paperclip/config.json` and sibling `.env` from the active worktree.
- `server/src/index.ts:95-104` loads config and secrets-provider defaults.
- `server/src/index.ts:646-658` sets runtime API env used by adapters.

Recommendation: run desktop from `C:\Users\thepr\GitHub\paperclip` on `master`; keep `paperclip-codex` for implementation branches.

```powershell
cd C:\Users\thepr\GitHub\paperclip
git fetch origin
git status
pnpm dev:stop
git checkout master
git pull --ff-only origin master
pnpm install
pnpm dev
```

Effort: about 10 minutes.

## 4. Telegram cleanup plan

Verdict: delete. Telegram was a dev/operator convenience, but the product direction is Paperclip UI only.

Files to delete:

- `server/src/services/telegram-bot.ts` - polling bot; `createTelegramBot` is at `server/src/services/telegram-bot.ts:459`; `/bet` creates and wakes a BBA issue at `server/src/services/telegram-bot.ts:735-775`.
- `server/src/services/telegram-gateway.ts` - command parsing, rate limiting, approval store, report formatting, env parsing; `createTelegramGateway` at `server/src/services/telegram-gateway.ts:371`; env parser at `server/src/services/telegram-gateway.ts:653`.

Files to modify:

- `server/src/routes/betting-browser-automation.ts:169` - remove `globalThis.__telegramBot` alert path.
- `server/src/services/betting-stop-loss.ts:116` - remove `maybeSendTelegramAlert`.
- `server/src/services/betting-stop-loss.ts:124` - remove global Telegram bot lookup.
- `server/src/services/betting-stop-loss.ts:150` - remove Telegram alert failure logging.
- `server/src/services/betting-stop-loss.ts:254` - remove `maybeSendTelegramAlert(...)` call.
- `server/src/services/watchdog.ts:32` - remove `notifiedTelegramRunIds`.
- `server/src/services/watchdog.ts:38-52` - remove `tgSend`/`tgSendToChat` helpers.
- `server/src/services/watchdog.ts:300-369` - remove `checkTelegramTriggeredRuns`.
- `server/src/services/watchdog.ts:528-536` - remove Telegram check invocation and startup comment.

Tests impacted:

- No dedicated Telegram test file was found.
- Regression target: watchdog, stop-loss, and BBA route tests.
- Final grep target after deletion: no `telegram`, `Telegram`, `__telegramBot`, or `PAPERCLIP_TELEGRAM` in server source except historical docs if intentionally kept.

Effort: 30-60 minutes, one PR.

## 5. Betting Ops Dashboard verdict

Verdict: KEEP & MOUNT.

Why it is worth keeping:

- `server/src/services/betting-ops-dashboard.ts:528` exports `bettingOpsDashboardService(db)`.
- `server/src/services/betting-ops-dashboard.ts:530` implements `summary(companyId)`.
- `server/src/services/betting-ops-dashboard.ts:532-540` loads agents.
- `server/src/services/betting-ops-dashboard.ts:545-553` loads bankroll snapshots.
- `server/src/services/betting-ops-dashboard.ts:561-582` loads `betting_predictions` joined to matches.
- `server/src/services/betting-ops-dashboard.ts:584-613` loads placed bets joined to predictions/matches.
- `server/src/services/betting-ops-dashboard.ts:645` loads report artifacts.
- `server/src/services/betting-ops-dashboard.ts:665-694` maps predictions to dashboard entries.
- `server/src/services/betting-ops-dashboard.ts:696-740` maps placed bets to entries.
- `server/src/services/betting-ops-dashboard.ts:914-925` builds agent metrics.
- `packages/shared/src/types/betting-ops-dashboard.ts:41` defines `BettingOpsDashboardEntry`.
- `packages/shared/src/types/betting-ops-dashboard.ts:138` defines `BettingOpsDashboardData`.

Current gap:

- `server/src/routes/betting-ops-dashboard.ts:7` exports routes.
- `server/src/routes/betting-ops-dashboard.ts:11-15` exposes `GET /companies/:companyId/betting-ops-dashboard`.
- `server/src/routes/betting-ops-dashboard.ts:26-33` exposes shortcut install support.
- `server/src/app.ts:44-45` imports BBA routes, but not Betting Ops Dashboard.
- `server/src/app.ts:301` mounts `bbaMemoryRoutes()`.
- `server/src/app.ts:305` mounts `bettingBrowserAutomationRoutes(db)`.
- No `bettingOpsDashboardRoutes(db)` mount appears in `server/src/app.ts`.
- No UI consumer was found; only a comment in `ui/src/components/bba-memory/BbaOperatorPlayground.tsx:225` hints at the operator surface.

Mount plan:

- Add `bettingOpsDashboardRoutes` import in `server/src/app.ts` near `server/src/app.ts:44-45`.
- Add `api.use(bettingOpsDashboardRoutes(db));` near `server/src/app.ts:301-305`.
- Add `ui/src/api/bettingOpsDashboard.ts` using shared `BettingOpsDashboardData`.
- Add a route in `ui/src/App.tsx` near `ui/src/App.tsx:75`, `ui/src/App.tsx:82-85`, and `ui/src/App.tsx:122-123`.
- Add `ui/src/pages/BettingOpsDashboard.tsx` to show predictions, placed bets, bankroll, agent health, BBA Memory widgets, and later approval actions.

Effort: 2-4 hours.

## 6. Secret bindings architecture + fix plan

How secrets work:

- `packages/db/src/schema/company_secrets.ts:6` defines `companySecrets`.
- `packages/db/src/schema/company_secret_versions.ts:5` defines encrypted secret versions.
- `packages/db/src/schema/company_secret_bindings.ts:5` defines bindings from a secret to a target/config path.
- `packages/db/src/schema/company_secret_bindings.ts:11-13` store `targetType`, `targetId`, and `configPath`.
- `packages/db/src/schema/secret_access_events.ts:8` defines access audit events.
- `server/src/services/secrets.ts:317-338` validates binding context.
- `server/src/services/secrets.ts:335` throws `Secret is not bound to ... at ...`.
- `server/src/services/secrets.ts:2113-2140` resolves env bindings with path `env.${key}`.
- `server/src/services/secrets.ts:2150-2184` resolves adapter config for runtime.
- `server/src/routes/agents.ts:1415` uses runtime config resolution in adapter tests.
- `server/src/routes/agents.ts:2192` reads `agent.adapterConfig.env` during create/update normalization.
- `ui/src/App.tsx:75` routes to Company settings -> Secrets.
- `ui/src/pages/Secrets.tsx:342` defines the Secrets page.
- `ui/src/components/AgentConfigForm.tsx:213` loads available secrets.
- `ui/src/components/AgentConfigForm.tsx:1126` renders the secret picker for env entries.
- `ui/src/components/SecretBindingPicker.tsx:60` defines the picker.
- `ui/src/components/SecretBindingPicker.tsx:238` uses `OPENAI_API_KEY` as placeholder guidance.

Live Betting AI System observation, sanitized:

- BBA `9a384d99-8770-4f6d-911a-4797c4973b99`: `adapterType=claude_local`, `status=paused`, model `claude-opus-4-6`, env includes non-canonical `OpenAI` plus sports/search keys.
- CTO `d9bd4d75-fb9f-4221-85fb-ff59b74b5f44`: `adapterType=codex_local`, `status=error`, model `gpt-5.4`, env includes non-canonical `OpenAI` plus sports/search keys.
- CEO `039a8ee2-d7c0-46d0-adfb-8734430162c9`: `adapterType=claude_local`, `status=paused`, observed env only includes search.
- Existing secrets include Casa, sports/search, and OpenAI-like entries. I intentionally do not reproduce raw key-shaped secret names.
- No Anthropic-named secret was observed in the sanitized live list.

Required bindings:

| Agent | Agent id | Adapter | Required env binding |
|---|---|---|---|
| CEO | `039a8ee2-d7c0-46d0-adfb-8734430162c9` | `claude_local` | `env.ANTHROPIC_API_KEY` |
| BBA | `9a384d99-8770-4f6d-911a-4797c4973b99` | `claude_local` | `env.ANTHROPIC_API_KEY` |
| CTO | `d9bd4d75-fb9f-4221-85fb-ff59b74b5f44` | `codex_local` | `env.OPENAI_API_KEY` |

Adapter expectations:

- `packages/adapters/claude-local/src/server/execute.ts:119` treats `ANTHROPIC_API_KEY` as Claude API-key auth.
- `packages/adapters/codex-local/src/server/execute.ts:85-86` treats `OPENAI_API_KEY` as Codex API-key auth.
- `packages/adapters/codex-local/src/server/execute.ts:338-339` reads `envConfig.OPENAI_API_KEY`.
- `packages/adapters/codex-local/src/server/codex-home.ts:78-87` writes `auth.json` containing `OPENAI_API_KEY` for Codex CLI compatibility.
- `packages/adapters/codex-local/src/server/test.ts:230-257` tests and warns specifically on `OPENAI_API_KEY`.

UI click path:

1. Open Paperclip from aligned `master` runtime.
2. Select Betting AI System.
3. Go to Company settings -> Secrets (`ui/src/App.tsx:75`, `ui/src/pages/Secrets.tsx:342`).
4. Create or confirm Anthropic and OpenAI secrets.
5. Go to Agents -> CEO/BBA/CTO (`ui/src/App.tsx:82-85`, `ui/src/pages/Agents.tsx:63`).
6. Edit adapter env in `AgentConfigForm` (`ui/src/components/AgentConfigForm.tsx:1126`).
7. Bind CEO+BBA `ANTHROPIC_API_KEY` and CTO `OPENAI_API_KEY`.
8. Remove/ignore old non-canonical `OpenAI` env key once canonical keys are verified.
9. Run adapter Test for each agent before resuming.

Alternative env file path:

- `server/src/config.ts:32-35` loads the Paperclip instance `.env` from `resolvePaperclipEnvPath()`.
- `server/src/paths.ts:24-33` resolves that file beside `.paperclip/config.json`.
- `server/src/config.ts:38-43` also loads repo-root `.env` if different.
- This is deployment-level fallback. The preferred product path is UI-managed secrets and bindings.

Effort: 20-45 minutes of user click-ops plus verification.

## 7. Adapter configuration alignment

Current adapters:

| Agent | Current adapter | Target product adapter | Action |
|---|---|---|---|
| CEO | `claude_local` | `claude_code` | Keep `claude_local`; it is Claude Code local. |
| CTO | `codex_local` | `codex_local` | Keep; fix env key. |
| BBA | `claude_local` | `claude_code` | Keep `claude_local`; it is Claude Code local. |

Does `claude_code` exist? No.

Evidence:

- `server/src/adapters/registry.ts:226` registers Claude as `type: "claude_local"`.
- `server/src/adapters/registry.ts:268` registers Codex as `type: "codex_local"`.
- `server/src/adapters/builtin-adapter-types.ts:6-7` lists `claude_local` and `codex_local`.
- `ui/src/adapters/claude-local/index.ts:7-8` registers `claude_local` with label `Claude Code (local)`.
- `ui/src/adapters/codex-local/index.ts:7-8` registers `codex_local` with label `Codex (local)`.
- `ui/src/adapters/adapter-display-registry.ts:65` displays `claude_local` as `Claude Code`.
- `ui/src/adapters/adapter-display-registry.ts:71` displays `codex_local` as `Codex`.

Recommendation: treat `claude_code` as product language, not a DB adapter type. Add a literal alias only if UI wording causes operator confusion.

If adding alias later:

- Add `claude_code` near `packages/shared/src/constants.ts:34-35`.
- Map it to Claude behavior near `server/src/adapters/registry.ts:226-244`.
- Add UI display/fields near `ui/src/adapters/claude-local/index.ts:7-8` and `ui/src/adapters/adapter-display-registry.ts:65`.
- Add compatibility tests so existing `claude_local` agents keep working.

Effort: 15-30 minutes without alias; 1-2 hours with alias.

## 8. Prediction -> Approval -> BBA flow design

Current data model:

- `packages/db/src/schema/betting_matches.ts:4` defines `bettingMatches`.
- `packages/db/src/schema/betting_predictions.ts:6` defines `bettingPredictions`.
- `packages/db/src/schema/betting_predictions.ts:13-18` stores prediction, confidence, expected value, target odds, reasoning, and status.
- `packages/db/src/schema/betting_placed_bets.ts:5` defines `bettingPlacedBets`.
- `packages/db/src/schema/betting_placed_bets.ts:10` links to `predictionId`.
- `packages/db/src/schema/betting_placed_bets.ts:15-17` stores idempotency key, status, and execution status.
- `packages/db/src/schema/betting_placed_bets.ts:27` enforces unique idempotency key.

Current issue/approval primitives:

- `packages/db/src/schema/issues.ts:32` stores issue status.
- `packages/db/src/schema/issues.ts:45` stores `originKind`.
- `packages/db/src/schema/issues.ts:85` indexes `(companyId, originKind, originId)`.
- `packages/db/src/schema/approvals.ts:5` defines `approvals`.
- `packages/db/src/schema/approvals.ts:13` defaults approvals to `pending`.
- `packages/db/src/schema/issue_approvals.ts:8` defines issue-approval links.
- `server/src/services/issues.ts:2798` implements issue creation.
- `server/src/services/issues.ts:2814-2823` enforces single-assignee validity.
- `server/src/services/issues.ts:2976` defaults `originKind` to `manual`.
- `server/src/services/issues.ts:3010` inserts an issue.
- `server/src/routes/issues.ts:2291` exposes `POST /companies/:companyId/issues`.
- `server/src/routes/issues.ts:3205-3240` schedules wakeups when assignee/status changes require execution.
- `server/src/routes/issues.ts:3385` calls `heartbeat.wakeup(...)` for wakeups.
- `server/src/routes/agents.ts:2938` exposes direct agent wakeup.
- `server/src/routes/approvals.ts:71-121` creates approvals and links source issues.
- `server/src/routes/approvals.ts:136-186` approves and wakes linked/requesting agents with reason `approval_approved`.
- `ui/src/api/approvals.ts:4-19` provides list/create/approve/reject/resubmit API methods.
- `ui/src/pages/Approvals.tsx:18` defines the approvals page.
- `ui/src/pages/Approvals.tsx:44-63` wires approve/reject mutations.
- `ui/src/components/ApprovalPayload.tsx:232-246` renders approval payloads.

Current BBA execution primitives:

- `server/src/routes/betting-browser-automation.ts:152` exports BBA execute routes.
- `server/src/routes/betting-browser-automation.ts:202-227` parses bookmaker/bet/execution inputs.
- `server/src/routes/betting-browser-automation.ts:232-246` handles Idempotency-Key claim/in-progress conflict.
- `server/src/routes/betting-browser-automation.ts:254` calls `svc.execute(...)`.
- `server/src/routes/betting-browser-automation.ts:313` writes the idempotency response.
- `server/src/services/betting-browser-automation.ts:342-350` enforces positive stake and max-stake risk controls.
- `server/src/services/betting-browser-automation.ts:1863-1882` prevents duplicate placed bets for the same idempotency key.
- `server/src/services/betting-browser-automation.ts:1927-1955` launches Playwright/browser context.
- `server/src/services/betting-browser-automation.ts:2172-2305` clicks selection, stake, review, and submit paths.
- `server/src/services/betting-browser-automation.ts:2400-2428` records placement status and result.

Current state answer:

There is no deterministic path today from prediction to CEO/CTO approval to BBA issue to `/execute`. The ingredients exist, but they are not connected. The old Telegram `/bet` command creates and wakes BBA issues at `server/src/services/telegram-bot.ts:735-775`, but Telegram is explicitly slated for deletion.

Target state:

1. Prediction row starts in `betting_predictions` with `status='pending'`.
2. Betting Ops Dashboard shows it in a review queue.
3. CEO and CTO review and request/resolve an approval.
4. Approval payload includes prediction id, match, market, selection, target odds, stake, risk context, and BBA execute payload draft.
5. Approval changes to `approved` only after the agent-level gate is satisfied.
6. Approved prediction creates one BBA issue with `originKind='betting_approved_prediction'` and `originId=<predictionId>`.
7. Issue is assigned to BBA agent `9a384d99-8770-4f6d-911a-4797c4973b99`.
8. BBA heartbeat picks up the issue and calls `/api/companies/:companyId/betting-browser-automation/execute`.
9. `/execute` records BBA Memory and placed bet state.
10. Dashboard links prediction, approval, BBA issue, placed bet, and BBA Memory run.

Concrete code changes:

- Add `server/src/services/betting-approval-workflow.ts` with:
  - `createPredictionApproval(companyId, predictionId, requesterAgentId)`
  - `createBbaIssueForApprovedPrediction(companyId, approvalId)`
  - `buildBbaExecutePayloadFromPrediction(...)`
- Add approval payload type, for example `approve_betting_prediction`.
- Extend `ui/src/components/ApprovalPayload.tsx:232-246` to render betting payloads.
- Add route actions to `server/src/routes/betting-ops-dashboard.ts:7`:
  - `POST /companies/:companyId/betting-ops-dashboard/predictions/:predictionId/approval`
  - `POST /companies/:companyId/betting-ops-dashboard/approvals/:approvalId/create-bba-issue`
- Prefer keeping betting side effects in the new service instead of bloating generic `server/src/routes/approvals.ts:136-186`.
- Use `server/src/services/issues.ts:2798` to create the BBA issue.
- Use `originKind`/`originId` uniqueness expectations from `packages/db/src/schema/issues.ts:85` to prevent duplicate BBA tasks.
- Wake BBA through issue-route wakeup behavior (`server/src/routes/issues.ts:3205-3240`) or direct `heartbeat.wakeup` (`server/src/routes/agents.ts:2938`).
- Add UI actions in the mounted Betting Ops Dashboard page.
- Add tests for duplicate approval, duplicate BBA issue creation, approval rejection, approval-to-wakeup, and failed `/execute` handling.

Effort: XL, 6-10 hours for a robust first version; 10-16 hours with polished UI and end-to-end tests.

## 9. BBA Memory observability fix

Current schema and filters:

- `server/src/services/bba-memory/schema.sql:37` defines `runs`.
- `server/src/services/bba-memory/schema.sql:63` stores `meta_json` as arbitrary extras.
- `server/src/services/bba-memory/schema.sql:67-70` indexes started time, outcome, training session, and source; there is no `company_id` or run-scope index.
- `server/src/services/bba-memory/repository.ts:192` defines `listRecentRunsForCompany(companyId, limit)`.
- `server/src/services/bba-memory/repository.ts:197-198` filters by `json_valid(meta_json)` and `json_extract(meta_json, '$.companyId') = ?`.
- `server/src/services/bba-memory/repository.ts:229-230` uses the same JSON company filter for stats.
- `server/src/services/bba-memory/repository.ts:244-245` uses the same JSON company filter for failure class counts.
- `server/src/routes/bba-memory.ts:17` exposes company recent-runs.
- `server/src/routes/bba-memory.ts:26-33` allows `?all=true` as an instance-admin escape hatch.
- `server/src/routes/bba-memory.ts:85-115` exposes company-scoped Prometheus metrics.
- `server/src/services/bba-session-keepalive.ts:241-253` starts keepalive, but keepalive has no company parameter.

Live SQLite observation:

- DB exists at `C:\Users\thepr\.paperclip\bba-memory\bba-memory.db`.
- Recent rows were all `source=keepalive`, `trigger=auto-30min`, `outcome=failure`, `companyId=null`.
- Counts observed: `runs=4`, `failures=4`, `selectors_observed=37`, `idempotency_keys=0`, `popups_seen=0`.
- Company API call for Betting AI System recent runs returned `total=0`, confirming system runs are invisible in company-scoped view.

Recommendation: schema change, not only meta_json hygiene.

Why:

- Company scope is a product invariant, not optional metadata.
- JSON filtering is fragile and not the right durable index boundary.
- Keepalive/cron/system health events are observability data but should not pollute execute-run metrics.
- A system-runs view needs first-class semantics.

Migration plan:

- Bump schema version in `server/src/services/bba-memory/db.ts:32`.
- Add nullable `company_id TEXT` and `run_scope TEXT NOT NULL DEFAULT 'company' CHECK (run_scope IN ('company','system'))` to `runs`.
- Add indexes `idx_runs_company_started(company_id, started_at DESC)` and `idx_runs_scope_started(run_scope, started_at DESC)`.
- Backfill `company_id = json_extract(meta_json, '$.companyId')` when valid.
- Backfill `run_scope='company'` where `company_id` is not null and `run_scope='system'` where `company_id` is null or source is keepalive/cron-style.
- Update `startRun` input at `server/src/services/bba-memory/repository.ts:109` to accept `companyId?: string | null` and `runScope?: 'company' | 'system'`.
- Update `listRecentRunsForCompany` at `server/src/services/bba-memory/repository.ts:192` to filter `company_id = ? AND run_scope = 'company'`.
- Add `listSystemRuns(limit)` and `getSystemStatsSummary(windowDays)`.
- Update execute recording to pass `companyId`.
- Update keepalive at `server/src/services/bba-session-keepalive.ts:241-253` to record `run_scope='system'`.
- Add either `GET /api/bba-memory/system-runs` for instance admins or `GET /api/companies/:companyId/bba-memory/recent-runs?systemOnly=true`.
- Update `ui/src/components/bba-memory/BbaMemoryRecentRunsPanel.tsx:29-41` or add `BbaMemorySystemRunsPanel.tsx`.
- Update `ui/src/api/bbaMemory.ts:93-99` if using a query param.

Effort: 2-4 hours including migration tests, route tests, and UI tab/filter.

## 10. End-to-end demo day sequence

1. Align runtime worktree: `C:\Users\thepr\GitHub\paperclip` on current `master`.
2. Verify `Invoke-RestMethod http://localhost:3100/api/health` returns ok.
3. Bind secrets:
   - CEO `039a8ee2-d7c0-46d0-adfb-8734430162c9`: `ANTHROPIC_API_KEY`.
   - BBA `9a384d99-8770-4f6d-911a-4797c4973b99`: `ANTHROPIC_API_KEY`.
   - CTO `d9bd4d75-fb9f-4221-85fb-ff59b74b5f44`: `OPENAI_API_KEY`.
4. Verify adapters: CEO/BBA `claude_local`, CTO `codex_local`.
5. Run adapter Test for each agent before resuming.
6. Manually verify Casa login/session. BBA profile default anchor is `server/src/services/betting-browser-automation.ts:86` (`bba-playwright-profile`).
7. Resume agents from the Agents page; filters are defined in `ui/src/pages/Agents.tsx:29-40`.
8. Smoke-test a non-betting issue assigned to CEO and CTO.
9. Smoke-test BBA with a mock/low-risk preset via `BbaOperatorPlayground` if mounted.
10. `ui/src/components/bba-memory/BbaOperatorPlayground.tsx:150` defines the playground.
11. `ui/src/components/bba-memory/BbaOperatorPlayground.tsx:284-294` renders execute panel plus recent-runs panel.
12. Implement Telegram deletion and dashboard mount.
13. Implement prediction-to-approval-to-BBA workflow.
14. Verify full loop: prediction -> approval -> BBA issue -> `/execute` -> BBA Memory company run -> system keepalive in system-runs view.

## 11. Risks + open questions

Risks:

- Real-money execution: `server/src/services/betting-browser-automation.ts:2292-2305` can click final submit paths.
- Secret naming: live env uses `OpenAI`, but Codex expects `OPENAI_API_KEY` (`packages/adapters/codex-local/src/server/execute.ts:338-339`).
- Adapter naming: `claude_code` does not exist; adding an alias may be unnecessary migration work.
- BBA Memory migration: SQLite rebuild logic already exists at `server/src/services/bba-memory/db.ts:141-223`; new schema changes need tests.
- Generic approval route bloat: keep betting side effects out of generic approval code where possible.
- Runtime confusion: stale main worktree can make fixed code appear broken.
- Casa session: Playwright profile may be unauthenticated, expired, or blocked by CAPTCHA/OTP.

Open questions for Costel:

1. Is `claude_local` acceptable as the real adapter type for the product concept `claude_code`?
2. Must both CEO and CTO approve every bet, or can either approve depending on risk?
3. What stake threshold requires CTO review versus CEO-only approval?
4. Can BBA adjust stake/selection, or must it execute the approved payload exactly?
5. Should Casa keepalive be global system scope or owned by Betting AI System company?
6. Should Betting Ops Dashboard be top-level nav or nested under company tools?
7. Should placed bet records be created before execution as intent, or only after `/execute` submits/verifies?
8. What is the canonical low-risk demo bookmaker/preset that cannot place a real bet?
9. Should old Telegram-created issues be migrated, closed, or ignored after Telegram deletion?
10. Should historical BBA Memory rows with `companyId=null` be backfilled as system runs?

Not fully verified:

- No live agent heartbeat was run.
- No agent status was changed.
- No server restart or Casa browser action was performed.
- No secret values were read.
- Historical prediction rows were not fully audited; schema/service behavior was inspected instead.

## 12. Total effort estimate

| Work item | Estimate | Can do today? |
|---|---:|---|
| Runtime alignment | 10 min | Yes |
| Secret bindings + adapter tests | 20-45 min | Yes |
| Telegram deletion | 30-60 min | Yes |
| Betting Ops Dashboard mount + first UI page | 2-4 h | Yes |
| Optional `claude_code` alias | 1-2 h | Optional |
| BBA Memory observability schema/system view | 2-4 h | Yes/tomorrow |
| Prediction -> approval -> BBA workflow | 6-10 h | Hard today |
| E2E/demo hardening | 2-4 h | After workflow |

Total estimate: 14-25 hours.

Today: runtime alignment, secrets, Telegram deletion, dashboard mount, and possibly BBA Memory observability.
Tomorrow: prediction-to-approval-to-BBA workflow and hardening.
Next week: richer risk rules, stake thresholds, audit reports, and post-demo auto-retry.

Recommended implementation order:

1. Runtime alignment process note, no code.
2. Click-ops: bind CEO/BBA/CTO secrets and run adapter tests.
3. PR 1: delete Telegram services and stale global references.
4. PR 2: mount Betting Ops Dashboard and add a Paperclip UI page.
5. PR 3: add BBA Memory company/system observability split.
6. PR 4: implement betting approval workflow and BBA issue creation.
7. PR 5: add demo smoke tests and low-risk execution preset.

The key product insight is that BBA execution is already capable of placing bets, and Paperclip already has governance primitives. The plan should connect those primitives through a narrow, auditable workflow instead of adding a second control plane beside Paperclip.
