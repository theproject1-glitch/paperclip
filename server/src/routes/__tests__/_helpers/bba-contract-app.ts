import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { requestIdMiddleware } from "../../../middleware/request-id.js";

export interface BbaTestAppHandle {
  app: import("express").Express;
  tmpDir: string;
  stubExecute: ReturnType<typeof vi.fn>;
  cleanup: () => void;
  reset: () => Promise<void>;
  setActor: (actor: BbaTestActor) => void;
}

export type BbaTestActor = {
  type: "board";
  userId: string;
  companyIds: string[];
  source: "session";
  isInstanceAdmin?: boolean;
};

const defaultActor: BbaTestActor = {
  type: "board",
  userId: "user-1",
  companyIds: ["company-1", "company-2"],
  source: "session",
  isInstanceAdmin: true,
};

const stubExecute = vi.fn();

export function buildExecutePayload(overrides: Record<string, unknown> = {}): unknown {
  return {
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
    ...overrides,
  };
}

export function findLogCall(
  spy: ReturnType<typeof vi.spyOn>,
  message: string,
): { obj: Record<string, unknown> | null; msg: string } | null {
  for (const call of spy.mock.calls) {
    // pino signature: logger.info(obj, msg) OR logger.info(msg)
    const [arg0, arg1] = call;
    const captured = typeof arg0 === "string"
      ? { obj: null, msg: arg0 }
      : { obj: arg0 as Record<string, unknown>, msg: String(arg1 ?? "") };
    if (captured.msg.includes(message)) return captured;
  }
  return null;
}

export async function createBbaTestApp(): Promise<BbaTestAppHandle> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bba-test-"));
  process.env.BBA_MEMORY_DIR = tmpDir;
  let currentActor = { ...defaultActor };

  vi.doMock("../../../services/betting-browser-automation.js", () => ({
    bettingBrowserAutomationService: () => ({ execute: stubExecute }),
    DEFAULT_BBA_CHROMIUM_PROFILE: "/tmp/profile",
  }));

  const bbaMemory = await import("../../../services/bba-memory/index.js");
  bbaMemory.initBbaMemory();

  const [{ errorHandler }, { bbaMemoryRoutes }, { bettingBrowserAutomationRoutes }] =
    await Promise.all([
      import("../../../middleware/index.js"),
      import("../../bba-memory.js"),
      import("../../betting-browser-automation.js"),
    ]);

  const app = express();
  app.use(requestIdMiddleware());
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = currentActor;
    next();
  });
  app.use("/api", bbaMemoryRoutes());
  app.use("/api", bettingBrowserAutomationRoutes({} as any));
  app.use(errorHandler);

  return {
    app,
    tmpDir,
    stubExecute,
    cleanup: () => {
      bbaMemory.closeBbaMemory();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
    setActor: (actor) => {
      currentActor = actor;
    },
    reset: async () => {
      currentActor = { ...defaultActor };
      bbaMemory.getDb().exec(`
        DELETE FROM failures;
        DELETE FROM popups_seen;
        DELETE FROM runs;
        DELETE FROM idempotency_keys;
      `);
      stubExecute.mockReset().mockResolvedValue({
        status: "completed",
        placedBetId: "test-123",
      });
      const { __resetForTests } = await import("../../../middleware/bba-rate-limit.js");
      const { __resetMetricsForTests } = await import("../../../services/bba-memory/repository.js");
      __resetForTests();
      __resetMetricsForTests();
    },
  };
}
