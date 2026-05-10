# BBA Memory — Deployment Guide

**Audience**: Costel (operator) and any engineer deploying the BBA Memory subsystem.  
**Scope**: Local dev setup, demo deployment, production branch tagging, and rollback.  
For the full self-merge sequence see [`docs/bba-memory-merge-runbook.md`](bba-memory-merge-runbook.md).  
For demo-day smoke checks see [`docs/bba-memory-demo-readiness-checklist.md`](bba-memory-demo-readiness-checklist.md).

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 24+ (or 22.5+ with `--experimental-sqlite`) | `node:sqlite` used by BBA Memory — Node 22 needs the flag |
| pnpm | 8+ | Workspace manager; install via `npm i -g pnpm@latest` |
| PowerShell | 7+ (pwsh) | Scripts use `$env:`, `Get-Date`, `Test-Path` |
| Chromium | Latest stable | Playwright downloads it automatically on first `pnpm install` |
| Casa Pariurilor account | Valid login | Test account with pre-funded balance; do NOT use production accounts for rehearsals |

Verify Node version before anything else:

```powershell
node --version   # must be v24.x.x or v22.5+ with --experimental-sqlite
```

---

## First-Time Setup

```powershell
git clone https://github.com/theproject1-glitch/paperclip.git
cd paperclip
pnpm install
# Playwright browsers download automatically during postinstall
```

### Environment Variables

Create `server/.env` (copy from `server/.env.example` if it exists):

```env
# BBA Memory storage directory (default: ~/.paperclip/bba-memory)
BBA_MEMORY_DIR=

# Server port (default: 3000)
PORT=3000

# Bookmaker credentials — reference the Paperclip secrets by ID, not the raw values
CASA_LOGIN_USERNAME_SECRET_ID=bba-demo-username
CASA_LOGIN_PASSWORD_SECRET_ID=bba-demo-password

# Runtime mode
NODE_ENV=development
```

> **Never put raw credentials in `.env`.** The server resolves `*_SECRET_ID` values at runtime via the Paperclip secrets store. Seed the secrets via the admin API or UI before the first run.

### Database Initialization

The BBA Memory SQLite database initializes automatically on the first server start:

- **Schema**: `server/src/services/bba-memory/schema.sql` — creates all tables and indexes
- **Seeds**: `seedSelectors(db)` in `repository.ts` — plants 30+ selector entries for Casa Pariurilor DOM paths
- **Location**: `$BBA_MEMORY_DIR/bba-memory.db` (default `~/.paperclip/bba-memory/bba-memory.db`)

You should see these lines in the server log on first start:

```
bba-memory: schema initialised
bba-memory: seed selectors planted (N selectors)
```

If you see `SQLITE_CANTOPEN` errors: check that `$BBA_MEMORY_DIR` is writable and the parent directory exists.

---

## Build Commands

```powershell
# Server (TypeScript → dist/)
pnpm --filter @paperclipai/server build
# Output: server/dist/  — compiled JS, ready to run with `node dist/index.js`

# UI (Vite → dist/)
pnpm --filter ui build
# Output: ui/dist/  — static HTML + JS bundles + CSS

# Build both in sequence
pnpm --filter @paperclipai/server build && pnpm --filter ui build
```

Build verification:

```powershell
Test-Path server/dist/index.js   # True
Test-Path ui/dist/index.html     # True
```

If either returns `False`, the build failed silently — re-run with `--verbose` to see TypeScript errors.

---

## Running for Demo

### Dev Mode (recommended for demo — hot reload, cleaner logs)

Open two PowerShell terminals side by side:

```powershell
# Terminal 1 — server (port 3000)
cd C:\Users\thepr\GitHub\paperclip
$env:CI = $null    # ensure CI mode is off
pnpm --filter @paperclipai/server dev

# Terminal 2 — UI (port 5173)
cd C:\Users\thepr\GitHub\paperclip
pnpm --filter ui dev
```

