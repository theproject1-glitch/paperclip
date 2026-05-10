import { describe, expect, it, vi } from "vitest";
import { requestIdMiddleware } from "../request-id.js";

const uuidRegex = /^[0-9a-f-]{36}$/i;

function callMiddleware(headers: Record<string, unknown> = {}) {
  const req: any = { headers };
  const res: any = { setHeader: vi.fn() };
  const next = vi.fn();

  requestIdMiddleware()(req, res, next);
  return { req, res, next };
}

describe("requestIdMiddleware", () => {
  it("honors valid X-Request-ID header", () => {
    const incoming = "req-phase-f-closeout";

    const { req, res, next } = callMiddleware({ "x-request-id": incoming });

    expect(req.requestId).toBe(incoming);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", incoming);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized header and falls back to crypto.randomUUID()", () => {
    const { req, res } = callMiddleware({ "x-request-id": "x".repeat(65) });

    expect(req.requestId).toMatch(uuidRegex);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.requestId);
  });

  it("generates fresh UUID when header is missing", () => {
    const { req, res } = callMiddleware();

    expect(req.requestId).toMatch(uuidRegex);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.requestId);
  });

  it("treats empty-string header as missing", () => {
    const { req, res } = callMiddleware({ "x-request-id": "" });

    expect(req.requestId).toMatch(uuidRegex);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.requestId);
  });
});
