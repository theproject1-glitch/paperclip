# Agent Prompts — Sync Audit and v2 Recommendations

**Date**: 2026-05-13  
**Auditor**: Claude Sonnet 4.6  
**Agents reviewed**: CEO, CTO, BBA  
**Purpose**: Confirm capability content matches code reality; identify duplicates, gaps, and stale references; recommend v2 capability text.

---

## Agent Configuration Summary

| Agent | Adapter | Model | maxTurns | sessionCompaction |
|---|---|---|---|---|
| CEO (`039a8ee2`) | `claude_local` | `claude-sonnet-4-6` | 40 | `maxSessionRuns=1, maxRawInputTokens=0, maxSessionAgeHours=0` |
| CTO (`d9bd4d75`) | `codex_local` | `gpt-5.4` | 25 | `maxSessionRuns=15, maxRawInputTokens=800000, maxSessionAgeHours=24` |
| BBA (`9a384d99`) | `claude_local` | `claude-sonnet-4-6` | 50 | default |

**BBA extra flags**: `paperclipSkillSync: { desiredSkills: "paperclipai/paperclip/paperclip" }`, `dangerouslySkipPermissions: true`

---

## Issues Found

### Issue 1 — CEO session compaction resets every run (HIGH)

```
CEO sessionCompaction: { maxSessionRuns: 1, maxRawInputTokens: 0, maxSessionAgeHours: 0 }
```

`maxSessionRuns=1` means the CEO's session context is compacted after every single run. The CEO effectively has no memory of prior runs without using the `para-memory-files` skill. This is intentional if the CEO is designed to reload all context from its PARA memory system on each run, but it means:

- A run that fails mid-execution leaves no compacted context to resume from.
- The CEO must re-read all relevant memory files at the start of every heartbeat to reconstruct state.
- Any transient state not explicitly written to memory is lost.

**Recommendation**: Keep `maxSessionRuns=1` only if the PARA memory system is reliable and complete. If the CEO frequently loses context between runs (evidenced by repeated re-reading of the same files), increase to `maxSessionRuns=3` and `maxRawInputTokens=200000` so the model can retain the last few turns of context.

---

### Issue 2 — CEO and CTO capabilities have duplicated strategy-v2 content (HIGH)

Both the CEO and CTO capabilities contain the betting strategy parameters twice — once as rendered markdown and once as a JSON-escaped string of the same markdown. This doubles the token cost on every run and creates a maintenance hazard: a strategy update requires editing both copies per agent.

The duplicated block covers:
- Sport-level minimum edge thresholds (football ≥2%, basketball ≥3%, tennis ≥4%)
- Kelly fraction (0.25, capped at 3% of bankroll)
- Daily stop-loss (-5% soft alert, -10% hard halt)
- 24h halt after 3 consecutive losses
- Lifetime stop-loss: 70% of initial bankroll
- Bet type: singles only
- Concentration limits: 40% per sport, 25% per league
- Skip if best EV <4%

**Fix**: Keep one copy (plain markdown). Remove the escaped-markdown duplicate. The plain markdown version is sufficient — the adapter does not need an escaped string.

---

### Issue 3 — CTO capabilities reference the betting strategy directly (MEDIUM)

The CTO should be an engineering decision-maker, not a strategy executor. Having the full strategy-v2 parameters in the CTO's capability context adds noise to technical tasks that don't involve strategy. It also means the CTO could attempt to apply strategy parameters during code generation tasks where they don't belong.

**Recommendation**: Move strategy-v2 content to a shared `STRATEGY.md` document that both CEO and BBA reference explicitly. The CTO capability should reference strategy only in the context of implementation constraints (e.g., "the risk parameter defaults are in `betting-stop-loss.ts`; do not change them without CEO approval").

---

### Issue 4 — BBA capability does not reference the execute flow constraints (MEDIUM)

The BBA agent (`dangerouslySkipPermissions: true`) has broad system access. Its capability should explicitly list what it may and may not do during a bet execution session. Currently, the capability relies on the Playwright session's implicit scope (browser-only), but the BBA also has file system access and can call arbitrary shell commands.

