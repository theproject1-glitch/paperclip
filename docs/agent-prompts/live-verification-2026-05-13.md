# Agent Prompt Live Verification — 2026-05-13

**Branch reviewed**: `docs/training-plan-and-prompt-polish` (commit `12ab705`)
**Live API queried**: `GET /api/companies/{cid}/agents` — company `b94fed82-...`
**Local AGENTS.md files read**: CEO (`039a8ee2`), CTO (`d9bd4d75`), BBA (`9a384d99`)
**Purpose**: find conflicts in the v2 prompts before the operator pastes them into the Paperclip UI.

---

## Two-layer instruction architecture (read this first)

Every agent has two instruction sources that load **additively**:

| Layer | Where | Content |
|---|---|---|
| **capabilities** | Paperclip UI → Agent → Capabilities field | Pasted by operator; what you're replacing |
| **AGENTS.md** | Disk: `~/.paperclip/.../agents/{id}/instructions/AGENTS.md` | Loaded automatically by the adapter; NOT replaced by pasting |

When you paste a v2 prompt into the Capabilities field you replace **only the capabilities layer**. The AGENTS.md still loads. Both layers are visible to the agent — they don't conflict as long as they don't contradict each other.

**Consequence for BBA**: The live BBA AGENTS.md contains the full Casa Pariurilor selectors, PowerShell code examples, two-call flow details, and session expiry handling. Pasting the thin v2 `bba-final.md` does NOT erase this — it only adds to it. The Casa operational detail is safe.

**Consequence for CEO**: The live CEO AGENTS.md is the generic Paperclip CEO template (delegation rules, SOUL.md/HEARTBEAT.md/TOOLS.md refs, para-memory-files skill). This also continues to load. The v2 CEO capabilities replace only the betting-specific strategy content currently in the capabilities field (which is duplicated and should be replaced).

---

## CEO (`ceo-final.md`) — conflicts

### CRITICAL — BBA is not a direct CEO report

**v2 delegation routing table**:
> "Live bet placement, BBA automation, bookmaker session management → BBA"

**Live API**: `BBA.reportsTo = "d9bd4d75-..."` (CTO). BBA is the CTO's direct report, not the CEO's.

**Impact if pasted as-is**: CEO will route execution tasks directly to the BBA agent, bypassing the CTO. This breaks the intended authority chain (CEO → CTO → BBA) and means the CTO is not in the execution loop for live bets.

**Fix**: Change the routing rule from `→ BBA` to `→ CTO`. The note in v2 that says "Do NOT place bets or interact with BBA directly" is actually correct — it just contradicts the routing table above it. The routing table needs to match the note.

### LOW — CEO model field is empty string in live API

**v2 assumption**: doesn't specify a model (acceptable — capabilities field doesn't set model).

**Live**: `adapterConfig.model: ""` (empty string = adapter default; the CEO adapter uses whatever default the claude_local adapter picks). No action needed — not a conflict.

### INFO — Delegation note consistency

Rule 4: "Do NOT place bets or interact with BBA directly. Route all execution tasks to the BBA agent." — this contradicts the routing table that says to delegate to BBA. Both the note and the routing table will be fixed together: route execution tasks to CTO, who owns BBA.

---

## BBA (`bba-final.md`) — conflicts

### CRITICAL — Authority chain: instructions come from CTO, not CEO

**v2**: "Receive bet instructions from the CEO via Paperclip tasks"
**v2**: "Report results back to the CEO"

**Live API**: `BBA.reportsTo = "d9bd4d75-..."` (CTO). The BBA agent receives tasks created by the CTO, not directly by the CEO.

**Impact if pasted as-is**: The BBA agent will look for tasks from the CEO, report results to the CEO, and may ignore or miscategorize tasks that arrive from the CTO. During training, the CTO creates the execution tasks — BBA needs to recognize CTO as the legitimate authority.

**Fix**: Replace all "CEO" references in the authority/delegation section with "CTO".