Browser access:
- **UI**: `http://localhost:5173`
- **Server API**: `http://localhost:3000`
- **Health**: `http://localhost:3000/health`

### Production Mode (pre-built, no hot reload)

```powershell
# Serve the server from compiled dist
pnpm --filter @paperclipai/server start
# UI: serve ui/dist/ via the server's static middleware, or a reverse proxy (nginx)
```

---

## Smoke Test Checklist

Run these after any start, before the demo audience arrives:

```powershell
# 1. Server healthy
Invoke-RestMethod http://localhost:3000/health
# Expected: { status = "ok" }

# 2. UI loads (manual) — open http://localhost:5173 in browser
# Expected: BBA Memory Playground visible, DevTools Console shows 0 errors

# 3. DB file exists and is not empty
$db = "$env:USERPROFILE\.paperclip\bba-memory\bba-memory.db"
Test-Path $db      # True
(Get-Item $db).Length -gt 0   # True

# 4. Seeds are present
# (requires sqlite3 CLI — install via: winget install SQLite.SQLite)
sqlite3 $db "SELECT COUNT(*) FROM selectors_observed WHERE is_seed = 1;"
# Expected: > 30

# 5. Recent-runs is clean for demo
$cid = "YOUR_DEMO_COMPANY_ID"
Invoke-RestMethod "http://localhost:3000/api/companies/$cid/bba-memory/recent-runs"
# Expected: runs = [], total = 0
# If total > 0: Remove-Item $db && restart server to get a clean slate
```

---

## Production Branch Tag Procedure

The fork uses a two-branch model:

| Branch | Purpose |
|---|---|
| `master` | Integration — active development, all PRs target here |
| `production` | Stable releases — only fast-forward merges from master |

**Promote master → production and tag:**

```powershell
# 1. Ensure master is at the commit you want to promote
git checkout master
git log --oneline -5   # confirm latest commit is Phase F consolidated

# 2. Fast-forward production to master
git checkout production
git merge master --ff-only
# If "fatal: Not possible to fast-forward": production has diverged — see Rollback below

# 3. Tag the release
$tag = "v$(Get-Date -Format 'yyyy.MM.dd')"
git tag -a $tag -m "Demo-ready BBA Memory — Phase F consolidated"

# 4. Push branch and tag
git push origin production $tag

# 5. Verify tag is on GitHub
& "C:\Program Files\GitHub CLI\gh.exe" release view $tag --repo theproject1-glitch/paperclip
```

### Rollback

If the production tag has a critical bug, roll back to the previous tag:

```powershell
# Find the previous stable tag
git tag --sort=-creatordate | Select-Object -First 5

# Roll production back to that tag
$previous = "v2026.05.10"   # substitute the actual previous tag
git checkout production
git reset --hard $previous
git push origin production --force-with-lease
# Note: --force-with-lease protects against overwriting commits you haven't seen

# Rebuild and restart from the rolled-back code
pnpm install
pnpm --filter @paperclipai/server build
pnpm --filter @paperclipai/server start
```

Total rollback time target: **< 5 minutes** from decision to running server. Rehearse this once before the demo (see [`docs/bba-memory-demo-readiness-checklist.md`](bba-memory-demo-readiness-checklist.md) T-1d section).

---

## Deploy Targets

| Target | Status | Notes |
|---|---|---|
| **Local (demo laptop)** | ✅ Primary | Run from `theproject1-glitch/paperclip` clone; all dependencies local |
| **Docker container** | 🔜 Planned | Dockerfile will bake Node 24 + pnpm + Playwright Chromium |
| **Cloud VM** | 🔜 Planned | Single-instance; rate limiter is per-process, not distributed |

**Phase F SQLite requirement**: BBA Memory requires a **persistent** file-system path for `bba-memory.db`. In container or cloud deployments, mount a volume at `$BBA_MEMORY_DIR` — do not use ephemeral container storage, or all run history and selector learning is lost on container restart.
