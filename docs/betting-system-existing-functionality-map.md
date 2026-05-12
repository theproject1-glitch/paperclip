# Betting System Existing Functionality Map

Prepared: 2026-05-12
Branch: `docs/existing-functionality-map`
Baseline inspected: `master` at `90f7234b939fef0f41621103487e12d909ab039a`
Scope: read-only audit v3. No agent, service, route, schema, secret, database, or runtime state was modified while preparing this document.

This audit corrects the main blind spot from the earlier audits: the Betting AI System is not only the three Paperclip employee agents (CEO, CTO, BBA). A substantial Python betting engine already exists inside the managed project workspace, with sub-agent modules for data collection, analysis, mathematical selection, execution/risk, performance tracking, and simulation.

Managed project workspace inspected:

`C:\Users\thepr\.paperclip\instances\default\projects\b94fed82-38bf-4eb3-81d8-9b1a8aa84921\9ab808d0-c649-4e11-893e-6f9767fad183\_default\betting-system`

## 1. Agent architecture (real, code-grounded)

### Paperclip employee agents

Live API data for company `b94fed82-38bf-4eb3-81d8-9b1a8aa84921` shows three Paperclip agents:

| Agent | ID | Adapter | Current status | What it really does |
|---|---|---|---|---|
| CEO | `039a8ee2-d7c0-46d0-adfb-8734430162c9` | `claude_local` | `paused` | Strategy, delegation, coordination, bankroll oversight. |
| CTO | `d9bd4d75-fb9f-4221-85fb-ff59b74b5f44` | `codex_local` | `error` | Technical execution, integrations, BBA payloads, debugging. |
| BBA | `9a384d99-8770-4f6d-911a-4797c4973b99` | `claude_local` | `paused` | Browser bet execution via the Paperclip `/betting-browser-automation/execute` API. |

Code and instruction anchors:

- CEO instructions at `C:\Users\thepr\.paperclip\instances\default\companies\b94fed82-38bf-4eb3-81d8-9b1a8aa84921\agents\039a8ee2-d7c0-46d0-adfb-8734430162c9\instructions\AGENTS.md:1` define the CEO as a leader/delegator, not an implementer.
- CEO instructions at `AGENTS.md:12-18` require delegation to CTO for code, bugs, features, infra, devtools, and technical work.
- CTO instructions at `...\agents\d9bd4d75-fb9f-4221-85fb-ff59b74b5f44\instructions\AGENTS.md:5` make CTO responsible for architecture, code, integrations, debugging, and data pipelines.
- CTO BBA instructions at `AGENTS.md:18-24` specify the BBA execution payload must include `chromium`, the persistent profile at `C:\Users\thepr\.paperclip\bba-playwright-profile`, and `skipLogin: true`.
- CTO Casa selector block at `AGENTS.md:32-45` contains the verified Casa Pariurilor selectors.
- BBA instructions at `...\agents\9a384d99-8770-4f6d-911a-4797c4973b99\instructions\AGENTS.md:4` say its only job is to place bets on `casapariurilor.ro` by calling the `betting-browser-automation/execute` API directly.
- BBA instructions at `AGENTS.md:30-32` provide the exact endpoint and auth header shape.

Important correction: the CEO capability text mentions `data_collector`, `analyst`, `mathematician`, and `executor`, but those are not separate Paperclip employees in the live agents table. They are implemented as modules inside the managed `betting-system` workspace.

### Betting-system sub-agents

The project workspace contains 15 Python files, one Python test file, 4 data files, and 62 report/log artifacts. These are the real sub-agent modules:

| Reported role | Actual file | Main class/function | Evidence |
|---|---|---|---|
| `data_collector` | `agents/data_collector.py` | `DataCollectorAgent` | Class starts at `agents/data_collector.py:557`; `collect()` starts at `:568`. |
| `analyst` | `agents/analyst.py` | `AnalystAgent` | Class starts at `agents/analyst.py:28`; `analyze()` starts at `:40`. |
| `mathematician` | `agents/selection_engine.py` | `BetSelectionEngine` | The named file `mathematician.py` was not found; the mathematical role is implemented by `selection_engine.py:102`. |
| `executor` | `agents/execution_manager.py` | `ExecutionManagerAgent` | Class starts at `agents/execution_manager.py:67`; `execute()` starts at `:80`. |
| performance tracker | `agents/performance_tracker.py` | `PerformanceTrackerAgent` | Class starts at `agents/performance_tracker.py:24`; daily report at `:45`. |
| simulator | `agents/simulation.py` | `SimulationRunner` | Class starts at `agents/simulation.py:27`; `run()` starts at `:36`. |

