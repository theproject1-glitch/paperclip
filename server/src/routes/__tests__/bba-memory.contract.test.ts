import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildExecutePayload,
  createBbaTestApp,
  type BbaTestAppHandle,
} from "./_helpers/bba-contract-app.js";

let handle: BbaTestAppHandle;
let bbaMemory: typeof import("../../services/bba-memory/index.js");

function seedRun(companyId: string, outcome: "success" | "failure" | "partial" = "success") {
  const runId = bbaMemory.startRun({ source: "manual", trigger: "contract-test" });
  bbaMemory.completeRun(runId, {
    outcome,
    failureClass: outcome === "failure" ? "UNKNOWN" : undefined,
    durationMs: 1000,
    meta: { companyId },
  });
  return runId;
}

describe.sequential("bba-memory contract routes", () => {
  beforeAll(async () => {
    handle = await createBbaTestApp();
    bbaMemory = await import("../../services/bba-memory/index.js");
  });

  beforeEach(async () => {
    await handle.reset();
  });

  afterAll(() => {
    handle.cleanup();
  });

  it("GET /recent-runs returns 200 + correct shape on empty DB", async () => {
    const res = await request(handle.app).get("/api/companies/company-1/bba-memory/recent-runs");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      companyId: "company-1",
      limit: 20,
      total: 0,
      runs: [],
    });
  });

  it("GET /recent-runs filters by companyId via meta_json", async () => {
    seedRun("company-1");
    seedRun("company-2");

    const res = await request(handle.app).get("/api/companies/company-1/bba-memory/recent-runs");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.runs[0].meta.companyId).toBe("company-1");
  });

  it("GET /recent-runs respects ?limit clamp", async () => {
    seedRun("company-1");
    seedRun("company-1");
    seedRun("company-1");

    const limited = await request(handle.app).get("/api/companies/company-1/bba-memory/recent-runs?limit=2");
    const clamped = await request(handle.app).get("/api/companies/company-1/bba-memory/recent-runs?limit=999");

    expect(limited.status).toBe(200);
    expect(limited.body.limit).toBe(2);
    expect(limited.body.total).toBe(2);
    expect(clamped.status).toBe(200);
    expect(clamped.body.limit).toBe(20);
  });

  it("GET /stats-summary returns 200 + correct shape on empty DB", async () => {
    const res = await request(handle.app).get("/api/companies/company-1/bba-memory/stats-summary");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      companyId: "company-1",
      windowDays: 7,
      totalRuns: 0,
      successCount: 0,
      failureCount: 0,
      partialCount: 0,
      successRatePct: null,
      topFailureClasses: [],
    });
  });

  it("GET /stats-summary clamps windowDays to 1-90", async () => {
    const res = await request(handle.app).get("/api/companies/company-1/bba-memory/stats-summary?windowDays=999");

    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(90);
  });

  it("GET /stats-summary handles corrupted meta_json without 500", async () => {
    const runId = seedRun("company-1");
    bbaMemory.getDb().prepare("UPDATE runs SET meta_json = ? WHERE id = ?").run("{bad-json", runId);

    const res = await request(handle.app).get("/api/companies/company-1/bba-memory/stats-summary");

    expect(res.status).toBe(200);
    expect(res.body.totalRuns).toBe(0);
  });

  it("GET /metrics returns Prometheus-text for empty DB", async () => {
    const res = await request(handle.app).get("/api/companies/company-1/bba-memory/metrics");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("# HELP bba_idempotency_replays_total");
    expect(res.text).toContain("bba_rate_limited_total 0");
    expect(res.text).toContain('bba_runs_total{company_id="company-1",outcome="success"} 0');
  });

  it("GET /metrics increments replays counter after a hit on /execute", async () => {
    await request(handle.app)
      .post("/api/companies/company-1/betting-browser-automation/execute")
      .set("Idempotency-Key", "metrics-key")
      .send(buildExecutePayload())
      .expect(200);
    await request(handle.app)
      .post("/api/companies/company-1/betting-browser-automation/execute")
      .set("Idempotency-Key", "metrics-key")
      .send(buildExecutePayload())
      .expect(200);

    const res = await request(handle.app).get("/api/companies/company-1/bba-memory/metrics");

    expect(res.status).toBe(200);
    expect(res.text).toContain("bba_idempotency_replays_total 1");
  });

  it("DELETE /idempotency-keys removes only the target company's rows", async () => {
    bbaMemory.putIdempotencyKey("company-1-key", "company-1", "{}");
    bbaMemory.putIdempotencyKey("company-2-key", "company-2", "{}");

    const res = await request(handle.app).delete("/api/companies/company-1/bba-memory/idempotency-keys");
    const remaining = bbaMemory.getDb()
      .prepare("SELECT company_id FROM idempotency_keys ORDER BY company_id")
      .all() as Array<{ company_id: string }>;

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
    expect(remaining.map((r) => r.company_id)).toEqual(["company-2"]);
  });

  it("non-admin company member cannot DELETE /idempotency-keys", async () => {
    handle.setActor({
      type: "board",
      userId: "user-2",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    });
    bbaMemory.putIdempotencyKey("company-1-key", "company-1", "{}");

    const res = await request(handle.app).delete("/api/companies/company-1/bba-memory/idempotency-keys");
    const remaining = bbaMemory.getDb()
      .prepare("SELECT key FROM idempotency_keys WHERE company_id = ?")
      .all("company-1");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: "forbidden",
      reason: "DELETE /idempotency-keys requires instance-admin role.",
    });
    expect(remaining).toHaveLength(1);
  });

  it("instance-admin can DELETE /idempotency-keys", async () => {
    bbaMemory.putIdempotencyKey("company-1-key", "company-1", "{}");

    const res = await request(handle.app).delete("/api/companies/company-1/bba-memory/idempotency-keys");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
  });
});
