import { pgTable, uuid, text, timestamp, doublePrecision, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const bettingCalibrationSignals = pgTable(
  "betting_calibration_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    sport: text("sport").notNull(),
    league: text("league").notNull(),
    betType: text("bet_type").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    sampleSize: integer("sample_size").notNull().default(0),
    actualWinRate: doublePrecision("actual_win_rate").notNull(),
    avgEstimatedProb: doublePrecision("avg_estimated_prob").notNull(),
    calibrationError: doublePrecision("calibration_error").notNull(),
    adjustmentFactor: doublePrecision("adjustment_factor").notNull().default(1),
  },
  (table) => ({
    companyBucketIdx: index("betting_calibration_signals_company_bucket_idx").on(
      table.companyId,
      table.sport,
      table.league,
      table.betType,
      table.computedAt,
    ),
  }),
);