The orchestrator is `daily_loop.py`. Its top docstring says the loop is:

1. DataCollector fetches and filters live odds.
2. Analyst identifies +EV opportunities.
3. ExecutionManager performs final risk check and places bets.
4. PerformanceTracker writes the daily report.

Concrete line anchors:

- `daily_loop.py:130` defines `run_daily_session(...)`.
- `daily_loop.py:169` calls `collector.collect()`.
- `daily_loop.py:251` calls `tracker.generate_daily_report(session_date)`.
- `daily_loop.py:280` is the CLI entry that runs the session.

### Relationship between layers

There are two layers that should not be conflated:

1. The Python betting engine selects, sizes, simulates, records, and reports bets.
2. Paperclip CEO/CTO/BBA agents and the BBA browser API can execute real Casa bets through Playwright.

What works today: the Python engine can run a full daily loop in demo/simulation mode and write odds, bets, bankroll, and reports.

What is not automatic yet: a selected Python bet does not deterministically become a Paperclip BBA issue or a direct call to `/api/companies/:companyId/betting-browser-automation/execute`. That bridge is the key remaining product gap.

## 2. Existing prediction pipeline (the 90% functional part)

### Data ingestion

`agents/data_collector.py` is real-capable and demo-capable:

- `agents/data_collector.py:29-33` reads `THE_ODDS_API_KEY` / `ODDS_API_KEY`, `SPORTS_GAME_ODDS_API_KEY`, and defines The Odds API and SportsGameOdds base URLs.
- `agents/data_collector.py:35-40` lists supported sports/leagues: Premier League, La Liga, Bundesliga, Serie A, Ligue 1, NBA, EuroLeague, ATP, WTA, MLB.
- `agents/data_collector.py:42-57` maps league names to The Odds API and SportsGameOdds identifiers.
- `agents/data_collector.py:221-228` merges real odds from The Odds API and SportsGameOdds when keys exist.
- `agents/data_collector.py:253` starts The Odds API fetch.
- `agents/data_collector.py:398` starts SportsGameOdds fetch.
- `agents/data_collector.py:543` exposes `fetch_real_odds()`.
- `agents/data_collector.py:557` defines `DataCollectorAgent`.
- `agents/data_collector.py:568` defines `collect()`.
- `agents/data_collector.py:596` defines the deterministic filter currently named `_ai_filter`.

Runtime evidence:

- `data/live_odds.json` exists and was last modified on 2026-05-11 10:00.
- `reports/logs/daily_loop_2026-05-11_10-00-02.log` says `Mode: LIVE (DEMO)`, fetched 13 raw markets, filtered to 12 clean markets, and saved them to the data store.

Interpretation: ingestion works structurally. It can use real APIs if keys are present, and it falls back to demo markets when real odds are unavailable or empty.

### Analysis and filtering

`agents/analyst.py` is a thin wrapper around the selection engine:

- `agents/analyst.py:28` defines `AnalystAgent`.
- `agents/analyst.py:40` defines `analyze()`.
- `agents/analyst.py:51` calls `self.engine.select_bets(...)`.

`agents/selection_engine.py` is the real mathematical/filtering core:

- `agents/selection_engine.py:19-28` defines the core constraints: singles probability 70-85%, combo leg minimum 75%, minimum edge 2%, minimum odds 1.20, max two combo legs, max 10 daily bets, max market overround 1.20, minimum event lead time 0.75 hours.
- `agents/selection_engine.py:108` defines `select_bets(...)`.
- `agents/selection_engine.py:122` builds combos from the remaining opportunity pool.
- `agents/selection_engine.py:188` defines `_build_combos(...)`.
- `agents/selection_engine.py:191` requires combo candidates to be non-draw selections with probability at least 75% and edge at least 2%.
- `agents/selection_engine.py:207` applies combo compatibility checks.
- `agents/selection_engine.py:390` defines `_passes_basic_filters(...)`.
- `agents/selection_engine.py:413` defines `_combo_markets_compatible(...)`.
- `agents/selection_engine.py:426` defines `_combo_score(...)`.
- `agents/selection_engine.py:439` defines confidence labels.