**Recommendation**: Add an explicit boundary list to BBA capabilities:
- Permitted: browser automation, file writes under `~/.paperclip/bba-memory/`, reading bookmaker configs from DB
- Prohibited: writing to any path outside the session artifact directory, reading other companies' data, making HTTP calls outside the target bookmaker domain

---

### Issue 5 — BBA `dangerouslySkipPermissions: true` is undocumented (LOW)

The BBA agent bypasses the Paperclip permission approval flow. This is intentional (interactive approval during a live bet placement is impractical), but it is not documented in the BBA capability or in the runbook. If an operator inspects the agent config and sees `dangerouslySkipPermissions: true`, they may not know why it's set.

**Recommendation**: Add one line to BBA capabilities: "This agent runs without interactive permission prompts. All actions it takes are scoped to the active bet session and constrained by the bookmaker configuration provided at request time."

---

## Recommended Capability Text Changes

### CEO capability — remove duplicate strategy block

```diff
- [duplicated escaped-markdown version of strategy-v2]
```

Keep the rendered markdown version. The capability should reference `./SOUL.md`, `./HEARTBEAT.md`, and a shared `./STRATEGY.md` (new file).

### CEO capability — add BBA delegation rule

Add to the delegation routing section:

```
- **Live bet placement, BBA automation, bookmaker session management** → BBA agent
```

The current routing only lists CTO, CMO, UXDesigner. The BBA agent is not in the CEO's routing table, which means the CEO may attempt to handle BBA tasks itself or delegate them to the CTO incorrectly.

### CTO capability — remove strategy-v2 parameters

The CTO needs to know that stop-loss defaults exist in `betting-stop-loss.ts` (5% daily / 10% session) and should not be changed without CEO sign-off. It does not need the full Kelly fraction and sport-level edge tables.

Replace with:

```
Risk parameter defaults are defined in server/src/services/betting-stop-loss.ts. 
DEFAULT_DAILY_LIMIT_PCT = 0.05, DEFAULT_SESSION_LIMIT_PCT = 0.10.
Do not modify these constants without explicit CEO approval.
```

### BBA capability — add session boundary declaration

```
This agent operates in browser-automation mode. It has dangerouslySkipPermissions 
enabled because interactive approval during live bet placement is not feasible.
All actions are scoped to the bet session artifact directory 
(~/.paperclip/data/betting-browser-automation/{companyId}/{sessionId}).
```

---

## Config Changes Recommended

| Agent | Parameter | Current | Recommended | Reason |
|---|---|---|---|---|
| CEO | `maxSessionRuns` | 1 | 3 | Allow short-term context retention if PARA memory is incomplete |
| CEO | `maxRawInputTokens` | 0 | 200000 | Pair with above; 0 means compact immediately regardless of size |
| CTO | `maxTurnsPerRun` | 25 | 40 | CTO handles complex coding tasks; 25 turns is tight for multi-file changes |
| BBA | `graceSec` | 90 | 120 | Playwright sessions occasionally run long; 90s grace may not cover Casa login + search + place |
| All | strategy content | duplicated | deduplicated | Single-source strategy-v2 in shared STRATEGY.md |

---

## Shared STRATEGY.md (proposed)

Create `server/src/onboarding-assets/ceo/STRATEGY.md` with the strategy-v2 parameters as canonical single source. Both CEO and BBA AGENTS.md would reference it:

```
## Betting Strategy (v2)

- **Minimum edge thresholds**: football ≥2%, basketball ≥3%, tennis ≥4%
- **Stake sizing**: fractional Kelly 0.25, capped at 3% of current bankroll
- **Daily stop-loss**: −5% soft alert (log warning), −10% hard halt (block all bets, 24h hold)
- **Consecutive loss halt**: 3 consecutive losses → 24h suspension
- **Lifetime stop-loss**: halt permanently if bankroll drops below 70% of initial deposit
- **Bet type**: singles only (no accumulators, no system bets)
- **Concentration limits**: max 40% of daily stake allocation per sport, 25% per league
- **Skip threshold**: if best available EV is <4%, pass on the bet entirely
```

The BBA agent and CEO agent reference this file. The CTO references only the DB defaults.
