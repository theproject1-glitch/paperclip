import type { RequestHandler } from "express";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

type Bucket = {
  resetAt: number;
  remaining: number;
};

const buckets = new Map<string, Bucket>();
let _rateLimitedCount = 0;

export function bbaRateLimiter(): RequestHandler {
  return (req, res, next) => {
    const companyId = req.params.companyId;
    if (!companyId) {
      next();
      return;
    }

    const now = Date.now();
    const existing = buckets.get(companyId);
    const bucket =
      !existing || existing.resetAt <= now
        ? { resetAt: now + WINDOW_MS, remaining: MAX_REQUESTS }
        : existing;

    if (bucket.remaining <= 0) {
      const retryAfterMs = Math.max(0, bucket.resetAt - now);
      _rateLimitedCount += 1;
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000));
      res.status(429).json({ error: "rate_limited", retryAfterMs });
      buckets.set(companyId, bucket);
      return;
    }

    bucket.remaining -= 1;
    buckets.set(companyId, bucket);
    next();
  };
}

export function getRateLimitedCount(): number {
  return _rateLimitedCount;
}

export function __resetForTests(): void {
  buckets.clear();
  _rateLimitedCount = 0;
}
