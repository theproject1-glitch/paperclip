# BBA Memory — Operator Demo Dry-Run Script

**Operator**: Costel  
**Audience**: CEO / CTO  
**Duration**: ~10 minutes (happy path) + ~3 minutes Q&A  
**Prerequisite**: Complete [`docs/bba-memory-demo-readiness-checklist.md`](bba-memory-demo-readiness-checklist.md) before running this script.  
**Goal**: Prove the full loop — operator click → real bet placed at casapariurilor.ro → result in recent-runs panel → idempotency guard blocks duplicate on retry.  
**Mode**: Live placement (real money). If anything fails before T+0, fall back to `BBA_DRY_RUN=true` without announcing it.

---

## T-30min — Final Smoke Check

Run in PowerShell. Each command must pass before proceeding.

```powershell
# 1. On the right commit
cd C:\Users\thepr\GitHub\paperclip
git status          # Must be: "On branch master, nothing to commit"
git log --oneline -1  # Must mention Phase F consolidated (idempotency + safeParseMetaJson)

# 2. Dependencies
pnpm install        # Expected: "Already up to date" or lockfile sync with no errors

# 3. Build
pnpm --filter @paperclipai/server build
# Expected: build output ends with no errors, dist/ folder present

pnpm --filter ui build
# Expected: "vite build" completes, dist/ folder present

# 4. Start server (separate terminal — keep it open)
pnpm --filter @paperclipai/server start
# Expected within 5s:
#   bba-memory: schema initialised
#   bba-memory: seed selectors planted (N selectors)
#   Server listening on http://localhost:3000

# 5. Health check
curl http://localhost:3000/health
# Expected: {"status":"ok"}

# 6. Recent runs is clean
$cid = "YOUR_DEMO_COMPANY_ID"
curl "http://localhost:3000/api/companies/$cid/bba-memory/recent-runs"
# Expected: {"runs":[],"total":0,...}
# If total > 0: rm $HOME/.paperclip/bba-memory/bba-memory.db → restart server

# 7. Open UI
Start-Process "http://localhost:5173"
# Expected: BBA Memory Playground loads, Recent Runs panel shows "No runs yet"
# Check DevTools Console: 0 errors
```