Runtime evidence:

- The 2026-05-11 daily log says Analyst selected 5 bets from 12 markets: 5 singles and 0 combos.
- `data/bets_log.json` contains 92 bet records: 69 won, 19 lost, 4 pending. All 92 current records are `single`.

Interpretation: predictions/filtered lists are not hypothetical. The system has a functioning odds-to-candidate-bet pipeline. Combo generation exists in code, but current ledger evidence is singles-only.

### Bankroll and stop-loss

`shared/bankroll.py` handles bankroll, bet quotas, stop-loss, daily exposure, and stake sizing:

- `shared/bankroll.py:19-24` defines daily stop-loss 5%, session stop-loss 10%, max 10 daily bets, 50/50 singles/combos split, and 15% max daily exposure.
- `shared/bankroll.py:128` defines daily reset and profit reinvestment behavior.
- `shared/bankroll.py:254` defines `evaluate_stop_loss(...)`.
- `shared/bankroll.py:273-287` checks daily and session loss thresholds.
- `shared/bankroll.py:315` defines stake sizing.
- `shared/bankroll.py:332` defines `reserve_stake(...)`.
- `shared/bankroll.py:345-346` enforces max daily exposure.

There is a small documentation drift: `README.md:30` says daily stop-loss is -6%, while `shared/bankroll.py:19` enforces 5%. The product goal text has also mentioned other thresholds historically. The code should be treated as authoritative until the operator chooses a final risk rule.

Runtime evidence from `data/bankroll.json`:

- Current bankroll: about 1604.66.
- Secured profits: about 385.84.
- Lifetime profit: about 909.02.
- Current day bets: 5.
- Current day P&L: about +124.07.
- Stop-loss: false.
- Daily history length: 21 days.

### Execution and ledger

`agents/execution_manager.py` performs risk review and demo execution:

- `agents/execution_manager.py:29` makes demo mode default with `BETTING_DEMO_MODE`.
- `agents/execution_manager.py:60-62` defines `place_real_bet(...)` and raises `NotImplementedError` for real bookmaker placement.
- `agents/execution_manager.py:80` defines `execute(...)`.
- `agents/execution_manager.py:93` runs deterministic risk review.
- `agents/execution_manager.py:101` reserves stake through the bankroll manager.
- `agents/execution_manager.py:111-117` simulates and settles outcomes immediately in demo mode.
- `agents/execution_manager.py:120` is where real mode would call `place_real_bet(...)`.
- `agents/execution_manager.py:123` saves the bet to the data store.
- `agents/execution_manager.py:129` supports simulation review without placing.
- `agents/execution_manager.py:162` appends execution audit events.
- `agents/execution_manager.py:189` defines deterministic risk checks.
- `agents/execution_manager.py:233-236` skips pending settlement in demo mode because demo bets settle immediately.

This means the Python `executor` exists and works for demo/simulation/risk review, but it is not the real Casa execution path. Real Casa execution is the Paperclip BBA browser service.

### Performance tracking and learning signals

`agents/performance_tracker.py` is not just logging:

- `agents/performance_tracker.py:45` defines `generate_daily_report(...)`.
- `agents/performance_tracker.py:70` detects anomalies.
- `agents/performance_tracker.py:71` generates recalibration signals.
- `agents/performance_tracker.py:120` defines anomaly detection.
- `agents/performance_tracker.py:159` defines recalibration signal generation.
- `agents/performance_tracker.py:194` can generate an Anthropic-backed report when configured.

Runtime evidence:

- There are 24 daily report JSON files and 25 daily-loop log files.
- `reports/report_2026-05-11.json` records 5 bets, +124.07 P&L, 83.8% ROI, and a high-win-rate anomaly.
- The 2026-05-11 daily log shows the tracker produced an AI-style daily report and recalibration recommendations by sport.

