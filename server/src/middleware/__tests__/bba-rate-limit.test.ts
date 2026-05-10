import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetForTests,
  bbaRateLimiter,
  getRateLimitedCount,
} from "../bba-rate-limit.js";

function createResponse() {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function callLimiter(limiter: ReturnType<typeof bbaRateLimiter>, companyId = "company-1") {
  const res = createResponse();
  const next = vi.fn();

  limiter({ params: { companyId } } as any, res as any, next);
  return { res, next };
}

describe("bbaRateLimiter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetForTests();
  });

  it("allows 10 calls in a 60s window and returns 429 on the 11th", () => {
    const limiter = bbaRateLimiter();

    for (let i = 0; i < 10; i += 1) {
      expect(callLimiter(limiter).next).toHaveBeenCalledTimes(1);
    }
    const blocked = callLimiter(limiter);

    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    expect(blocked.res.json).toHaveBeenCalledWith({
      error: "rate_limited",
      retryAfterMs: expect.any(Number),
    });
  });

  it("resets the bucket after the window expires", () => {
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const limiter = bbaRateLimiter();

    for (let i = 0; i < 10; i += 1) {
      callLimiter(limiter);
    }
    expect(callLimiter(limiter).res.status).toHaveBeenCalledWith(429);

    nowSpy.mockReturnValue(now + 60_001);
    expect(callLimiter(limiter).next).toHaveBeenCalledTimes(1);
  });

  it("tracks different companyIds independently", () => {
    const limiter = bbaRateLimiter();

    for (let i = 0; i < 10; i += 1) {
      callLimiter(limiter, "company-1");
    }

    expect(callLimiter(limiter, "company-2").next).toHaveBeenCalledTimes(1);
  });

  it("getRateLimitedCount increments only on 429s", () => {
    const limiter = bbaRateLimiter();

    for (let i = 0; i < 10; i += 1) {
      callLimiter(limiter);
    }
    expect(getRateLimitedCount()).toBe(0);

    callLimiter(limiter);
    callLimiter(limiter);

    expect(getRateLimitedCount()).toBe(2);
  });

  it("__resetForTests zeroes the counter and bucket", () => {
    const limiter = bbaRateLimiter();
    for (let i = 0; i < 11; i += 1) {
      callLimiter(limiter);
    }
    expect(getRateLimitedCount()).toBe(1);

    __resetForTests();

    expect(getRateLimitedCount()).toBe(0);
    expect(callLimiter(limiter).next).toHaveBeenCalledTimes(1);
  });
});
