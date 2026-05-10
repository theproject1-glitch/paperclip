# BBA Memory — Demo Runbook

**Audience**: Costel (operator), co-presenter (optional), CEO/CTO (audience)  
**Demo duration**: ~10 minutes happy path + ~3 minutes Q&A  
**This document**: high-level demo FLOW — what phases to run and in what order, Q&A prep, and decision points.

Related docs (read these too — this doc links to all of them):

| Doc | Purpose |
|---|---|
| [`bba-memory-architecture.md`](bba-memory-architecture.md) | Architecture intro slide for Phase 1 of the demo |
| [`bba-memory-demo-readiness-checklist.md`](bba-memory-demo-readiness-checklist.md) | Pre-flight: T-7d / T-1d / T-30min checks |
| [`bba-memory-demo-dry-run.md`](bba-memory-demo-dry-run.md) | Operator click sequence: T+0 through T+60s (minute-by-minute) |
| [`bba-memory-deployment.md`](bba-memory-deployment.md) | Build + env setup + production tag procedure |

---

## Demo Participants

| Role | Person | Responsibility |
|---|---|---|
| **Operator** | Costel | Drives the demo: clicks buttons, types CONFIRM, narrates actions |
| **Audience** | CEO / CTO | Observes, asks questions |
| **Co-presenter** (optional) | TBD | Handles architecture intro slide in Phase 1, freeing operator to set up tabs |

If running solo (no co-presenter): present the architecture doc from the browser instead of a slide, then switch to the UI tab.

---

## Demo Arc

### Phase 1 — Context (5 min)

**Goal**: CEO/CTO understands what they're about to see before the bet is placed.

1. Open [`docs/bba-memory-architecture.md`](bba-memory-architecture.md) in a browser or shared screen. Walk through:
   - What it does (one paragraph)
   - System diagram — point to each box and name it: Operator UI → Server → BBA Engine → Casa → Memory
   - Safety mechanisms — emphasize CONFIRM modal, idempotency, CAPTCHA abort
2. Show the three tabs already open: BBA Memory UI, Casa My Bets, server log terminal.
3. Confirm the Recent Runs panel shows "No runs yet" — this is the before state.

**Transition line**: *"You've seen the architecture. Let me place a real bet right now and you'll see every one of those boxes light up."*

---

### Phase 2 — Live Placement (5 min)

**Goal**: prove the full loop — click → bet at Casa → result in UI.

Follow the click-by-click sequence in [`docs/bba-memory-demo-dry-run.md`](bba-memory-demo-dry-run.md), T+0 through T+55s:

| Moment | What to say |
|---|---|
| Before clicking | *"I'm placing a real bet — watch the server logs."* |
| After typing CONFIRM | *"Deliberate friction. A mis-click cannot place money."* |
| While spinner runs | *"Playwright is opening Chrome, logging in, finding the bet form."* |
| When ✅ appears | *"Real bet, placed. Here's the bet ID from the bookmaker."* |
| When switching to Casa tab | *"And here it is on the bookmaker's side — My Bets, just appeared."* |
| When switching back to UI | *"Recent Runs auto-updated. Full audit trail: runId, timestamp, stake, outcome."* |

---

### Phase 3 — Safety + Intelligence (5 min)

**Goal**: show the system is smart, safe, and auditable — not just a one-trick automation.

**3a — Idempotency replay** (~90s):

1. Click "Place Bet" again — same payload, same company.
2. Type CONFIRM, click Place Real Bet.
3. Spinner appears for ~1s, then: **↻ Cached replay (60s window)** banner.
4. Show server logs: `bba-execute idempotency hit` — no Playwright launch line.
5. Switch to Casa — still only the original one bet.
6. Say: *"The bookmaker never saw a second request. The idempotency cache returned the previous result. This is the retry safety story."*

> If the replay banner is not visible (Phase F+ UI not yet merged): narrate the `X-Idempotent-Replay: true` header from the server log instead. The behavior is correct; the UI indicator is a follow-up.

**3b — Memory + learning** (~60s):

- Open browser DevTools → Network tab → trigger a GET `/recent-runs` → show the response JSON with `selectors_observed`, `popups_seen` counts.
- Or: point at the terminal and describe what `selectors_observed` does — hit/miss counters mean the agent learns which CSS selectors are stable across Casa updates.

**3c — Trace replay** (optional, ~60s if time allows):

