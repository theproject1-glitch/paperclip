import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import {
  buildExecutePayload,
  createBbaTestApp,
  type BbaTestAppHandle,
} from "../routes/__tests__/_helpers/bba-contract-app.js";
import { healthRoutes } from "../routes/health.js";
import {
  completeRun,
  getDb,
  getIdempotencyKey,
  startRun,
} from "../services/bba-memory/index.js";
import { logger } from "../middleware/logger.js";

let handle: BbaTestAppHandle;

function parsePrometheusCounter(
  text: string,
  name: string,
  labels: Record<string, string> = {},
): number | null {
  const labelText = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(",");
  const prefix = labelText ? `${name}{${labelText}}` : name;
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith(`${prefix} `));
  if (!line) return null;
  return Number(line.slice(prefix.length).trim());
}

function postExecute(companyId = "company-1") {
  return request(handle.app)
    .post(`/api/companies/${companyId}/betting-browser-automation/execute`)
    .send(buildExecutePayload());
}

function getMetrics(companyId = "company-1") {
  return request(handle.app).get(`/api/companies/${companyId}/bba-memory/metrics`);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.sequential("BBA Memory full integration flow", () => {
  beforeAll(async () => {
    handle = await createBbaTestApp();
    handle.app.use(
      "/health",
      healthRoutes({
        execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
      } as unknown as Db),
    );
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await handle.reset();
  });

  afterAll(() => {
    handle.cleanup();
  });

  it("POST /execute then /metrics shows runs_total success incremented", async () => {
    await postExecute().expect(200);

    const res = await getMetrics().expect(200);

    expect(parsePrometheusCounter(res.text, "bba_runs_total", {
      company_id: "company-1",
      outcome: "success",
    })).toBe(1);
  });

  it("POST /execute twice with same Idempotency-Key replays without a second execute", async () => {
    await postExecute().set("Idempotency-Key", "full-flow-replay").expect(200);
    const replay = await postExecute().set("Idempotency-Key", "full-flow-replay").expect(200);

    const res = await getMetrics().expect(200);

    expect(replay.headers["x-idempotent-replay"]).toBe("true");
    expect(handle.stubExecute).toHaveBeenCalledTimes(1);
    expect(parsePrometheusCounter(res.text, "bba_idempotency_replays_total")).toBe(1);
    expect(parsePrometheusCounter(res.text, "bba_runs_total", {
      company_id: "company-1",
      outcome: "success",
    })).toBe(1);
  });

  it("POST /execute 11 times rapid returns 429 and increments rate_limited metric", async () => {
    for (let i = 0; i < 10; i += 1) {
      await postExecute().expect(200);
    }

    await postExecute().expect(429);

    const res = await getMetrics().expect(200);
    expect(parsePrometheusCounter(res.text, "bba_rate_limited_total")).toBe(1);
  });

  it("GET /recent-runs after three executes returns three runs in descending order", async () => {
    await postExecute().expect(200);
    await delay(2);
    await postExecute().expect(200);
    await delay(2);
    await postExecute().expect(200);

    const res = await request(handle.app)
      .get("/api/companies/company-1/bba-memory/recent-runs")
      .expect(200);

    expect(res.body.total).toBe(3);
    const timestamps = res.body.runs.map((run: { startedAt: string }) => Date.parse(run.startedAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("GET /stats-summary computes success rate across mixed outcomes", async () => {
    handle.stubExecute
      .mockResolvedValueOnce({ status: "completed", placedBetId: "ok-1" })
      .mockResolvedValueOnce({ status: "failed", failureReason: "selector missing" })
      .mockResolvedValueOnce({ status: "awaiting_confirmation", placedBetId: "partial-1" });

    await postExecute().expect(200);
    await postExecute().expect(200);
    await postExecute().expect(200);

    const res = await request(handle.app)
      .get("/api/companies/company-1/bba-memory/stats-summary")
      .expect(200);

    expect(res.body).toMatchObject({
      totalRuns: 3,
      successCount: 1,
      failureCount: 1,
      partialCount: 1,
      successRatePct: 33.3,
    });
  });

  it("DELETE /idempotency-keys requires admin and clears only the target company rows", async () => {
    await postExecute("company-1").set("Idempotency-Key", "delete-company-1").expect(200);
    await postExecute("company-2").set("Idempotency-Key", "delete-company-2").expect(200);

    handle.setActor({
      type: "board",
      userId: "user-2",
      companyIds: ["company-1", "company-2"],
      source: "session",
      isInstanceAdmin: false,
    });

    await request(handle.app)
      .delete("/api/companies/company-1/bba-memory/idempotency-keys")
      .expect(403);

    handle.setActor({
      type: "board",
      userId: "admin-1",
      companyIds: ["company-1", "company-2"],
      source: "session",
      isInstanceAdmin: true,
    });

    const deleted = await request(handle.app)
      .delete("/api/companies/company-1/bba-memory/idempotency-keys")
      .expect(200);

    expect(deleted.body).toEqual({ deleted: 1 });
    expect(getIdempotencyKey("delete-company-1", "company-1")).toBeUndefined();
    expect(getIdempotencyKey("delete-company-2", "company-2")).toBeDefined();
  });

  it("corrupt meta_json keeps recent-runs 200 with null meta and a warning log", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const runId = startRun({ source: "manual", trigger: "corrupt-meta" });
    completeRun(runId, {
      outcome: "success",
      meta: { companyId: "company-1" },
    });
    getDb().prepare("UPDATE runs SET meta_json = ? WHERE id = ?").run("{not-json", runId);

    const res = await request(handle.app)
      .get("/api/companies/company-1/bba-memory/recent-runs?all=true")
      .expect(200);

    const row = res.body.runs.find((candidate: { id: number }) => candidate.id === runId);
    expect(row.meta).toBeNull();
    expect(warnSpy.mock.calls.some((call) => String(call[1]).includes("meta_json parse failed"))).toBe(true);
  });

  it("/health/deep returns ok when DB probe succeeds", async () => {
    const res = await request(handle.app).get("/health/deep").expect(200);

    expect(res.body).toMatchObject({
      status: "ok",
      db_connected: true,
    });
    expect(res.body.uptime_ms).toEqual(expect.any(Number));
  });
});
