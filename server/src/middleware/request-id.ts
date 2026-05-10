import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const header = req.headers["x-request-id"];
    const headerValue = Array.isArray(header) ? header[0] : header;
    const requestId =
      typeof headerValue === "string" && headerValue.length > 0 && headerValue.length <= 64
        ? headerValue
        : randomUUID();

    req.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    next();
  };
}
