import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, agentRuntimeState, bettingBankrollSnapshots, heartbeatRuns, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

export interface WatchdogHealthItem {
  check: string;
  status: "ok" | "warn" | "error";
  detail: string;
}

export interface WatchdogHealthSnapshot {
  items: WatchdogHealthItem[];
  generatedAt: Date;
}

const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const STUCK_RUN_THRESHOLD_MS = 20 * 60 * 1000; // 20 min
const COST_SPIKE_MULTIPLIER = 2.5;
const COST_SPIKE_LOOKBACK_DAYS = 7;
// Alert cooldown: same alert key won't fire again within this window
const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

let watchdogTimer: ReturnType<typeof setInterval> | null = null;
// Dedup map: alertKey → last fired timestamp
const alertCooldowns = new Map<string, number>();

function emitWatchdogAlert(text: string, alertKey?: string, context?: Record<string, unknown>): void {
  if (alertKey) {
    const last = alertCooldowns.get(alertKey) ?? 0;
    if (Date.now() - last < ALERT_COOLDOWN_MS) return;
    alertCooldowns.set(alertKey, Date.now());
  }
  logger.warn({ ...context, alertKey, text }, "watchdog alert");
}

function readCostUsd(json: Record<string, unknown> | null | undefined): number {
  if (!json) return 0;
  for (const key of ["total_cost_usd", "costUsd", "cost_usd"] as const) {
    const v = json[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

async function checkConsecutiveFailures(db: Db): Promise<void> {
  const activeAgents = await db
    .select({ id: agents.id, name: agents.name, role: agents.role, status: agents.status })
    .from(agents)
    .where(inArray(agents.status, ["idle", "running", "error"]));

  for (const agent of activeAgents) {
    const recentRuns = await db
      .select({ status: heartbeatRuns.status, createdAt: heartbeatRuns.createdAt })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agent.id))
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(CONSECUTIVE_FAILURE_THRESHOLD);

    if (recentRuns.length < CONSECUTIVE_FAILURE_THRESHOLD) continue;
    const allFailed = recentRuns.every((r) => r.status === "failed");
    if (!allFailed) continue;

    const label = agent.name ?? agent.role ?? agent.id.slice(0, 8);
    logger.warn({ agentId: agent.id, role: agent.role }, "watchdog: consecutive failures detected — auto-pausing");

    // Auto-pause
    await db
      .update(agents)
      .set({
        status: "paused",
        pauseReason: `watchdog: ${CONSECUTIVE_FAILURE_THRESHOLD} consecutive failures`,
        pausedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, agent.id), inArray(agents.status, ["idle", "running", "error"])));

    emitWatchdogAlert(
      `⚠️ <b>Watchdog: ${label}</b>\n` +
      `${CONSECUTIVE_FAILURE_THRESHOLD} consecutive failures — agent auto-paused.\n` +
      `Check runs tab and resume manually after fixing.`,
      `consecutive_failures:${agent.id}`,
      { agentId: agent.id, role: agent.role },
    );
  }
}

async function checkStuckRuns(db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_RUN_THRESHOLD_MS);
  const stuckRuns = await db
    .select({
      id: heartbeatRuns.id,
      agentId: heartbeatRuns.agentId,
      createdAt: heartbeatRuns.createdAt,
    })
    .from(heartbeatRuns)
    .where(
      and(
        inArray(heartbeatRuns.status, ["running", "queued"]),
        lt(heartbeatRuns.createdAt, cutoff),
      ),
    );

  for (const run of stuckRuns) {
    logger.warn({ runId: run.id, agentId: run.agentId }, "watchdog: stuck run detected — marking failed");

    await db
      .update(heartbeatRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: "watchdog: run exceeded 20-minute wall-clock limit",
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, run.id));

    // Group stuck-run alerts per agent (not per run) to avoid flooding
    emitWatchdogAlert(
      `🔴 <b>Watchdog: stuck run cancelled</b>\n` +
      `Run <code>${run.id.slice(0, 8)}</code> was running for >20 min — force-failed.`,
      `stuck_run_agent:${run.agentId}`,
      { runId: run.id, agentId: run.agentId },
    );
  }
}