**If server fails to start**: check port 3000 free (`netstat -ano | findstr :3000`), check DB permissions (`ls $HOME\.paperclip\bba-memory\`).  
**If UI 404s**: confirm `pnpm --filter ui dev` is running, or serve the built `dist/` via `pnpm --filter ui preview`.

---

## T-5min — Screen Layout

Set up before the audience enters. Do not change this layout during the demo.

| Tab/Window | URL / Content | Purpose |
|---|---|---|
| **Tab 1** (focus tab) | `http://localhost:5173` → BBA Memory → Playground | Operator view — where clicks happen |
| **Tab 2** | `https://www.casapariurilor.ro/pariuri/biletele-mele` (My Bets, logged in) | Show real bet appeared post-placement |
| **Terminal split** | Server log tail (`pnpm --filter @paperclipai/server start` output) | Show Playwright actions + log lines live |

**Zoom level**: set both browser tabs to 90%. Terminal font size 16+.  
**Pre-fill the bet form** (Playground tab): select company, fill bet params. Do NOT click "Place Bet" yet.  
**Confirm Casa tab is logged in** — if session expired, log in now.

---

## T+0 — Operator Click Sequence

> Say: *"I'm going to place a real bet right now — you'll see it appear on the bookmaker's site in under a minute."*

| Clock | Operator action | Expected on screen | Expected in server logs |
|---|---|---|---|
| **T+0** | Click **"Place Bet"** button in Playground (Component 2) | Modal opens: bet summary — match, stake, odds, company name | — |
| **T+3s** | Read the summary aloud: match, stake, odds | Modal still open, audience sees the confirmation friction | — |
| **T+8s** | Type `CONFIRM` in the modal text input | Submit button becomes active (red/enabled) | — |
| **T+12s** | Click **"Place Real Bet"** | Modal closes; button shows spinner + **"Placing bet…"** label | `info: bba-execute started` `requestId=<uuid>` `companyId=<cid>` |
| **T+15s** | Do nothing — narrate | Spinner continues | `info: bba: launching browser` `headless=true` |
| **T+20–30s** | Do nothing — narrate browser actions | Spinner continues | `info: bba: navigate casapariurilor.ro` → `bba: dismiss popup` → `bba: locate bet` → `bba: click submit` |
| **T+30–45s** | Bet completes on bookmaker side | Result panel appears: **✅ Bet placed successfully** — `placedBetId`, stake, odds shown | `info: bba-execute completed` `outcome=completed` `runId=<n>` |
| **T+48s** | Switch to **Tab 2** (Casa — My Bets) | New bet row at top with correct match + stake + odds + timestamp | — |
| **T+55s** | Switch back to **Tab 1** | Recent Runs panel shows new row at top: green **✅ completed**, match name, stake, timestamp | `info: bba-memory: recent-runs query` |

> Say at T+45s: *"Real bet, placed via a headless browser, audited in our journal. Every run has a Playwright trace for replay if we need to debug."*

---

## T+60s — Idempotency Demo (the impressive part)

> Say: *"Now watch what happens if the network drops and the client retries."*

| Clock | Action | Expected |
|---|---|---|
| **T+60s** | Click **"Place Bet"** again — same payload, same company | Modal opens normally |
| **T+65s** | Type `CONFIRM`, click **"Place Real Bet"** | Spinner appears — but only for ~1s |
| **T+66s** | — | Result panel shows **↻ Cached replay (60s window)** banner instead of spinner |
| **T+67s** | Point at server log terminal | Log shows: `info: bba-execute idempotency hit` `key=<uuid>` — **no Playwright launch line** |
| **T+70s** | Switch to **Tab 2** (Casa — My Bets) | Still only **one** bet (from T+30s) — no duplicate |

> Say: *"The server returned the cached response. No browser launched. No second bet. The bookmaker never saw a duplicate request."*

> If replay banner doesn't appear (P1-2 not yet fixed): instead show the server log `X-Idempotent-Replay: true` header line and narrate — the UI display is a follow-up, the server dedup is live.

---

## T+2min — Optional: Failure Handling (if time)

> Say: *"Let me show you what happens when the bookmaker fights back."*

**Rate limit demo:**
1. Open browser DevTools → Network tab.
2. Click "Place Bet" 11 times rapidly (don't type CONFIRM — just open and close the modal 10 times, then submit once).
3. On the 11th attempt, result panel shows **❌ Bet failed. Reason: RATE_LIMITED**.
4. > Say: *"Ten attempts per minute per company. Protects the bookmaker account from appearing robotic."*

**CAPTCHA demo (only if pre-staged):**
1. If you have a pre-recorded run where CAPTCHA appeared, open Recent Runs and click into that row.
2. Show `outcome: failure`, `failureClass: CAPTCHA_VISIBLE`, and the failure screenshot.
3. > Say: *"The agent detected the CAPTCHA, stopped immediately, and logged it. Manual re-auth is the recovery path — the agent doesn't guess."*

---

## Talking Points for CEO / CTO

Keep these ready; use when CEO says "how does this actually work?" or "what if it breaks?":

1. **Multi-agent loop closed**: The betting agent decides to place → UI surfaces the decision → server executes via Playwright in headless Chrome → result lands back in the run journal. One click, one full audit trail.

2. **Memory layer**: Every run is journaled in SQLite with selectors observed, popups seen, and failures logged. Hit/miss counters for selectors mean the agent learns which DOM paths are stable — reduces CAPTCHA triggers over time.

3. **Safety stack, inside out**: typed `CONFIRM` modal (mis-click impossible) → 60s idempotency window (double-bet impossible within window) → per-company rate limiter (runaway automation impossible) → CAPTCHA detection (bot ban impossible — agent halts and alerts).

4. **Auditability**: each run has a `runId`, Playwright `trace.zip` (replayable in Playwright Trace Viewer), and a final screenshot. If something is disputed, replay the trace to the second.

5. **Zero duplication on retry**: the `Idempotency-Key` UUID travels from browser to server to bookmaker. If the network drops and the client retries, the server returns the cached response — the bookmaker never sees the request again.

---

## Failure Recovery Paths

### F-1: Server won't start

**Symptom**: `pnpm --filter @paperclipai/server start` exits immediately or hangs.  
**Check**: port conflict (`netstat -ano | findstr :3000` — kill the PID if occupied); DB permissions (`ls $HOME\.paperclip\bba-memory\` — confirm operator has write access); check `bba-memory.db` not locked by another process.  
**Say**: *"Quick environment issue — 30 seconds."* (Don't narrate the fix aloud.)

### F-2: UI 500 on /execute

**Symptom**: Result panel shows red error, server log shows `unhandledRejection` or `SQLITE_ERROR`.  
**Check**: `$HOME\.paperclip\bba-memory\bba-memory.db` exists and is writable; Casa session is alive (check Tab 2); server log for the specific error class.  
**Fallback**: Switch to `BBA_DRY_RUN=true` mode, re-run. Say: *"We're in dry-run mode to protect the account — the flow is identical, the final submit click is skipped."*

### F-3: Bet placement hangs (spinner > 60s)

**Symptom**: Result panel spinner never resolves; no `bba-execute completed` log line.  
**Check**: Playwright Chrome process running? (`Get-Process -Name chrome | Where-Object {$_.MainWindowTitle -eq ""}`).  
**Kill**: `Get-Process -Name chrome | Stop-Process -Force` — then refresh UI.  
**Recover**: server auto-times out after 120s; the partial run appears in recent-runs with `outcome: null`. Show that row — say: *"The system knows it doesn't know. The run is recorded as partial — the operator checks the bookmaker's bet history to confirm whether it landed."*

### F-4: CAPTCHA appears every run

**Symptom**: every execution ends with `CAPTCHA_VISIBLE` failure.  
**Cause**: IP flagged; no pre-authed Chromium profile; account under review.  
**Fallback**: switch to visible browser mode (`execution.headless: false`), solve CAPTCHA manually once, then re-run headless. Say: *"CAPTCHA is active right now — in production this triggers a Telegram alert to the operator. Let me clear it and continue."*

### F-5: Recent Runs panel empty after successful execution

**Symptom**: result panel showed ✅ but recent-runs still shows "No runs yet".  
**Check**:
```powershell
# Direct DB query
sqlite3 $HOME\.paperclip\bba-memory\bba-memory.db "SELECT id, status, outcome FROM runs ORDER BY id DESC LIMIT 5;"
```
If rows exist, the UI polling missed the update — hard-reload Tab 1.  
If no rows, the `INSERT` into `runs` failed — check server log for `SQLITE_CONSTRAINT` near the execute call.

---

## Rollback Procedure (if demo bombs publicly)

1. Say: *"We've hit a known environment issue — let me show you the architecture while we recover."* Switch to slides or a terminal walkthrough of the DB schema.
2. Kill server. Run: `git checkout master~1 && pnpm install && pnpm --filter @paperclipai/server build && pnpm --filter @paperclipai/server start`
3. Confirm rollback health: `curl http://localhost:3000/health` → `{"status":"ok"}`
4. Log the incident: create `.claude/incidents/<YYYY-MM-DD>-demo-failure.md` with symptoms + timestamp.
5. Resume demo or reschedule — never extend past 15min past planned end time.

---

## Post-Demo Cleanup

| Step | Command / Action |
|---|---|
| Confirm real bet on Casa | Open Tab 2 → My Bets → verify stake, match, time |
| Archive the DB | `Copy-Item $HOME\.paperclip\bba-memory\bba-memory.db $HOME\.paperclip\bba-memory\bba-memory-demo-$(Get-Date -Format 'yyyyMMdd').db.bak` |
| Capture Playwright trace | `ls $HOME\.paperclip\bba-memory\traces\` → copy `<runId>.zip` to demo archive folder |
| Document anomalies | Add a note to `.claude/incidents/<date>-demo-notes.md` — anything unexpected |
| Wipe DB for next run | `Remove-Item $HOME\.paperclip\bba-memory\bba-memory.db` → restart server confirms clean seed |
| Debrief with Codex team | File any follow-up bugs as GitHub issues; reference `runId` from the DB |
