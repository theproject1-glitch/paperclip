import type { Db } from "@paperclipai/db";
import { bettingBankrollSnapshots, bettingPlacedBets, bettingSafetyLimits } from "@paperclipai/db";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";

const DEFAULT_LIMITS = {
  kellyStakeCapPct: 0.03,
  consecutiveLosingDaysThreshold: 3,
  consecutiveLossHaltHours: 24,
  lifetimeStopLossFloorPct: 0.7,
  sportExposureCapPct: 0.4,
  leagueExposureCapPct: 0.25,
  safetyEnabled: true,
  lifetimeStopLossEnabled: true,
  concentrationLimitsEnabled: true,
};

type SafetyLimits = typeof DEFAULT_LIMITS;

export type BettingSafetyBet = {
  stake: number;
  sport?: string | null;
  league?: string | null;
  betType?: string | null;
};

export type BettingSafetyDecision =
  | { allowed: true; warnings: string[] }
  | {
      allowed: false;
      httpStatus: 422 | 423;
      error: string;
      message: string;
      details: Record<string, unknown>;
    };

type ResolvedBetRow = {
  status: string;
  profitLoss: number | null;
  resolvedAt: Date | null;
  placedAt: Date;
};

function canQuery(db: unknown): db is Db {
  return typeof (db as { select?: unknown } | null)?.select === "function";
}

function normalizeKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function evaluateKellyStakeCap(
  stake: number,
  bankroll: number,
  capPct = DEFAULT_LIMITS.kellyStakeCapPct,
): { ok: true } | { ok: false; maxStake: number } {
  const maxStake = bankroll * capPct;
  return stake <= maxStake + 0.000001 ? { ok: true } : { ok: false, maxStake };
}

export function computeConsecutiveLossHalt(
  rows: ResolvedBetRow[],
  now: Date,
  threshold = DEFAULT_LIMITS.consecutiveLosingDaysThreshold,
  haltHours = DEFAULT_LIMITS.consecutiveLossHaltHours,
): { active: false } | { active: true; losingDays: number; haltUntil: Date } {
  const byDay = new Map<string, { profitLoss: number; latestAt: Date }>();
  for (const row of rows) {
    const at = row.resolvedAt ?? row.placedAt;
    const key = at.toISOString().slice(0, 10);
    const current = byDay.get(key);
    const profitLoss = row.profitLoss ?? (row.status === "lost" ? -1 : 0);
    if (!current) {
      byDay.set(key, { profitLoss, latestAt: at });
    } else {
      current.profitLoss += profitLoss;
      if (at > current.latestAt) current.latestAt = at;
    }
  }

  const days = [...byDay.entries()]
    .map(([day, value]) => ({ day, ...value }))
    .sort((a, b) => b.day.localeCompare(a.day));
  let losingDays = 0;
  let latestLossAt: Date | null = null;
  for (const day of days) {
    if (day.profitLoss >= 0) break;
    losingDays += 1;
    if (!latestLossAt || day.latestAt > latestLossAt) latestLossAt = day.latestAt;
    if (losingDays >= threshold) break;
  }

  if (losingDays < threshold || !latestLossAt) return { active: false };
  const haltUntil = new Date(latestLossAt.getTime() + haltHours * 60 * 60 * 1000);
  return haltUntil > now ? { active: true, losingDays, haltUntil } : { active: false };
}

export function evaluateExposureCap(
  currentExposure: number,
  proposedStake: number,
  bankroll: number,
  capPct: number,
): { ok: true } | { ok: false; maxExposure: number; projectedExposure: number } {
  const maxExposure = bankroll * capPct;
  const projectedExposure = currentExposure + proposedStake;
  return projectedExposure <= maxExposure + 0.000001
    ? { ok: true }
    : { ok: false, maxExposure, projectedExposure };
}

async function getSafetyLimits(db: Db, companyId: string): Promise<SafetyLimits> {
  const [row] = await db
    .select()
    .from(bettingSafetyLimits)
    .where(eq(bettingSafetyLimits.companyId, companyId))
    .limit(1);
  if (!row) return DEFAULT_LIMITS;
  return {
    kellyStakeCapPct: row.kellyStakeCapPct,
    consecutiveLosingDaysThreshold: row.consecutiveLosingDaysThreshold,
    consecutiveLossHaltHours: row.consecutiveLossHaltHours,
    lifetimeStopLossFloorPct: row.lifetimeStopLossFloorPct,
    sportExposureCapPct: row.sportExposureCapPct,
    leagueExposureCapPct: row.leagueExposureCapPct,
    safetyEnabled: row.safetyEnabled,
    lifetimeStopLossEnabled: row.lifetimeStopLossEnabled,
    concentrationLimitsEnabled: row.concentrationLimitsEnabled,
  };
}

async function getLatestBalance(db: Db, companyId: string): Promise<number | null> {
  const [latest] = await db
    .select({ balance: bettingBankrollSnapshots.balance })
    .from(bettingBankrollSnapshots)
    .where(eq(bettingBankrollSnapshots.companyId, companyId))
    .orderBy(desc(bettingBankrollSnapshots.snapshotAt))
    .limit(1);
  return latest?.balance ?? null;
}

