# BBA Memory In-Fork Self-Merge Status

Generated: 2026-05-10

This snapshot covers the 12 open in-fork PRs on
`theproject1-glitch/paperclip` after the BBA PRs were moved out of the
cross-fork upstream workflow.

## Summary

- Ready for merge: 0 / 12
- CI missing / manual verification needed: 12 / 12
- Conflicts detected: 0 / 12
- Blocked by failing CI: 0 / 12

All 12 PRs are reported by GitHub as `MERGEABLE` with `CLEAN` merge state.
No PR currently has status checks attached in the fork, so none should be
treated as automatically merge-ready until manual verification or fork CI is
enabled.

## Readiness Table

| PR | Title | Branch | CI | Mergeable | Recommended action |
| --- | --- | --- | --- | --- | --- |
| #2 | Phase A - schema, seeds, repository | `feat/bba-memory-phase-a` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |
| #12 | Phase B-E - service + routes + keepalive + instrumentation | `feat/bba-memory-phase-d-2-e2e-route` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |
| #3 | Component 1 - recent-runs panel | `feat/bba-memory-ui-component-1` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |
| #4 | Component 2 - execute bet panel | `feat/bba-memory-ui-component-2` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |
| #5 | Operator Playground - C1+C2+presets | `feat/bba-memory-ui-operator-playground` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |
| #6 | Test infra - testing-library + 43 tests | `feat/bba-memory-ui-tests-infra` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |
| #7 | Phase F - idempotency + safeParseMetaJson + UI hardening | `feat/bba-memory-phase-f-hardening` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |
| #8 | Phase F+ UI - auto-retry + replay banner | `feat/bba-memory-phase-f-ui-plus` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |
| #1 | Phase F+ backend - rate limit + metrics + admin DELETE + contract tests | `feat/bba-memory-phase-f-backend-plus` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |
| #9 | Phase F+ Closure docs | `docs/bba-memory-phase-f-closure` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |
| #10 | Codex Phase F+ Backend review | `docs/review-codex-phase-f-backend` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |
| #11 | Maintainer handoff doc | `docs/maintainer-handoff` | none | MERGEABLE / CLEAN | ⚠️ CI missing - manual verification |

## Recommended Self-Merge Order

1. #2 - Phase A schema, seeds, repository.
2. #12 - Phase B-E service, routes, keepalive, instrumentation.
3. #3 - Component 1 recent-runs panel.
4. #4 - Component 2 execute bet panel.
5. #5 - Operator Playground.
6. #6 - UI test infrastructure and backfill.
7. #7 - Phase F hardening.
8. #8 - Phase F+ UI follow-ups.
9. #1 - Phase F+ backend extensions.
10. #9 - Phase F+ closure docs.
11. #10 - Codex Phase F+ backend review.
12. #11 - Maintainer handoff doc.

## Manual Verification Notes

Because no fork CI checks are attached to these PRs, use the prior upstream CI
results as historical context only. Before merging code-bearing PRs, run the
smallest relevant local or fork CI checks for that layer:

- Server/backend PRs: server Vitest suites touching BBA memory and betting
  browser automation.
- UI PRs: UI Vitest suites for BBA memory components plus any affected API
  client tests.
- Docs-only PRs: markdown review for links, branch references, and workflow
  accuracy.

Docs-only PRs (#9, #10, #11) are low risk but still marked CI-missing because
GitHub reports no attached checks.
