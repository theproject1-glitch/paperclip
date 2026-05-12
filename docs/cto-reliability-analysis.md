# CTO Reliability Analysis

Date: 2026-05-12
Company: Betting AI System (`b94fed82-38bf-4eb3-81d8-9b1a8aa84921`)
CTO agent: `d9bd4d75-fb9f-4221-85fb-ff59b74b5f44`

Raw sampled run metadata is in `docs/cto-runs-forensics.json`.

## Current Configuration

API route used:

```text
GET /api/agents/d9bd4d75-fb9f-4221-85fb-ff59b74b5f44
```

Observed configuration:

- Adapter: `codex_local`
- Command: `C:\Users\thepr\AppData\Roaming\npm\codex.cmd`
- Model: `gpt-5.4`
- Heartbeat enabled: yes
- Max concurrent runs: 1
- Instructions bundle: managed `AGENTS.md`
- Current status during investigation: `running`

The current adapter no longer includes `env.OpenAI`, so the old "Secret is not
bound at env.OpenAI" failure is stale history, not the active configuration.

## Last 20 Runs: Pattern Summary

Endpoint used:

```text
GET /api/companies/b94fed82-38bf-4eb3-81d8-9b1a8aa84921/heartbeat-runs?agentId=d9bd4d75-fb9f-4221-85fb-ff59b74b5f44&limit=20
```

Result groups:

| Class | Count | Meaning |
|---|---:|---|
| `succeeded` | 11 | Runs completed and usually produced issue comments or activity. |
| `failed, adapter_failed` | 6 | Four stale secret-binding failures plus two context-compaction failures. |
| `failed, process_lost` | 2 | Codex child process disappeared or handle was lost. |
| `running` | 1 | Current live heartbeat. |

## Recurring Incorrect or Misleading Error Patterns

### 1. Stale secret binding errors

Verbatim run error:

```text
Secret is not bound to agent:d9bd4d75-fb9f-4221-85fb-ff59b74b5f44 at env.OpenAI
```

Classification: actual historical environment mismatch, now stale.

Evidence: current CTO `adapterConfig.env` contains API sports/search keys but no
`OpenAI` binding. Current local Codex auth is subscription-backed:
successful runs report `billingType: subscription_included`.

Recommendation: keep `codex_local`; do not re-add an `OpenAI` secret for local
CLI execution.

### 2. Context compaction failures

Verbatim run error:

```text
Your input exceeds the context window of this model. Please adjust your input and try again.
```

Classification: runtime context-management failure, not CTO reasoning failure.

This happened while Paperclip/Codex tried a remote compact task. The agent's
instruction text is also duplicated in the current agent record, which increases
token pressure before the run even starts.

Recommendation: clean the duplicated CTO capability/instruction text in a
separate config-only pass and lower the session compaction threshold or force
fresh sessions for recurring CTO maintenance tasks.

### 3. Process handle loss

Verbatim run errors:

```text
Process lost -- child pid 51960 is no longer running; retrying once
```

```text
Lost in-memory process handle, but child pid 47148 is still alive
```

Classification: local process supervision instability.

These failures are consistent with dev-server restarts, process reaping, or
adapter process tracking gaps. They are not evidence that CTO hallucinated a
technical conclusion.

Recommendation: keep `codex_local` but treat process-loss runs as infrastructure
noise. The server should avoid unnecessary restarts during active runs.

### 4. Harmless Codex plugin-sync warnings look like hard failures

Verbatim log excerpts from a successful run:

```text
failed to warm featured plugin ids cache error=remote plugin sync request to https://chatgpt.com/backend-api/plugins/featured failed with status 403 Forbidden
```

```text
startup remote plugin sync failed; will retry on next app-server start
```

Classification: noisy non-blocking runtime warning.

These warnings appear in run logs before successful work. A human or downstream
watchdog can misread them as the cause of the run even when the run proceeds.

Recommendation: filter or group plugin-sync warnings in run summaries; they are
not Betting AI System blockers.

### 5. Recurring-task state churn

Representative CTO summary:

```text
`BET-223` ramane singurul item din inbox CTO, cu `status: blocked` si `dependencyReady: false`.
```

Representative follow-up:

```text
pattern-ul de churn este asteptat dupa `successful_run_missing_state` + loops de recuperare.
```

Classification: mixed. Some CTO claims are factually grounded in live API
metadata, but the recurring maintenance issues create repeated "blocked /
standby / recovered" conclusions that can look like false errors to the
operator.

Recommendation: keep CTO on `codex_local`, but reduce recurring maintenance
issue churn. Park recurring CTO meta-issues in `backlog` between scheduled
windows rather than leaving them `in_progress` or `blocked`.

## Adapter Recommendation

Keep CTO on `codex_local` for now.

Reasons:

- Current successful CTO runs are using subscription-backed local Codex.
- The strongest failures are runtime/config issues, not clear evidence that
  Claude local would reason better for CTO.
- Switching CTO to `claude_local` during this code change would introduce
  another moving part while BBA/Casa execution is being stabilized.

Recommended follow-up:

1. Deduplicate the CTO capability/instruction text.
2. Keep `maxConcurrentRuns = 1`.
3. Prefer fresh sessions for recurring maintenance tasks that have accumulated
   very large history.
4. Add a run-summary filter for non-fatal Codex plugin-sync warnings.

## A/B Test Status

No live adapter switch was performed in this PR.

Reason: the live CTO had a running heartbeat during this investigation, and
switching adapters mid-run would risk creating another source of process loss.
The evidence available from the last 20 runs was enough to recommend keeping
`codex_local` and addressing config/runtime noise first.