async function getInitialBalance(db: Db, companyId: string): Promise<number | null> {
  const [initial] = await db
    .select({ balance: bettingBankrollSnapshots.balance })
    .from(bettingBankrollSnapshots)
    .where(eq(bettingBankrollSnapshots.companyId, companyId))
    .orderBy(asc(bettingBankrollSnapshots.snapshotAt))
    .limit(1);
  return initial?.balance ?? null;
}

export async function evaluateBettingSafetyGuards(
  db: Db,
  companyId: string,
  bet: BettingSafetyBet,
  currentBalance: number | null,
  now = new Date(),
): Promise<BettingSafetyDecision> {
  if (!canQuery(db)) return { allowed: true, warnings: ["db_unavailable_for_safety_checks"] };

  const limits = await getSafetyLimits(db, companyId);
  if (!limits.safetyEnabled) return { allowed: true, warnings: ["safety_limits_disabled"] };

  const bankroll = currentBalance ?? await getLatestBalance(db, companyId);
  if (bankroll == null || bankroll <= 0) {
    return { allowed: true, warnings: ["bankroll_unavailable_for_safety_checks"] };
  }

  const kelly = evaluateKellyStakeCap(bet.stake, bankroll, limits.kellyStakeCapPct);
  if (!kelly.ok) {
    return {
      allowed: false,
      httpStatus: 422,
      error: "stake_exceeds_kelly_cap",
      message: `Stake exceeds ${Math.round(limits.kellyStakeCapPct * 100)}% bankroll cap.`,
      details: { stake: bet.stake, bankroll, maxStake: kelly.maxStake },
    };
  }

  if (limits.lifetimeStopLossEnabled) {
    const initialBalance = await getInitialBalance(db, companyId);
    if (initialBalance != null && bankroll < initialBalance * limits.lifetimeStopLossFloorPct) {
      return {
        allowed: false,
        httpStatus: 423,
        error: "lifetime_stop_loss_triggered",
        message: "Lifetime stop-loss floor reached; operator manual unlock is required.",
        details: {
          bankroll,
          initialBalance,
          floorBalance: initialBalance * limits.lifetimeStopLossFloorPct,
        },
      };
    }
  }

  const recentResolved = await db
    .select({
      status: bettingPlacedBets.status,
      profitLoss: bettingPlacedBets.profitLoss,
      resolvedAt: bettingPlacedBets.resolvedAt,
      placedAt: bettingPlacedBets.placedAt,
    })
    .from(bettingPlacedBets)
    .where(and(
      eq(bettingPlacedBets.companyId, companyId),
      inArray(bettingPlacedBets.status, ["won", "lost"]),
    ))
    .orderBy(desc(bettingPlacedBets.resolvedAt))
    .limit(200);
  const halt = computeConsecutiveLossHalt(
    recentResolved,
    now,
    limits.consecutiveLosingDaysThreshold,
    limits.consecutiveLossHaltHours,
  );
  if (halt.active) {
    return {
      allowed: false,
      httpStatus: 423,
      error: "consecutive_loss_halt_active",
      message: "Consecutive losing-day halt is active.",
      details: { losingDays: halt.losingDays, haltUntil: halt.haltUntil.toISOString() },
    };
  }

  if (limits.concentrationLimitsEnabled) {
    const sport = normalizeKey(bet.sport);
    const league = normalizeKey(bet.league);
    if (sport || league) {
      const today = await db
        .select({
          sport: bettingPlacedBets.sport,
          league: bettingPlacedBets.league,
          stake: bettingPlacedBets.stake,
        })
        .from(bettingPlacedBets)
        .where(and(
          eq(bettingPlacedBets.companyId, companyId),
          gte(bettingPlacedBets.placedAt, startOfUtcDay(now)),
        ));
      if (sport) {
        const currentSportExposure = today
          .filter((row) => normalizeKey(row.sport) === sport)
          .reduce((sum, row) => sum + row.stake, 0);
        const sportCap = evaluateExposureCap(currentSportExposure, bet.stake, bankroll, limits.sportExposureCapPct);
        if (!sportCap.ok) {
          return {
            allowed: false,
            httpStatus: 422,
            error: "sport_exposure_limit_exceeded",
            message: "Proposed bet exceeds today's per-sport exposure cap.",
            details: { sport, bankroll, currentExposure: currentSportExposure, ...sportCap },
          };
        }
      }
      if (league) {
        const currentLeagueExposure = today
          .filter((row) => normalizeKey(row.league) === league)
          .reduce((sum, row) => sum + row.stake, 0);
        const leagueCap = evaluateExposureCap(currentLeagueExposure, bet.stake, bankroll, limits.leagueExposureCapPct);
        if (!leagueCap.ok) {
          return {
            allowed: false,
            httpStatus: 422,
            error: "league_exposure_limit_exceeded",
            message: "Proposed bet exceeds today's per-league exposure cap.",
            details: { league, bankroll, currentExposure: currentLeagueExposure, ...leagueCap },
          };
        }
      }
    }
  }

  return { allowed: true, warnings: [] };
}
