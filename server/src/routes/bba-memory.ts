import { Router } from "express";
import {
  listRecentRuns,
  listRecentRunsForCompany,
  getCompanyStatsSummary,
  getIdempotencyReplayCount,
  deleteIdempotentForCompany,
  safeParseMetaJson,
} from "../services/bba-memory/index.js";
import { assertCompanyAccess } from "./authz.js";
import { getRateLimitedCount } from "../middleware/bba-rate-limit.js";
import { logger } from "../middleware/logger.js";

export function bbaMemoryRoutes() {
  const router = Router();

  router.get("/companies/:companyId/bba-memory/recent-runs", (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const limitRaw = req.query.limit;
    const parsed = typeof limitRaw === "string" ? parseInt(limitRaw, 10) : NaN;
    const safeLimit = Number.isFinite(parsed) && parsed > 0 && parsed <= 200 ? parsed : 20;

    // ?all=true is an instance-admin-only override that bypasses company filter.
    const actor = (req as any).actor;
    const wantsAll = req.query.all === "true";
    const isAdmin = actor?.type === "board" && actor?.isInstanceAdmin === true;
    const runs = wantsAll && isAdmin ? listRecentRuns(safeLimit) : listRecentRunsForCompany(companyId, safeLimit);

    res.json({
      companyId,
      limit: safeLimit,
      total: runs.length,
      runs: runs.map((r) => ({
        id: r.id,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        source: r.source,
        trigger: r.trigger,
        outcome: r.outcome,
        failureClass: r.failure_class,
        durationMs: r.duration_ms,
        meta: safeParseMetaJson(r.meta_json, r.id),
      })),
    });
  });

  router.get("/companies/:companyId/bba-memory/stats-summary", (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const windowRaw = req.query.windowDays;
    const parsed = typeof windowRaw === "string" ? parseInt(windowRaw, 10) : NaN;
    const windowDays = !Number.isFinite(parsed) || parsed <= 0 ? 7 : Math.min(parsed, 90);

    res.json(getCompanyStatsSummary(companyId, windowDays));
  });

  router.get("/companies/:companyId/bba-memory/metrics", (req, res) => {
    // NOTE: bba_idempotency_replays_total and bba_rate_limited_total are
    // process-local counters. They reset on restart and are NOT shared
    // across multiple Node.js processes. Configure Prometheus scrape with
    // a per-pod label for multi-instance deployments.
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const stats = getCompanyStatsSummary(companyId, 7);
    const labelCompanyId = companyId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const lines = [
      "# HELP bba_idempotency_replays_total /execute calls served from cache.",
      "# TYPE bba_idempotency_replays_total counter",
      `bba_idempotency_replays_total ${getIdempotencyReplayCount()}`,
      "",
      "# HELP bba_rate_limited_total /execute calls rejected by rate limiter.",
      "# TYPE bba_rate_limited_total counter",
      `bba_rate_limited_total ${getRateLimitedCount()}`,
      "",
      "# HELP bba_runs_total Runs by outcome (rolling 7d, scoped to company).",
      "# TYPE bba_runs_total counter",
      `bba_runs_total{company_id="${labelCompanyId}",outcome="success"} ${stats.successCount}`,
      `bba_runs_total{company_id="${labelCompanyId}",outcome="failure"} ${stats.failureCount}`,
      `bba_runs_total{company_id="${labelCompanyId}",outcome="partial"} ${stats.partialCount}`,
      "",
    ];

    res.type("text/plain; charset=utf-8").send(lines.join("\n"));
  });

  router.delete("/companies/:companyId/bba-memory/idempotency-keys", (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const deleted = deleteIdempotentForCompany(companyId);
    logger.info(`bba-memory: idempotency keys cleared for ${companyId}: ${deleted}`);
    res.json({ deleted });
  });

  return router;
}