### MEDIUM — `attachToUserChrome` references an unmerged feature (PR #55)

**v2**: 
```
For Casa Pariurilor bets, use `execution.attachToUserChrome: true` when the operator's Chrome is already open...
Never set `attachToUserChrome: true` without first confirming...
```

**Reality**: `attachToUserChrome` is introduced in PR #55 ("CDP attach + session replay") which has **REQUEST CHANGES** status and is NOT merged to master. The `execute` API endpoint does not currently accept this field. The live `BettingAutomationExecutionOptions` type does not include it.

**Impact if pasted as-is**: BBA may attempt to use this mode, which will either be silently ignored or cause an unexpected execution path. Also, the reference to `scripts/start-chrome-debug.ps1` may not exist.

**Fix**: Remove the `attachToUserChrome` section entirely. Replace with a note: `# CDP attach (execution.attachToUserChrome) is in review (PR #55) — not yet available.`

### LOW — `requireFinalConfirmation` framing

**v2**: "Every bet placement is a two-step process ... always use this"

**Live AGENTS.md**: `requireFinalConfirmation: $false` — the live operational instructions document autonomous mode where confirmation is skipped. During training the two-step flow is correct, but the blanket "always" conflicts with the autonomous-mode scenario documented in AGENTS.md.

**Decision**: Keep the "always use two-step" framing for training. Add a note that autonomous mode (`requireFinalConfirmation: false`) requires explicit CTO instruction. This is the safer default.

### INFO — Stake limit

**v2**: "Place bets with stakes exceeding 2 RON without explicit operator approval per session"

This matches the training plan (5 bets × 2 RON). Fine to keep.

---

## CTO (`cto-final.md`) — conflicts

### INFO — maxTurnsPerRun already at 40 (correct)

**v2** doesn't specify this (it's not in the capabilities field). The live API already shows `maxTurnsPerRun: 40` — Codex applied this in a prior session. No conflict.

### INFO — Session compaction values in v2 are accurate

**v2**: "maxSessionRuns=8, maxRawInputTokens=500000, maxSessionAgeHours=12"
**Live**: matches exactly. These were updated by Codex (codex/pap-3135). No conflict.

### INFO — Implementation backlog items are verified correct

All P1/P2 items listed in the CTO v2 backlog section were verified against live code:
- `generateIdempotencyKey` missing `companyId` — confirmed in `bba-memory/index.ts`
- `retryAfterMs: 5000` — confirmed in `routes/betting-browser-automation.ts` line 238
- `COOKIE_CACHE_PATH` not per-company — confirmed in automation service
No conflicts here.

### NO ACTION — CTO v2 is paste-ready with one minor addition

Add a single line to the delegation section noting that CTO delegates to BBA for execution. This is implied but not stated.

---

## Summary table

| Agent | Conflict | Severity | Action |
|---|---|---|---|
| CEO | BBA listed as direct CEO report (should be CTO) | **CRITICAL** | Change `→ BBA` to `→ CTO` in routing table |
| CEO | Rule 4 contradicts routing table | LOW | Fix routing table; Rule 4 becomes consistent |
| BBA | "from the CEO" — wrong authority chain | **CRITICAL** | Change to "from the CTO" throughout |
| BBA | `attachToUserChrome` references unmerged PR #55 | MEDIUM | Remove entire section; leave placeholder comment |
| BBA | "always" two-step conflicts with autonomous-mode docs | LOW | Add "unless CTO instructs autonomous mode" |
| CTO | None — v2 is correct | INFO | Minor addition: explicit BBA delegation note |

---

## Paste order

1. **CTO** first — no critical fixes, and CTO config owns the BBA delegation chain
2. **CEO** second — after fixing the routing table
3. **BBA** last — after fixing authority chain and removing CDP reference

Paste-ready files: `ceo-paste-ready.md`, `cto-paste-ready.md`, `bba-paste-ready.md` (all in this directory).
