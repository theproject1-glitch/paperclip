# CTO Config Decisions Applied

Date: 2026-05-13

Source: `docs/cto-config-decisions.md` from PR #54 review package.

## Applied in this branch

- Decision 1: `bettingStopLossService.preflight()` now logs the active daily/session stop-loss thresholds and whether defaults were used.
- Decision 2: Missing bankroll baseline now tells operators how to add the required snapshot before placing bets.
- Decision 8: `waitForOddsReady()` now caps odds readiness waiting at 45s instead of 25s.

## Applied in live Paperclip agent config

- Decision 6: CTO agent `d9bd4d75-fb9f-4221-85fb-ff59b74b5f44` remains on `codex_local` and now has `adapterConfig.maxTurnsPerRun = 40`.
- Decision 9: BBA agent `9a384d99-8770-4f6d-911a-4797c4973b99` remains on `claude_local` and now has `adapterConfig.graceSec = 120`.
- Verification heartbeat: CTO run `8a2d07b2-a4c8-433c-89cc-1132dc4da546` succeeded. It still emitted Codex plugin sync warnings from ChatGPT plugin endpoints returning 403, but no stale `env.OpenAI` binding was present.

## Covered by PR #57

- Decision 3: BBA in-progress retry window changed from 5s to 30s.
- Decision 4: BBA placed-bet idempotency includes company context.
- Decision 5: BBA cookie cache path is company-scoped.

## No Change

- Decision 7: Playwright `slowMo: 0` remains unchanged because the human-simulation layer already controls action timing.