async function checkCostSpike(db: Db): Promise<void> {
  const activeAgents = await db
    .select({ id: agents.id, name: agents.name, role: agents.role })
    .from(agents)
    .where(inArray(agents.status, ["idle", "running", "error", "paused"]));

  const lookbackCutoff = new Date(Date.now() - COST_SPIKE_LOOKBACK_DAYS * 24 * 3600 * 1000);

  for (const agent of activeAgents) {
    // Get last run
    const [latestRun] = await db
      .select({ resultJson: heartbeatRuns.resultJson, usageJson: heartbeatRuns.usageJson })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agent.id), eq(heartbeatRuns.status, "succeeded")))
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(1);

    if (!latestRun) continue;

    const latestCost =
      readCostUsd(latestRun.resultJson as Record<string, unknown> | null) ||
      readCostUsd(latestRun.usageJson as Record<string, unknown> | null);
    if (latestCost <= 0) continue;

    // Get 7-day average (exclude the latest run)
    const historicRuns = await db
      .select({ resultJson: heartbeatRuns.resultJson, usageJson: heartbeatRuns.usageJson })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.agentId, agent.id),
          eq(heartbeatRuns.status, "succeeded"),
          gt(heartbeatRuns.createdAt, lookbackCutoff),
        ),
      )
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(50);

    if (historicRuns.length < 5) continue; // not enough history

    const costs = historicRuns
      .map((r) =>
        readCostUsd(r.resultJson as Record<string, unknown> | null) ||
        readCostUsd(r.usageJson as Record<string, unknown> | null),
      )
      .filter((c) => c > 0);

    if (costs.length < 5) continue;
    const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
    if (avg <= 0) continue;

    if (latestCost > avg * COST_SPIKE_MULTIPLIER) {
      const label = agent.name ?? agent.role ?? agent.id.slice(0, 8);
      logger.warn(
        { agentId: agent.id, latestCost, avg: avg.toFixed(4) },
        "watchdog: cost spike detected",
      );
      emitWatchdogAlert(
        `💸 <b>Watchdog: cost spike — ${label}</b>\n` +
        `Latest run: $${latestCost.toFixed(3)}  |  7-day avg: $${avg.toFixed(3)}\n` +
        `${COST_SPIKE_MULTIPLIER}x threshold exceeded.`,
        `cost_spike:${agent.id}`,
        { agentId: agent.id, latestCost, avg },
      );
    }
  }
}

async function checkQwenHealth(db: Db): Promise<void> {
  const ceoCtoPairs = await db
    .select({ id: agents.id, name: agents.name, role: agents.role, runtimeConfig: agents.runtimeConfig })
    .from(agents)
    .where(inArray(agents.role, ["ceo", "analyst"]));

  for (const agent of ceoCtoPairs) {
    const state = await db
      .select({ stateJson: agentRuntimeState.stateJson, updatedAt: agentRuntimeState.updatedAt })
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, agent.id))
      .then((rows) => rows[0] ?? null);

    if (!state?.stateJson) continue;
    const st = state.stateJson as Record<string, unknown>;
    const artifact = st.qwenArtifact as Record<string, unknown> | undefined;
    if (!artifact?.generated_at) continue;

    const ageMs = Date.now() - new Date(String(artifact.generated_at)).getTime();
    // CEO: 24h; CTO: 6h; analyst: 2h (runs every ~30min, brief must be fresh for value bets)
    const maxAgeMs =
      agent.role === "ceo" ? 24 * 3600 * 1000 :
      agent.role === "analyst" ? 2 * 3600 * 1000 :
      6 * 3600 * 1000;

    if (ageMs > maxAgeMs) {
      // Only alert if agent has open work — no point in alerting when idle
      const openIssueCount = await db
        .select({ id: issues.id })
        .from(issues)
        .where(
          and(
            eq(issues.assigneeAgentId, agent.id),
            inArray(issues.status, ["todo", "in_progress", "in_review", "blocked"]),
          ),
        )
        .then((rows) => rows.length);

      if (openIssueCount === 0) continue;

      const label = agent.name ?? agent.role ?? agent.id.slice(0, 8);
      const ageHours = Math.round(ageMs / 3600000);
      const alertKey = `qwen_stale:${agent.id}`;

      logger.warn({ agentId: agent.id, role: agent.role, ageHours }, "watchdog: qwen artifact stale");
      emitWatchdogAlert(
        `🤖 <b>Watchdog: qwen stale — ${label}</b>\n` +
        `Artifact is ${ageHours}h old. Ollama may be down or preprocessing failing.`,
        alertKey,
        { agentId: agent.id, role: agent.role, ageHours },
      );
    }
  }
}

