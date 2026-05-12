import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { bettingCalibrationSignals, type Db } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";

function bodyObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw Object.assign(new Error(`${name}_required`), { status: 400 });
  return value.trim();
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function bettingCalibrationRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/betting-calibration", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const sport = typeof req.query.sport === "string" ? req.query.sport : null;
    const league = typeof req.query.league === "string" ? req.query.league : null;
    const betType = typeof req.query.betType === "string" ? req.query.betType : null;
    const filters = [eq(bettingCalibrationSignals.companyId, companyId)];
    if (sport) filters.push(eq(bettingCalibrationSignals.sport, sport));
    if (league) filters.push(eq(bettingCalibrationSignals.league, league));
    if (betType) filters.push(eq(bettingCalibrationSignals.betType, betType));
    const rows = await db
      .select()
      .from(bettingCalibrationSignals)
      .where(and(...filters))
      .orderBy(desc(bettingCalibrationSignals.computedAt))
      .limit(200);
    res.json(rows);
  });

  router.post("/companies/:companyId/betting-calibration", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = bodyObject(req.body);
    const [signal] = await db
      .insert(bettingCalibrationSignals)
      .values({
        companyId,
        sport: requiredString(body.sport, "sport"),
        league: requiredString(body.league, "league"),
        betType: requiredString(body.betType ?? body.bet_type, "betType"),
        sampleSize: Math.max(0, Math.round(numberValue(body.sampleSize ?? body.sample_size))),
        actualWinRate: numberValue(body.actualWinRate ?? body.actual_win_rate),
        avgEstimatedProb: numberValue(body.avgEstimatedProb ?? body.avg_estimated_prob),
        calibrationError: numberValue(body.calibrationError ?? body.calibration_error),
        adjustmentFactor: numberValue(body.adjustmentFactor ?? body.adjustment_factor, 1),
        computedAt: new Date(),
      })
      .returning();
    res.status(201).json(signal);
  });

  return router;
}
