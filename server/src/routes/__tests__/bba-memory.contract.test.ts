import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let app: express.Express;
let tmpDir: string;
let bbaMemory: typeof import("../../services/bba-memory/index.js");
const stubExecute = vi.fn();

const actor = {
  type: "board",
  userId: "user-1",
  companyIds: ["company-1", "company-2"],
  source: "session",
  isInstanceAdmin: true,
};

const executePayload = {
  loginUsername: { secretName: "BBA_USERNAME" },
  loginPassword: { secretName: "BBA_PASSWORD" },
  bookmakerConfig: {
    bookmaker: "TestBook",
    baseUrl: "https://example.test",
    loginUrl: "https://example.test/login",
    username: { selectors: ["#user"] },
    password: { selectors: ["#pass"] },
    loginSubmit: { selectors: ["#login"] },
    selectionButton: { selectors: ["#selection"] },
    stakeInput: { selectors: ["#stake"] },
    reviewButton: { selectors: ["#review"] },
  },
  bet: {
    matchLabel: "Team A vs Team B",
    market: "1X2",
    selection: "1",
    odds: 1.9,
    stake: 10,
  },
  riskControls: {
    maxStakePerBet: 100,
    maxTotalStakePerSession: 200,
  },
};

function resetDb() {
  bbaMemory.getDb().exec(`
    DELETE FROM failures;
    DELETE FROM popups_seen;
    DELETE FROM runs;
    DELETE FROM idempotency_keys;
  `);
}

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

async function createApp() {
  const [{ errorHandler }, { bbaMemoryRoutes }, { bettingBrowserAutomationRoutes }] =
    await Promise.all([
      import("../../middleware/index.js"),
      import("../bba-memory.js"),
      import("../betting-browser-automation.js"),
    ]);

  const testApp = express();
  testApp.use(express.json());
  testApp.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  testApp.use("/api", bbaMemoryRoutes());
  testApp.use("/api", bettingBrowserAutomationRoutes({} as any));
  testApp.use(errorHandler);
  return testApp;
}

describe.sequential("bba-memory contract routes", () => {
  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bba-test-"));
    process.env.BBA_MEMORY_DIR = tmpDir;
    vi.doMock("../../services/betting-browser-automation.js", () => ({
      bettingBrowserAutomationService: () => ({ execute: stubExecute }),
      DEFAULT_BBA_CHROMIUM_PROFILE: "/tmp/profile",
    }));
    bbaMemory = await import("../../services/bba-memory/index.js");
    bbaMemory.initBbaMemory();
    app = await createApp();
  });

  beforeEach(async () => {
    resetDb();
    stubExecute.mockReset().mockResolvedValue({
      status: "completed",
      placedBetId: "test-123",
    });
    const { __resetForTests } = await import("../../middleware/bba-rate-limit.js");
    const { __resetMetricsForTests } = await import("../../services/bba-memory/repository.js");
    __resetForTests();
    __resetMetricsForTests();
  });

  afterAll(() => {
    bbaMemory.closeBbaMemory();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET /recent-runs returns 200 + correct shape on empty DB", async () => {
    const res = await request(app).get("/api/companies/company-1/bba-memory/recent-runs");

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

    const res = await request(app).get("/api/companies/company-1/bba-memory/recent-runs");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.runs[0].meta.companyId).toBe("company-1");
  });

  it("GET /recent-runs respects ?limit clamp", async () => {
    seedRun("company-1");
    seedRun("company-1");
    seedRun("company-1");

    const limited = await request(app).get("/api/companies/company-1/bba-memory/recent-runs?limit=2");
    const clamped = await request(app).get("/api/companies/company-1/bba-memory/recent-runs?limit=999");

    expect(limited.status).toBe(200);
    expect(limited.body.limit).toBe(2);
    expect(limited.body.total).toBe(2);
    expect(clamped.status).toBe(200);
    expect(clamped.body.limit).toBe(20);
  });

  it("GET /stats-summary returns 200 + correct shape on empty DB", async () => {
    const res = await request(app).get("/api/companies/company-1/bba-memory/stats-summary");

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
    const res = await request(app).get("/api/companies/company-1/bba-memory/stats-summary?windowDays=999");

    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(90);
  });

  it("GET /stats-summary handles corrupted meta_json without 500", async () => {
    const runId = seedRun("company-1");
    bbaMemory.getDb().prepare("UPDATE runs SET meta_json = ? WHERE id = ?").run("{bad-json", runId);

    const res = await request(app).get("/api/companies/company-1/bba-memory/stats-summary");

    expect(res.status).toBe(200);
    expect(res.body.totalRuns).toBe(0);
  });

  it("GET /metrics returns Prometheus-text for empty DB", async () => {
    const res = await request(app).get("/api/companies/company-1/bba-memory/metrics");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("# HELP bba_idempotency_replays_total");
    expect(res.text).toContain("bba_rate_limited_total 0");
    expect(res.text).toContain('bba_runs_total{company_id="company-1",outcome="success"} 0');
  });

  it("GET /metrics increments replays counter after a hit on /execute", async () => {
    await request(app)
      .post("/api/companies/company-1/betting-browser-automation/execute")
      .set("Idempotency-Key", "metrics-key")
      .send(executePayload)
      .expect(200);
    await request(app)
      .post("/api/companies/company-1/betting-browser-automation/execute")
      .set("Idempotency-Key", "metrics-key")
      .send(executePayload)
      .expect(200);

    const res = await request(app).get("/api/companies/company-1/bba-memory/metrics");

    expect(res.status).toBe(200);
    expect(res.text).toContain("bba_idempotency_replays_total 1");
  });

  it("DELETE /idempotency-keys removes only the target company's rows", async () => {
    bbaMemory.putIdempotencyKey("company-1-key", "company-1", "{}");
    bbaMemory.putIdempotencyKey("company-2-key", "company-2", "{}");

    const res = await request(app).delete("/api/companies/company-1/bba-memory/idempotency-keys");
    const remaining = bbaMemory.getDb()
      .prepare("SELECT company_id FROM idempotency_keys ORDER BY company_id")
      .all() as Array<{ company_id: string }>;

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
    expect(remaining.map((r) => r.company_id)).toEqual(["company-2"]);
  });
});