async function checkBankrollDrawdown(db: Db): Promise<void> {
  const snapshots = await db
    .select({ companyId: bettingBankrollSnapshots.companyId, balance: bettingBankrollSnapshots.balance, snapshotAt: bettingBankrollSnapshots.snapshotAt })
    .from(bettingBankrollSnapshots)
    .orderBy(desc(bettingBankrollSnapshots.snapshotAt))
    .limit(50);

  const byCompany = new Map<string, number[]>();
  for (const s of snapshots) {
    const arr = byCompany.get(s.companyId) ?? [];
    arr.push(s.balance);
    byCompany.set(s.companyId, arr);
  }

  for (const [companyId, balances] of byCompany) {
    if (balances.length < 2) continue;
    const peak = Math.max(...balances);
    const current = balances[0]!;
    const drawdown = peak > 0 ? (peak - current) / peak : 0;
    if (drawdown >= 0.20) {
      emitWatchdogAlert(
        `📉 <b>Watchdog: bankroll drawdown</b>\n` +
        `Peak: ${peak.toFixed(0)} RON → Current: ${current.toFixed(0)} RON\n` +
        `Drawdown: ${(drawdown * 100).toFixed(1)}% — review betting strategy.`,
        `bankroll_drawdown:${companyId}`,
        { companyId, peak, current, drawdown },
      );
    }
  }
}

export async function getWatchdogHealthSnapshot(db: Db): Promise<WatchdogHealthSnapshot> {
  const items: WatchdogHealthItem[] = [];

  // Stuck runs
  const cutoff = new Date(Date.now() - STUCK_RUN_THRESHOLD_MS);
  const stuckCount = await db
    .select({ id: heartbeatRuns.id })
    .from(heartbeatRuns)
    .where(and(inArray(heartbeatRuns.status, ["running", "queued"]), lt(heartbeatRuns.createdAt, cutoff)))
    .then((r) => r.length);
  items.push(
    stuckCount === 0
      ? { check: "Stuck runs", status: "ok", detail: "No stuck runs" }
      : { check: "Stuck runs", status: "error", detail: `${stuckCount} run(s) stuck >20 min` },
  );

  // Consecutive failures
  const activeAgents = await db
    .select({ id: agents.id, name: agents.name, role: agents.role, status: agents.status })
    .from(agents)
    .where(inArray(agents.status, ["idle", "running", "error", "paused"]));

  const failingAgents: string[] = [];
  for (const agent of activeAgents) {
    const recentRuns = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agent.id))
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(CONSECUTIVE_FAILURE_THRESHOLD);
    if (recentRuns.length >= CONSECUTIVE_FAILURE_THRESHOLD && recentRuns.every((r) => r.status === "failed")) {
      failingAgents.push(agent.name ?? agent.role ?? agent.id.slice(0, 8));
    }
  }
  items.push(
    failingAgents.length === 0
      ? { check: "Consecutive failures", status: "ok", detail: "All agents OK" }
      : { check: "Consecutive failures", status: "error", detail: `Failing: ${failingAgents.join(", ")}` },
  );

  // Cost spike
  const lookbackCutoff = new Date(Date.now() - COST_SPIKE_LOOKBACK_DAYS * 24 * 3600 * 1000);
  const spikeAgents: string[] = [];
  for (const agent of activeAgents) {
    const [latestRun] = await db
      .select({ resultJson: heartbeatRuns.resultJson, usageJson: heartbeatRuns.usageJson })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agent.id), eq(heartbeatRuns.status, "succeeded")))
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(1);
    if (!latestRun) continue;
    const latestCost =
      readCostUsd(latestRun.resultJson as Record<string, unknown> | null) ||
      readCostUsd(latestRun.usageJson as Record<string, unknown> | null);
    if (latestCost <= 0) continue;
    const historicRuns = await db
      .select({ resultJson: heartbeatRuns.resultJson, usageJson: heartbeatRuns.usageJson })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agent.id), eq(heartbeatRuns.status, "succeeded"), gt(heartbeatRuns.createdAt, lookbackCutoff)))
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(50);
    const costs = historicRuns
      .map((r) => readCostUsd(r.resultJson as Record<string, unknown> | null) || readCostUsd(r.usageJson as Record<string, unknown> | null))
      .filter((c) => c > 0);
    if (costs.length < 5) continue;
    const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
    if (avg > 0 && latestCost > avg * COST_SPIKE_MULTIPLIER) {
      const label = agent.name ?? agent.role ?? agent.id.slice(0, 8);
      spikeAgents.push(`${label}: +${Math.round((latestCost / avg - 1) * 100)}%`);
    }
  }
  items.push(
    spikeAgents.length === 0
      ? { check: "Cost spike", status: "ok", detail: "No spike detected" }
      : { check: "Cost spike", status: "warn", detail: spikeAgents.join(", ") },
  );

  // Bankroll drawdown
  const snapshots = await db
    .select({ companyId: bettingBankrollSnapshots.companyId, balance: bettingBankrollSnapshots.balance })
    .from(bettingBankrollSnapshots)
    .orderBy(desc(bettingBankrollSnapshots.snapshotAt))
    .limit(50);
  const byCompany = new Map<string, number[]>();
  for (const s of snapshots) {
    const arr = byCompany.get(s.companyId) ?? [];
    arr.push(s.balance);
    byCompany.set(s.companyId, arr);
  }
  let bankrollDetail = "No data";
  let bankrollStatus: "ok" | "warn" | "error" = "ok";
  for (const [, balances] of byCompany) {
    if (balances.length < 2) continue;
    const peak = Math.max(...balances);
    const current = balances[0]!;
    const drawdown = peak > 0 ? (peak - current) / peak : 0;
    bankrollDetail = `${(drawdown * 100).toFixed(1)}% drawdown · ${current.toFixed(0)} RON`;
    bankrollStatus = drawdown >= 0.20 ? "error" : drawdown >= 0.10 ? "warn" : "ok";
  }
  items.push({ check: "Bankroll", status: bankrollStatus, detail: bankrollDetail });

  // Qwen artifacts
  const staleAgents: string[] = [];
  for (const agent of activeAgents) {
    if (!["ceo", "analyst"].includes(agent.role ?? "")) continue;
    const state = await db
      .select({ stateJson: agentRuntimeState.stateJson })
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, agent.id))
      .then((rows) => rows[0] ?? null);
    if (!state?.stateJson) continue;
    const artifact = (state.stateJson as Record<string, unknown>).qwenArtifact as Record<string, unknown> | undefined;
    if (!artifact?.generated_at) continue;
    const ageMs = Date.now() - new Date(String(artifact.generated_at)).getTime();
    const maxAgeMs = agent.role === "ceo" ? 24 * 3600 * 1000 : 2 * 3600 * 1000;
    if (ageMs > maxAgeMs) {
      staleAgents.push(`${agent.name ?? agent.role}: ${Math.round(ageMs / 3600000)}h old`);
    }
  }
  items.push(
    staleAgents.length === 0
      ? { check: "Qwen artifacts", status: "ok", detail: "All fresh" }
      : { check: "Qwen artifacts", status: "warn", detail: staleAgents.join(", ") },
  );

  return { items, generatedAt: new Date() };
}

