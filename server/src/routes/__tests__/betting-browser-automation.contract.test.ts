import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExecutePayload,
  createBbaTestApp,
  findLogCall,
  type BbaTestAppHandle,
} from "./_helpers/bba-contract-app.js";
import { logger } from "../../middleware/logger.js";
import { getIdempotencyReplayCount } from "../../services/bba-memory/index.js";

let handle: BbaTestAppHandle;

function postExecute(companyId = "company-1") {
  return request(handle.app)
    .post(`/api/companies/${companyId}/betting-browser-automation/execute`)
    .send(buildExecutePayload());
}

describe.sequential("betting browser automation contract routes", () => {
  beforeAll(async () => {
    handle = await createBbaTestApp();
  });

  beforeEach(async () => {
    await handle.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    handle.cleanup();
  });

  it("POST /execute without Idempotency-Key works as today", async () => {
    const res = await postExecute();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "completed", placedBetId: "test-123" });
    expect(res.headers["x-idempotent-replay"]).toBeUndefined();
    expect(handle.stubExecute).toHaveBeenCalledTimes(1);
  });

  it("POST /execute with Idempotency-Key stores + replays within 60s", async () => {
    const first = await postExecute().set("Idempotency-Key", "replay-key");
    const second = await postExecute().set("Idempotency-Key", "replay-key");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers["x-idempotent-replay"]).toBe("true");
    expect(second.body).toEqual(first.body);
    expect(handle.stubExecute).toHaveBeenCalledTimes(1);
  });

  it("POST /execute with stale key executes fresh", async () => {
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    await postExecute().set("Idempotency-Key", "stale-key").expect(200);

    nowSpy.mockReturnValue(now + 61_000);
    const second = await postExecute().set("Idempotency-Key", "stale-key");

    expect(second.status).toBe(200);
    expect(second.headers["x-idempotent-replay"]).toBeUndefined();
    expect(handle.stubExecute).toHaveBeenCalledTimes(2);
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
    expect(handle.stubExecute).toHaveBeenCalledTimes(11);
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
    expect(handle.stubExecute).toHaveBeenCalledTimes(2);
  });

  it("Two concurrent calls with same Idempotency-Key return one success and one in-progress response", async () => {
    handle.stubExecute.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({
        status: "completed",
        placedBetId: "test-123",
      }), 30)),
    );

    const [first, second] = await Promise.all([
      postExecute().set("Idempotency-Key", "concurrent-key"),
      postExecute().set("Idempotency-Key", "concurrent-key"),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const inProgress = first.status === 409 ? first : second;
    expect(inProgress.body).toEqual({ error: "request_in_progress", retryAfterMs: 5000 });
    expect(handle.stubExecute).toHaveBeenCalledTimes(1);
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

  it("happy path emits bba-execute completed info log", async () => {
    const infoSpy = vi.spyOn(logger, "info");

    await postExecute().set("X-Request-ID", "req-log-happy").expect(200);

    const call = findLogCall(infoSpy, "bba-execute completed");
    expect(call?.obj).toMatchObject({
      requestId: "req-log-happy",
      companyId: "company-1",
      wasReplay: false,
      outcome: "completed",
    });
    expect(call?.obj).toMatchObject({ durationMs: expect.any(Number) });
  });

  it("idempotency replay emits log with wasReplay true", async () => {
    const infoSpy = vi.spyOn(logger, "info");

    await postExecute().set("Idempotency-Key", "log-replay-key").expect(200);
    infoSpy.mockClear();
    await postExecute().set("Idempotency-Key", "log-replay-key").expect(200);

    const replayCall = findLogCall(infoSpy, "bba-execute completed");
    expect(replayCall?.obj).toMatchObject({
      companyId: "company-1",
      idempotencyKeyPrefix: "log-repl",
      wasReplay: true,
      outcome: "completed",
    });
  });

  it("error path emits warn log with errorClass and errorMessage", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    handle.stubExecute.mockRejectedValueOnce(new Error("bookmaker offline"));

    const res = await postExecute().set("X-Request-ID", "req-log-error");

    expect(res.status).toBe(500);
    const call = findLogCall(warnSpy, "bba-execute failed");
    expect(call?.obj).toMatchObject({
      requestId: "req-log-error",
      companyId: "company-1",
      wasReplay: false,
      errorClass: "Error",
      errorMessage: expect.stringContaining("bookmaker offline"),
    });
  });

  it("execute completed info log omits full payload fields", async () => {
    const infoSpy = vi.spyOn(logger, "info");

    await postExecute().expect(200);

    const call = findLogCall(infoSpy, "bba-execute completed");
    const logObject = call?.obj as Record<string, unknown>;
    expect(logObject).not.toHaveProperty("bookmakerConfig");
    expect(logObject).not.toHaveProperty("loginUsername");
    expect(logObject).not.toHaveProperty("loginPassword");
    expect(JSON.stringify(logObject)).not.toContain("Team A vs Team B");
    expect(JSON.stringify(logObject)).not.toContain('"selection"');
  });

  it("Concurrent /execute with same Idempotency-Key emits exactly one non-replay bba-execute completed log", async () => {
    const infoSpy = vi.spyOn(logger, "info");
    handle.stubExecute.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({
        status: "completed",
        placedBetId: "test-123",
      }), 30)),
    );

    await Promise.all([
      postExecute().set("Idempotency-Key", "log-concurrent-key"),
      postExecute().set("Idempotency-Key", "log-concurrent-key"),
    ]);

    const freshLogCount = infoSpy.mock.calls.filter((call) => {
      const [, msg] = call;
      return msg === "bba-execute completed" && (call[0] as any).wasReplay === false;
    }).length;
    expect(freshLogCount).toBe(1);
  });

  it("Replay log includes wasReplay true and requestId", async () => {
    const infoSpy = vi.spyOn(logger, "info");

    await postExecute().set("Idempotency-Key", "replay-request-id-key").expect(200);
    infoSpy.mockClear();
    await postExecute().set("Idempotency-Key", "replay-request-id-key").expect(200);

    const replayCall = findLogCall(infoSpy, "bba-execute completed");
    expect(replayCall?.obj).toMatchObject({ wasReplay: true });
    expect(replayCall?.obj?.requestId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));
  });

  it("cross-company idempotency-key collision does NOT increment replay counter", async () => {
    const first = await postExecute("company-1").set("Idempotency-Key", "shared-abc");
    const second = await postExecute("company-2").set("Idempotency-Key", "shared-abc");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers["x-idempotent-replay"]).toBeUndefined();
    expect(second.headers["x-idempotent-replay"]).toBeUndefined();
    expect(handle.stubExecute).toHaveBeenCalledTimes(2);
    expect(getIdempotencyReplayCount()).toBe(0);
  });
});