Interpretation: the learning loop is currently report/recalibration-oriented rather than self-training. It detects anomalies and calibration drift, but it does not automatically rewrite the model or selection code.

## 3. Skills and tools per agent

Company skill inventory from `GET /api/companies/:companyId/skills` returned 9 skills:

- `vercel-labs/agent-browser/agent-browser`
- `paperclipai/paperclip/diagnose-why-work-stopped`
- `paperclipai/paperclip/paperclip`
- `paperclipai/paperclip/paperclip-converting-plans-to-tasks`
- `paperclipai/paperclip/paperclip-create-agent`
- `paperclipai/paperclip/paperclip-create-plugin`
- `paperclipai/paperclip/paperclip-dev`
- `paperclipai/paperclip/para-memory-files`
- `paperclipai/paperclip/terminal-bench-loop`

Adapter skill plumbing is present:

- `server/src/adapters/registry.ts:230` wires `syncClaudeSkills` into the Claude adapter registration.
- `server/src/adapters/registry.ts:272` wires `syncCodexSkills` into the Codex adapter registration.
- `packages/adapters/codex-local/src/server/execute.ts:85` uses API-key auth when `OPENAI_API_KEY` is present, otherwise local subscription/session auth.
- `packages/adapters/codex-local/src/server/execute.ts:477` injects `PAPERCLIP_API_KEY` into Codex runs.
- `packages/adapters/claude-local/src/server/execute.ts:119` uses API-key auth when `ANTHROPIC_API_KEY` is present, otherwise local subscription/session auth.
- `packages/adapters/claude-local/src/server/execute.ts:258` injects `PAPERCLIP_API_KEY` into Claude runs.

Current practical state:

- CTO is `codex_local` and can use Paperclip skills once secret/env binding is correct.
- CEO and BBA are `claude_local` and can use the Paperclip API token injected into their runs.
- BBA instructions explicitly tell it not to use generic browser skill for bet placement; it must call the BBA API.
- The Python sub-agent modules do not use Paperclip skills directly. They are project code executed from the managed workspace.

## 4. Memory and learning systems

### Paperclip memory

The three Paperclip agents use the normal Paperclip issue/run system for task history, comments, instructions, skills, and run transcripts. They also have managed instruction roots under:

`C:\Users\thepr\.paperclip\instances\default\companies\b94fed82-38bf-4eb3-81d8-9b1a8aa84921\agents\<agent-id>\instructions\AGENTS.md`

The CEO is explicitly instructed to delegate and follow up. The CTO owns technical execution. The BBA owns operational execution. These instructions are real and current.

### Betting-engine memory

The Python betting engine uses file-backed memory:

- `shared/data_store.py:24` saves odds.
- `shared/data_store.py:29` loads odds.
- `shared/data_store.py:66` saves bets.
- `shared/data_store.py:74` loads bets.
- `shared/data_store.py:81` appends execution audit events.
- `data/live_odds.json` stores the latest market snapshot.
- `data/bets_log.json` stores the bet ledger.
- `data/bankroll.json` stores bankroll, secured profits, daily history, counters, and stop-loss state.
- `data/execution_audit.jsonl` stores execution/risk events.
- `reports/report_*.json` and `reports/logs/daily_loop_*.log` store daily outcomes and analysis.

### Self-coding scope

There is no autonomous self-modifying betting model in the Python engine. The “learning” already present is:

- Performance tracking and anomaly detection.
- Calibration/error signals by sport.
- Historical bet ledger and bankroll evolution.
- Agent work through Paperclip issues, where CTO/CEO can create code changes as normal Paperclip tasks.

So the agents can write code through Paperclip’s normal Codex/Claude adapter workflow, but the betting engine itself does not mutate its own source code automatically.

## 5. External APIs in use

Confirmed in code:

