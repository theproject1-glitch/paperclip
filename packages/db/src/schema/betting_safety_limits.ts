import { pgTable, uuid, timestamp, doublePrecision, integer, boolean, index, unique } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bettingSafetyLimits = pgTable(
  "betting_safety_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    kellyStakeCapPct: doublePrecision("kelly_stake_cap_pct").notNull().default(0.03),
    consecutiveLosingDaysThreshold: integer("consecutive_losing_days_threshold").notNull().default(3),
    consecutiveLossHaltHours: integer("consecutive_loss_halt_hours").notNull().default(24),
    lifetimeStopLossFloorPct: doublePrecision("lifetime_stop_loss_floor_pct").notNull().default(0.7),
    sportExposureCapPct: doublePrecision("sport_exposure_cap_pct").notNull().default(0.4),
    leagueExposureCapPct: doublePrecision("league_exposure_cap_pct").notNull().default(0.25),
    safetyEnabled: boolean("safety_enabled").notNull().default(true),
    lifetimeStopLossEnabled: boolean("lifetime_stop_loss_enabled").notNull().default(true),
    concentrationLimitsEnabled: boolean("concentration_limits_enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUniq: unique("betting_safety_limits_company_uniq").on(table.companyId),
    companyUpdatedIdx: index("betting_safety_limits_company_updated_idx").on(table.companyId, table.updatedAt),
  }),
);
