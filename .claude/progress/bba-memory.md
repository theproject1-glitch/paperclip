## Phase F+ Backend

- Branch: `feat/bba-memory-phase-f-backend-plus`
- Stacked on: PR #5636 (`feat/bba-memory-phase-f-hardening`)
- Draft PR: https://github.com/theproject1-glitch/paperclip/pull/1
- Commits:
  - `97fa3223` chore: gitignore Claude Code session artifacts and run logs
  - `3571cf14` feat(server): per-company rate limiter for /execute
  - `f835a935` feat(server): idempotency replay counter + admin DELETE + metrics
  - `ec2aefd9` test(server): contract tests for bba-memory + execute (18 tests)
- Tests:
  - `pnpm --filter server exec vitest run src/routes/__tests__/bba-memory.contract.test.ts src/routes/__tests__/betting-browser-automation.contract.test.ts --reporter=verbose`
  - Result: 18 passed
- Notes:
  - `pnpm --filter server test` exits 0 in this workspace but emits no test count because the server package has no test script.
