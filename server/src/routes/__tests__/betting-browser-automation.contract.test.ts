import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExecutePayload,
  createBbaTestApp,
  type BbaTestAppHandle,
} from "./_helpers/bba-contract-app.js";

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

  it("Two concurrent calls with same Idempotency-Key only run the service once", async () => {
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

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
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
});