```powershell
# On the operator's machine, in a terminal
$runId = 1  # the runId shown in the UI
Invoke-Item "$env:USERPROFILE\.paperclip\bba-memory\traces\$runId.zip"
# Open the zip in Playwright Trace Viewer:
npx playwright show-trace "$env:USERPROFILE\.paperclip\bba-memory\traces\$runId.zip"
```

Show the trace viewer: every click, every network request, every screenshot, timestamped. Say: *"If a bet is ever disputed, we can replay exactly what happened."*

---

## Q&A Prep

### Q: "What if a bet is placed but we never get a confirmation back?"

The run is recorded with `outcome: null` — a partial state. The server can't claim success or failure if the network dropped before it got the bookmaker's response. The operator checks the bookmaker's "My Bets" page directly. Phase F+ adds a partial-result polling loop: the UI re-checks every 5 seconds for up to 60 seconds automatically.

### Q: "Can two operators accidentally place the same bet?"

No — within a 60-second window, the idempotency key (UUID generated per submit in the UI) prevents the server from running a second execution. Outside 60 seconds, a new UUID means a genuinely new bet — which is intentional. Company isolation in the server also ensures company A's keys never collide with company B's.

### Q: "What happens if the bookmaker site changes its HTML?"

The `selectors_observed` table tracks hit/miss counts per selector. A site change causes miss-count spikes, which surface as `SELECTOR_NOT_FOUND` failures in the recent-runs panel. The operator updates the seeded selectors in `repository.ts` → `seedSelectors()` and redeploys. The memory layer makes this visible — without it, failures would be silent.

### Q: "How do we cancel a bet that was wrongly placed?"

The bookmaker determines cancelability — most live-odds bets cannot be cancelled after submission. The BBA system does not have a "reverse bet" capability; that is a bookmaker-level operation. The audit trail (runId, `placedBetId`, trace.zip) gives the operator everything needed to make a dispute call with Casa Pariurilor.

### Q: "What's the rollback story if there's a bug in production?"

The production branch is tagged by date. Rolling back is: `git reset --hard <previous-tag>`, rebuild, restart — target under 5 minutes. The server carries no shared state between requests (SQLite is local, no external DB). If the DB itself is corrupt, the last DB backup (from the T-1d prep step) is the restore point.

---

## Decision Points (mid-demo pivots)

| Situation | What to do |
|---|---|
| **Casa session expired** | Do nothing special — BBA Engine auto-logs in. Narrate: *"Session was expired — watch it log in automatically."* Expect +10–15s on the spinner. |
| **CAPTCHA appears** | Do NOT click anything. Say: *"CAPTCHA detected — the agent stopped itself. This is designed behavior, not a failure. The operator would manually re-authenticate and retry."* Show the `CAPTCHA_VISIBLE` row in Recent Runs. |
| **Network blip / spinner hangs > 60s** | Stay calm. Say: *"Looks like a network timeout — let me show you what the system records."* Wait for partial result row in Recent Runs. Narrate the `outcome: null` partial state. |
| **Audience asks to see code** | Switch to the architecture doc + a terminal. Show `schema.sql` structure and `repository.ts` function signatures — no implementation detail needed, just shape. |
| **Rate limit fires during idempotency demo** | Show the 429 response in server logs. Say: *"Rate limiter — 10 placement attempts per minute. Protects the account. Resets in 60 seconds."* Use the gap to show the stats endpoint. |

---

## Post-Demo

1. **Confirm the bet on Casa**: open My Bets, take a screenshot for the record.
2. **Archive DB backup**:
   ```powershell
   Copy-Item "$env:USERPROFILE\.paperclip\bba-memory\bba-memory.db" `
             "$env:USERPROFILE\.paperclip\bba-memory\bba-memory-demo-$(Get-Date -Format 'yyyyMMdd').db.bak"
   ```
3. **Capture trace**: copy `~/.paperclip/bba-memory/traces/<runId>.zip` to a shared folder.
4. **Document anomalies**: any unexpected behavior → `.claude/incidents/<YYYY-MM-DD>-demo-notes.md`.
5. **Follow-up to CEO/CTO**: send a link to this architecture overview and any Q&A items that needed follow-up.

---

## Escalation Paths

| Situation | Script |
|---|---|
| Critical bug surfaces live | *"We've hit a known issue — let me walk you through the architecture while we recover."* Switch to slides. Restart server in background. |
| Live system going wrong | Kill server (`Ctrl+C`). Say: *"We have a known environment issue. Here's the recovery path — this is exactly what the rollback procedure covers."* Narrate the rollback steps. |
| Question we can't answer | *"Great question — I want to give you an accurate answer, not a guess. Let me follow up. Slack or email?"* Note the question immediately. |