| API/system | Purpose | Evidence |
|---|---|---|
| The Odds API | Odds ingestion and simulation result lookup | `agents/data_collector.py:29`, `:32`, `:253`; `agents/simulation.py:17`, `:119-163`. |
| SportsGameOdds | Alternate odds ingestion | `agents/data_collector.py:30`, `:33`, `:398`. |
| Anthropic | Claude adapter auth and optional performance report generation | `packages/adapters/claude-local/src/server/execute.ts:119`; `agents/performance_tracker.py:194`. |
| OpenAI | Codex adapter auth | `packages/adapters/codex-local/src/server/execute.ts:85`. |
| Casa Pariurilor | Real browser bet placement target | BBA/CTO instructions and `server/src/routes/betting-browser-automation.ts:177`. |
| Telegram | Legacy notification channel | `daily_loop.py:51`, `shared/notifications.py`; runtime logs show it is skipped when env is missing. |
| Brave/Search | Agent research capability via secret/env binding | Present in live agent adapter configs and skill inventory. |

Secrets are present in the live Paperclip secret inventory for odds and model APIs, but this audit intentionally does not print or reproduce secret values. One hygiene issue: the secret inventory appears to contain at least a couple of records whose names look key-like rather than descriptive; those should be renamed/rotated if they contain real key material.

## 6. What is ACTUALLY broken (not what is missing)

These are runtime or wiring failures observed during the audit:

1. CTO is in `error` state. The observed failure from the prior audit is: `Secret is not bound to agent:d9bd4d75-fb9f-4221-85fb-ff59b74b5f44 at env.OpenAI`. Current CTO config binds an `OpenAI` env entry, while the Codex adapter expects canonical `OPENAI_API_KEY` for API-key mode.
2. CEO is paused by watchdog after 3 consecutive failures.
3. BBA is paused by watchdog after 3 consecutive failures.
4. BBA Memory shows only recent keepalive failures: ids 504-507, source `keepalive`, outcome `failure`, failure class `UNKNOWN`.
5. Critical BBA execution issues remain blocked, especially BET-217 (live single bet validation), BET-223 (BBA max-turns failure), BET-216 (combo validation), and BET-163 (end-to-end BBA autonomy).
6. Python `place_real_bet()` is intentionally unimplemented, so the Python executor cannot place real bookmaker bets by itself.
7. Telegram reporting is stale/obsolete for the desired product direction and currently skipped due missing env.
8. Risk-rule documentation is inconsistent: README says daily stop-loss -6%, while code enforces 5%.
9. The live Paperclip REST API has no prediction/odds/bets/bankroll endpoints at paths like `/api/companies/:companyId/predictions` or `/odds`; they all returned HTTP 404. The data exists in workspace JSON files, not as Paperclip product endpoints.

The important nuance: these failures do not mean the prediction engine is absent. They mean the currently broken surface is agent runtime state, secret binding, BBA operational execution, and product integration.

## 7. What is missing for end-to-end demo (realistic remaining 10%)

Given the code and artifacts above, the missing work is narrower than a 14-25 hour rebuild:

1. Fix agent runtime health.
   - Bind/fix `OPENAI_API_KEY` for CTO and `ANTHROPIC_API_KEY` for Claude agents.
   - Unpause CEO/BBA after the secret fix.
   - Confirm CTO can run one Paperclip issue.
   - Effort: 30-60 minutes.

2. Verify BBA operational execution.
   - Use the existing BBA API and instructions to run a tiny single-bet validation or a dry-run/debug task.
   - Address max-turn/run-loop issue from BET-223 if still present.
   - Effort: 1-2 hours depending on Casa session state.

3. Bridge selected bets to BBA execution.
   - Minimal demo path: a script or CTO task reads `data/bets_log.json` or current Analyst output, converts one selected bet into the BBA `/execute` payload, creates a BBA issue or calls the API with CEO/CTO approval recorded in the issue.
   - Product path: mount this in Paperclip UI as “Approve and send to BBA”.
   - Effort: 1.5-4 hours for minimal bridge; 4-8 hours for polished UI/product flow.

4. Surface existing Python outputs in Paperclip.
   - Either mount/read the JSON artifacts or add lightweight endpoints for bankroll, latest odds, selected bets, and reports.
   - Effort: 1-3 hours.

5. Clean up or align drift.
   - Decide stop-loss rule (5%, 6%, or another value) and update README/code accordingly.
   - Remove or quarantine Telegram if product control is Paperclip-only.
   - Effort: 30-90 minutes.

What is not missing: odds ingestion code, filters, combo selection logic, bankroll controls, simulation, reporting, and BBA browser execution primitives.

