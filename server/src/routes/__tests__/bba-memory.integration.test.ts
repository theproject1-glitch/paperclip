import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildExecutePayload,
  createBbaTestApp,
  type BbaTestAppHandle,
} from "./_helpers/bba-contract-app.js";

let handle: BbaTestAppHandle;

function parsePrometheusCounter(
  text: string,
  name: string,
  labels: Record<string, string> = {},
): number | null {
  const labelText = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(",");
  const prefix = labelText ? `${name}{${labelText}}` : name;
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith(`${prefix} `));
  if (!line) return null;
  return Number(line.slice(prefix.length).trim());
}

function postExecute(companyId = "company-1") {
  return request(handle.app)
    .post(`/api/companies/${companyId}/betting-browser-automation/execute`)
    .send(buildExecutePayload());
}

function getMetrics(companyId = "company-1") {
  return request(handle.app).get(`/api/companies/${companyId}/bba-memory/metrics`);
}

describe.sequential("bba-memory execute to metrics integration", () => {
  beforeAll(async () => {
    handle = await createBbaTestApp();
  });

  beforeEach(async () => {
    await handle.reset();
  });

  afterAll(() => {
    handle.cleanup();
  });

  it("/execute then /metrics shows incremented success counter", async () => {
    await postExecute().expect(200);

    const res = await getMetrics();

    expect(res.status).toBe(200);
    expect(parsePrometheusCounter(res.text, "bba_runs_total", {
      company_id: "company-1",
      outcome: "success",
    })).toBe(1);
  });

  it("idempotency replay increments replay counter without double-counting success", async () => {
    await postExecute().set("Idempotency-Key", "integration-replay").expect(200);
    const replay = await postExecute().set("Idempotency-Key", "integration-replay");

    expect(replay.status).toBe(200);
    expect(replay.headers["x-idempotent-replay"]).toBe("true");

    const res = await getMetrics();

    expect(parsePrometheusCounter(res.text, "bba_idempotency_replays_total")).toBe(1);
    expect(parsePrometheusCounter(res.text, "bba_runs_total", {
      company_id: "company-1",
      outcome: "success",
    })).toBe(1);
  });

  it("rate limiter increments bba_rate_limited_total", async () => {
    for (let i = 0; i < 10; i += 1) {
      await postExecute().expect(200);
    }
    await postExecute().expect(429);

    const res = await getMetrics();

    expect(parsePrometheusCounter(res.text, "bba_rate_limited_total")).toBe(1);
  });
});
