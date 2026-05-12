import { describe, expect, it } from "vitest";
import {
  computeConsecutiveLossHalt,
  evaluateExposureCap,
  evaluateKellyStakeCap,
} from "../betting-safety.js";

describe("betting safety helpers", () => {
  it("rejects stake above the 3% bankroll Kelly cap", () => {
    expect(evaluateKellyStakeCap(3, 100, 0.03)).toEqual({ ok: true });
    expect(evaluateKellyStakeCap(3.01, 100, 0.03)).toMatchObject({
      ok: false,
      maxStake: 3,
    });
  });

  it("halts for 24h after three consecutive losing days", () => {
    const now = new Date("2026-05-13T12:00:00.000Z");
    const result = computeConsecutiveLossHalt([
      {
        status: "lost",
        profitLoss: -2,
        resolvedAt: new Date("2026-05-13T10:00:00.000Z"),
        placedAt: new Date("2026-05-13T09:00:00.000Z"),
      },
      {
        status: "lost",
        profitLoss: -2,
        resolvedAt: new Date("2026-05-12T10:00:00.000Z"),
        placedAt: new Date("2026-05-12T09:00:00.000Z"),
      },
      {
        status: "lost",
        profitLoss: -2,
        resolvedAt: new Date("2026-05-11T10:00:00.000Z"),
        placedAt: new Date("2026-05-11T09:00:00.000Z"),
      },
    ], now, 3, 24);

    expect(result).toMatchObject({
      active: true,
      losingDays: 3,
      haltUntil: new Date("2026-05-14T10:00:00.000Z"),
    });
  });

  it("stops counting losing-day streak at the first profitable day", () => {
    const now = new Date("2026-05-13T12:00:00.000Z");
    const result = computeConsecutiveLossHalt([
      {
        status: "lost",
        profitLoss: -2,
        resolvedAt: new Date("2026-05-13T10:00:00.000Z"),
        placedAt: new Date("2026-05-13T09:00:00.000Z"),
      },
      {
        status: "won",
        profitLoss: 3,
        resolvedAt: new Date("2026-05-12T10:00:00.000Z"),
        placedAt: new Date("2026-05-12T09:00:00.000Z"),
      },
      {
        status: "lost",
        profitLoss: -2,
        resolvedAt: new Date("2026-05-11T10:00:00.000Z"),
        placedAt: new Date("2026-05-11T09:00:00.000Z"),
      },
    ], now, 3, 24);

    expect(result).toEqual({ active: false });
  });

  it("rejects exposure that would exceed a sport or league cap", () => {
    expect(evaluateExposureCap(35, 5, 100, 0.4)).toEqual({ ok: true });
    expect(evaluateExposureCap(35, 6, 100, 0.4)).toMatchObject({
      ok: false,
      maxExposure: 40,
      projectedExposure: 41,
    });
  });
});