## 8. Revised effort estimate

Earlier v2 estimate: 14-25 hours.

Revised estimate after v3:

| Target | Estimate | Why |
|---|---:|---|
| Make current system demo-operational with manual bridge | 3-6 hours | Most pipeline pieces already exist; fix runtime state, secrets, BBA validation, and one selected-bet-to-BBA path. |
| Productize the bridge inside Paperclip UI/API | 6-10 hours | Add endpoints/UI around existing JSON artifacts and approvals. |
| Production-grade automated prediction -> CEO/CTO approval -> BBA execution with reconciliation | 10-16 hours | Requires robust approval state, payload mapping, receipt reconciliation, ledger sync, and failure recovery. |

The realistic “remaining 10%” for the user’s reported current system is closer to 3-6 hours for a demo path, not a ground-up multi-day build.

## 9. Agent description rewrite specs

Do not describe the system as if sub-agents are imaginary. The descriptions should capture the actual two-layer architecture.

### CEO description should capture

- CEO is the strategic director and approval authority.
- CEO delegates technical implementation and debugging to CTO.
- CEO supervises bankroll, stop-loss, risk posture, and major strategy changes.
- CEO does not run the Python data pipeline directly, but can schedule/delegate it.
- CEO approves when a selected bet should move from candidate to execution.
- CEO should know that the sub-agent functions live in the managed `betting-system` project workspace.

### CTO description should capture

- CTO owns the technical integration between Paperclip and the Python betting engine.
- CTO manages APIs, secrets, scripts, runtime alignment, and BBA payload correctness.
- CTO turns approved predictions into BBA execution issues or direct BBA API calls.
- CTO can inspect/update the managed `betting-system` workspace.
- CTO is responsible for ensuring BBA has exact Casa selectors, persistent profile settings, and `skipLogin` behavior when appropriate.

### BBA description should capture

- BBA is not a predictor or analyst.
- BBA executes only CTO/CEO-approved bet payloads.
- BBA should call `/api/companies/:companyId/betting-browser-automation/execute` directly.
- BBA should report concrete blockers: auth/session, selector failure, odds drift, event unavailable, stake/bet slip issue, confirmation failure.
- BBA should not spend turns analyzing the whole codebase unless assigned a selector/auth debugging task.

### Sub-agent descriptions should capture

- `data_collector`: pulls odds from The Odds API and SportsGameOdds, filters markets, writes `data/live_odds.json`.
- `analyst`: loads odds and delegates selection to `BetSelectionEngine`.
- `mathematician`: currently implemented as `selection_engine.py`; scores singles and two-leg combos with hard risk filters.
- `executor`: currently implemented as `execution_manager.py`; handles risk review and demo execution, but real Casa placement is through Paperclip BBA.
- `performance_tracker`: writes reports, detects anomalies, and produces recalibration signals.

## 10. Open questions

1. Should the Python role be renamed from `selection_engine` to an explicit `mathematician.py`, or is documentation enough?
2. Should the Python `ExecutionManagerAgent` ever call Paperclip BBA directly, or should CTO always create/approve BBA issues?
3. Which stop-loss threshold is authoritative: code 5%, README 6%, or another operator-selected value?
4. Should Telegram be deleted from the Python workspace now, or kept as an optional legacy notifier while Paperclip UI becomes the control surface?
5. Should the 4 pending bets in `bets_log.json` be settled before resuming daily execution?
6. Are demo-mode results acceptable for the next demo, or must the next run use real odds and one real Casa execution?
7. Should combo generation be forced in demo if the current slate keeps producing singles-only ledgers?
8. Should Paperclip persist predictions/odds in Postgres, or simply read the existing workspace JSON files for the first product bridge?

## Bottom line

The user’s correction is right: the Betting AI System is not a mostly empty shell. The existing Python workspace already contains the data collector, analyst, mathematical selection engine, executor/risk manager, bankroll controls, simulation, report generation, historical ledger, and daily-loop orchestration.

The system is not “fully functional” because the live Paperclip agents are paused/erroring, the real execution bridge is not deterministic, and the Paperclip UI/API does not expose the Python pipeline outputs. The next implementation should be a narrow integration and runtime-health pass, not a rebuild.
