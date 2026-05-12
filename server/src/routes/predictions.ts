import { randomUUID } from "node:crypto";
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  bettingBankrollSnapshots,
  bettingMatches,
  bettingPerformanceReports,
  bettingPlacedBets,
  bettingPredictions,
  type Db,
} from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function dateValue(value: unknown, fallback = new Date()): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return fallback;
}

async function ensureMatch(db: Db, companyId: string, body: Record<string, unknown>) {
  const match = objectBody(body.match);
  const externalId = stringValue(match.externalId ?? body.eventId, randomUUID());
  const [row] = await db
    .insert(bettingMatches)
    .values({
      companyId,
      externalId,
      sport: stringValue(match.sport ?? body.sport, "unknown"),
      league: stringValue(match.league ?? body.league, "unknown"),
      homeTeam: stringValue(match.homeTeam ?? body.homeTeam, "Home"),
      awayTeam: stringValue(match.awayTeam ?? body.awayTeam, "Away"),
      startsAt: dateValue(match.startsAt ?? body.startsAt ?? body.commenceTime),
      status: stringValue(match.status, "upcoming"),
      oddsJson: objectBody(body.oddsJson ?? body.odds),
      updatedAt: new Date(),
    })
    .returning({ id: bettingMatches.id });
  return row!.id;
}

export function predictionRoutes(db: Db) {
  const router = Router();

  router.post("/companies/:companyId/predictions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = objectBody(req.body);
    const matchId = typeof body.matchId === "string" ? body.matchId : await ensureMatch(db, companyId, body);
    const [prediction] = await db
      .insert(bettingPredictions)
      .values({
        companyId,
        matchId,
        agentId: typeof body.agentId === "string" ? body.agentId : null,
        prediction: stringValue(body.prediction ?? body.selection, "unknown"),
        confidence: numberValue(body.confidence, 0),
        expectedValue: typeof body.expectedValue === "number" ? body.expectedValue : numberValue(body.ev, 0),
        edge: typeof body.edge === "number" ? body.edge : null,
        recommendedStake: typeof body.recommendedStake === "number" ? body.recommendedStake : numberValue(body.stake, 0),
        targetOdds: typeof body.targetOdds === "number" ? body.targetOdds : numberValue(body.odds, 0),
        createdByAgent: stringValue(body.createdByAgent, "python"),
        reasoning: typeof body.reasoning === "string" ? body.reasoning : null,
        status: stringValue(body.status, "pending"),
        updatedAt: new Date(),
      })
      .returning();
    res.status(201).json(prediction);
  });

  router.get("/companies/:companyId/predictions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const rows = await db
      .select()
      .from(bettingPredictions)
      .where(status ? and(eq(bettingPredictions.companyId, companyId), eq(bettingPredictions.status, status)) : eq(bettingPredictions.companyId, companyId))
      .orderBy(desc(bettingPredictions.createdAt))
      .limit(100);
    res.json(rows);
  });

  router.patch("/companies/:companyId/predictions/:predictionId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const predictionId = req.params.predictionId as string;
    assertCompanyAccess(req, companyId);
    const body = objectBody(req.body);
    const status = stringValue(body.status, "");
    if (!status) return res.status(400).json({ error: "status_required" });
    const [prediction] = await db
      .update(bettingPredictions)
      .set({
        status,
        reasoning: typeof body.reasoning === "string" ? body.reasoning : undefined,
        resolvedAt: ["approved", "rejected", "executed"].includes(status) ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(bettingPredictions.companyId, companyId), eq(bettingPredictions.id, predictionId)))
      .returning();
    if (!prediction) return res.status(404).json({ error: "prediction_not_found" });
    res.json(prediction);
  });

  router.post("/companies/:companyId/bankroll", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = objectBody(req.body);
    const [snapshot] = await db
      .insert(bettingBankrollSnapshots)
      .values({
        companyId,
        balance: numberValue(body.balance ?? body.current_bankroll),
        currency: stringValue(body.currency, "RON"),
        snapshotAt: dateValue(body.snapshotAt ?? body.createdAt),
        totalBets: numberValue(body.totalBets ?? body.today_bets_count),
        wonBets: numberValue(body.wonBets),
        lostBets: numberValue(body.lostBets),
        voidBets: numberValue(body.voidBets),
        totalStaked: numberValue(body.totalStaked ?? body.today_staked),
        totalReturn: numberValue(body.totalReturn),
        roi: typeof body.roi === "number" ? body.roi : null,
      })
      .returning();
    res.status(201).json(snapshot);
  });

  router.post("/companies/:companyId/placed-bets", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = objectBody(req.body);
    const [placed] = await db
      .insert(bettingPlacedBets)
      .values({
        companyId,
        predictionId: typeof body.predictionId === "string" ? body.predictionId : null,
        bookmaker: stringValue(body.bookmaker, "Casa Pariurilor"),
        odds: numberValue(body.odds),
        stake: numberValue(body.stake),
        currency: stringValue(body.currency, "RON"),
        idempotencyKey: stringValue(body.idempotencyKey, randomUUID()),
        status: stringValue(body.status, "pending"),
        executionStatus: stringValue(body.executionStatus, "recorded"),
        executionLedger: objectBody(body.executionLedger ?? body),
        profitLoss: typeof body.profitLoss === "number" ? body.profitLoss : null,
        placedAt: dateValue(body.placedAt),
        resolvedAt: body.resolvedAt ? dateValue(body.resolvedAt) : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        updatedAt: new Date(),
      })
      .returning();
    res.status(201).json(placed);
  });

  router.post("/companies/:companyId/performance-reports", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const body = objectBody(req.body);
    const [report] = await db
      .insert(bettingPerformanceReports)
      .values({
        companyId,
        reportDate: stringValue(body.reportDate ?? body.date, new Date().toISOString().slice(0, 10)),
        payload: body,
      })
      .returning();
    res.status(201).json(report);
  });

  return router;
}
