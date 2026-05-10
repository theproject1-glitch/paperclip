import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const SAFE_REQUEST_ID = /^[\x21-\x7E]{1,64}$/;

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const header = req.headers["x-request-id"];
    const headerValue = Array.isArray(header) ? header[0] : header;
    const incoming = typeof headerValue === "string" ? headerValue : "";
    const requestId =
      incoming.length > 0 && SAFE_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUID();

    req.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    next();
  };
}