async function runWatchdogChecks(db: Db): Promise<void> {
  try {
    await checkStuckRuns(db);
  } catch (err) {
    logger.warn({ err }, "watchdog: stuck-runs check failed");
  }
  try {
    await checkConsecutiveFailures(db);
  } catch (err) {
    logger.warn({ err }, "watchdog: consecutive-failures check failed");
  }
  try {
    await checkCostSpike(db);
  } catch (err) {
    logger.warn({ err }, "watchdog: cost-spike check failed");
  }
  try {
    await checkQwenHealth(db);
  } catch (err) {
    logger.warn({ err }, "watchdog: qwen-health check failed");
  }
  try {
    await checkBankrollDrawdown(db);
  } catch (err) {
    logger.warn({ err }, "watchdog: bankroll-drawdown check failed");
  }
}

export function startWatchdog(db: Db): void {
  if (watchdogTimer) return;
  // Run once shortly after startup so the rest of the app can finish booting.
  const startupDelay = setTimeout(() => {
    void runWatchdogChecks(db as unknown as Db);
  }, 15_000);
  watchdogTimer = setInterval(() => {
    void runWatchdogChecks(db as unknown as Db);
  }, WATCHDOG_INTERVAL_MS);
  logger.info("watchdog: started (5-min interval, 5 checks)");
  // Ensure startup timer doesn't prevent process exit
  startupDelay.unref?.();
  watchdogTimer.unref?.();
}

export function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
    logger.info("watchdog: stopped");
  }
}
