import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

async function createApp() {
  const [{ errorHandler }, { bettingBrowserAutomationRoutes }] =
    await Promise.all([
      import("../../middleware/index.js"),
      import("../betting-browser-automation.js"),
    ]);

  const testApp = express();
  testApp.use(express.json());
  testApp.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  testApp.use("/api", bettingBrowserAutomationRoutes({} as any));
  testApp.use(errorHandler);
  return testApp;
}

function postExecute(companyId = "company-1") {
  return request(app)
    .post(`/api/companies/${companyId}/betting-browser-automation/execute`)
    .send(executePayload);
}

describe.sequential("betting browser automation contract routes", () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    bbaMemory.closeBbaMemory();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("POST /execute without Idempotency-Key works as today", async () => {
    const res = await postExecute();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "completed", placedBetId: "test-123" });
    expect(res.headers["x-idempotent-replay"]).toBeUndefined();
    expect(stubExecute).toHaveBeenCalledTimes(1);
  });

  it("POST /execute with Idempotency-Key stores + replays within 60s", async () => {
    const first = await postExecute().set("Idempotency-Key", "replay-key");
    const second = await postExecute().set("Idempotency-Key", "replay-key");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers["x-idempotent-replay"]).toBe("true");
    expect(second.body).toEqual(first.body);
    expect(stubExecute).toHaveBeenCalledTimes(1);
  });

  it("POST /execute with stale key executes fresh", async () => {
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    await postExecute().set("Idempotency-Key", "stale-key").expect(200);

    nowSpy.mockReturnValue(now + 61_000);
    const second = await postExecute().set("Idempotency-Key", "stale-key");

    expect(second.status).toBe(200);
    expect(second.headers["x-idempotent-replay"]).toBeUndefined();
    expect(stubExecute).toHaveBeenCalledTimes(2);
  });

  it("POST /execute returns 429 after 10 rapid calls for same company", async () => {
    for (let i = 0; i < 10; i += 1) {
      await postExecute().expect(200);
    }

    const res = await postExecute();

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("POST /execute does NOT rate-limit different companies independently", async () => {
    for (let i = 0; i < 10; i += 1) {
      await postExecute("company-1").expect(200);
    }

    const res = await postExecute("company-2");

    expect(res.status).toBe(200);
    expect(stubExecute).toHaveBeenCalledTimes(11);
  });

  it("X-Idempotent-Replay header is set on replays only", async () => {
    const first = await postExecute().set("Idempotency-Key", "header-key");
    const second = await postExecute().set("Idempotency-Key", "header-key");

    expect(first.headers["x-idempotent-replay"]).toBeUndefined();
    expect(second.headers["x-idempotent-replay"]).toBe("true");
  });

  it("POST /execute with malformed Idempotency-Key falls back to non-idempotent execution", async () => {
    const malformed = "x".repeat(129);

    const first = await postExecute().set("Idempotency-Key", malformed);
    const second = await postExecute().set("Idempotency-Key", malformed);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers["x-idempotent-replay"]).toBeUndefined();
    expect(stubExecute).toHaveBeenCalledTimes(2);
  });

  it("Two concurrent calls with same Idempotency-Key only run the service once", async () => {
    stubExecute.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({
        status: "completed",
        placedBetId: "test-123",
      }), 30)),
    );

    const [first, second] = await Promise.all([
      postExecute().set("Idempotency-Key", "concurrent-key"),
      postExecute().set("Idempotency-Key", "concurrent-key"),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(stubExecute).toHaveBeenCalledTimes(1);
  });

  it("Rate-limit window boundary allows a call after the window passes", async () => {
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    for (let i = 0; i < 10; i += 1) {
      await postExecute().expect(200);
    }
    await postExecute().expect(429);

    nowSpy.mockReturnValue(now + 60_001);
    const res = await postExecute();

    expect(res.status).toBe(200);
  });
});
