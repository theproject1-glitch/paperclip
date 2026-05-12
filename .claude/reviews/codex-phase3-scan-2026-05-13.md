# Codex PR Scan — 2026-05-13

**Scope**: All 48 Codex branches on `origin/codex/*`
**Method**: `git diff --stat origin/master...origin/{branch}` filtered for `server/src/services/betting*`, `server/src/routes/betting*`, `packages/db/src/schema`

---

## Skip list (no betting or schema touch — 44 branches)

All `codex/pap-{1614,1668,1895(scripts+tests only),1926(schema excluded),2538,2679(excluded above),2694(excluded above),2695,2946,2980,2981,2679,3135,3658,9063}` and `codex/fix-docker-gh-install` and `codex/pr-report-skill` — skipped.

None touch `server/src/services/betting-*` or `server/src/routes/betting-*`. These are all Paperclip platform changes (agent runtime, UI, sidebar, adapters).

---

## Review: codex/pap-1895-runtime-control-plane

**Schema files changed**: `heartbeat_runs`, `issues`, `routines`

### Changes

**heartbeat_runs**: Adds scheduled retry columns:
```typescript
scheduledRetryAt: timestamp("scheduled_retry_at", { withTimezone: true }),
scheduledRetryAttempt: integer("scheduled_retry_attempt").notNull().default(0),
scheduledRetryReason: text("scheduled_retry_reason"),
```
Enables the heartbeat system to schedule a retry at a specific time rather than immediately retrying. Non-nullable `scheduledRetryAttempt` with default 0 — safe migration.

**routines**: Adds `dispatchFingerprint` column + index `routine_runs_dispatch_fingerprint_idx` on `(routineId, dispatchFingerprint)`. Used for deduplication of routine dispatches.

**issues**: Adds `originFingerprint text NOT NULL DEFAULT 'default'` and includes it in the `issues_open_routine_execution_uq` unique index.

### Flag: unique constraint widened on issues

Before:
```sql
UNIQUE (company_id, origin_kind, origin_id)
WHERE origin_kind = 'routine_execution' AND origin_id IS NOT NULL AND ...
```

After:
```sql
UNIQUE (company_id, origin_kind, origin_id, origin_fingerprint)
WHERE origin_kind = 'routine_execution' AND origin_id IS NOT NULL AND ...
```

The constraint now includes `origin_fingerprint`. With the default `'default'`, existing rows are effectively covered (they all get fingerprint `'default'`, so the old constraint is preserved for them). New code that generates distinct fingerprints can create multiple open issues for the same `(company_id, origin_kind, origin_id)` — intentional, allows routine execution variants.

**BBA impact**: BBA issues created with `originKind = 'routine_execution'` would be affected if fingerprinting is ever applied. Today, BBA creates issues via the CTO, not directly. No immediate impact.

**Verdict**: APPROVE with note. The unique constraint widening is intentional deduplication flexibility. Non-breaking for existing rows due to the default. No betting code touched.

---

## Review: codex/pap-1926-memory-jobs

**Schema files changed**: `memory_extraction_jobs` (new table), `index.ts` (exports it)

### New table: `memory_extraction_jobs`

Large new feature — background job system for extracting memory from issue/heartbeat/goal sources. Key design notes:

- `bindingId`/`bindingKey` pair identifies what the job is extracting memory from
- `leaseExpiresAt` — optimistic locking for distributed dispatch
- `dispatcherKind: "in_process" | ...` — supports multiple dispatcher types
- `retryOfJobId` self-reference — retry chains
- `attemptNumber` + `leaseExpiresAt` — correct pattern for at-least-once job dispatch
- Proper indexes: `(companyId, status, submittedAt)` for polling; `(bindingId, bindingKey, status)` for dedup

### Concerns

**None blocking.** This is additive infrastructure. The `goals` and `projects` references suggest it's tightly integrated with the Paperclip memory system, not the betting system.

One observation: the table has both `providerJobId` (external job system integration) and `dispatcherKind: "in_process"` as default. If a deployment ever switches to an external job queue, migration of `in_process` jobs would need a status sweep. Document this if this PR ships.

**Verdict**: APPROVE. New table is well-structured, additive, no betting code touched, good test coverage (5 test files, 247+191+260+201 lines).

---

## Review: codex/pap-2679-control-plane-qol

**Schema files changed**: `companies` (1 column), `issues` (1 index)

### companies: `attachmentMaxBytes`

```typescript
attachmentMaxBytes: integer("attachment_max_bytes")
  .notNull()
  .default(10 * 1024 * 1024),
```

Adds a per-company cap for file attachments (default 10MB). The `10 * 1024 * 1024` is a TypeScript arithmetic expression that Drizzle evaluates at schema-definition time — the migration will have the integer value `10485760`, not the expression. Safe.

### issues: `activeProductivityReviewIdx`

```sql
UNIQUE (company_id, origin_kind, origin_id)
WHERE origin_kind = 'issue_productivity_review'
  AND origin_id IS NOT NULL
  AND hidden_at IS NULL
  AND status NOT IN ('done', 'cancelled')
```

Prevents duplicate open productivity review issues for the same origin. Pattern is identical to existing `activeStrandedIssueRecoveryIdx`. Safe additive constraint.

**BBA impact**: None. No betting routes or services touched.

**Verdict**: APPROVE.

---

## Review: codex/pap-2694-backend-control-plane-slice

Same schema changes as `pap-2679` (migrations 0073/0074 are identical). This appears to be a subset of `pap-2679` without the adapter build-config removals, PR workflow changes, and some test file additions.

**Risk**: If both branches are open as separate PRs and both include migrations 0073/0074, merging one then the other will fail with a migration conflict. These must be merged as one or the duplicate migration content must be resolved.

**Verdict**: DO NOT MERGE independently if pap-2679 also exists as an open PR — resolve the migration number collision first.

---

## Summary

| Branch | Verdict | Blocker |
|---|---|---|
| `pap-1895-runtime-control-plane` | APPROVE | Note unique constraint widening is intentional |
| `pap-1926-memory-jobs` | APPROVE | Note in-process→external dispatcher migration story |
| `pap-2679-control-plane-qol` | APPROVE | — |
| `pap-2694-backend-control-plane-slice` | HOLD | Migration 0073/0074 collision with pap-2679 — merge one first |
| All other 44 branches | SKIP | No betting or schema touch |

**No betting-specific Codex changes found in any open Codex PR.** The P1/P2 items from the CTO backlog (idempotency key companyId, retryAfterMs, COOKIE_CACHE_PATH) have NOT been submitted by Codex — they remain unimplemented.
