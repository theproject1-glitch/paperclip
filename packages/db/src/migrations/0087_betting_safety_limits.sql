CREATE TABLE "betting_safety_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kelly_stake_cap_pct" double precision DEFAULT 0.03 NOT NULL,
	"consecutive_losing_days_threshold" integer DEFAULT 3 NOT NULL,
	"consecutive_loss_halt_hours" integer DEFAULT 24 NOT NULL,
	"lifetime_stop_loss_floor_pct" double precision DEFAULT 0.7 NOT NULL,
	"sport_exposure_cap_pct" double precision DEFAULT 0.4 NOT NULL,
	"league_exposure_cap_pct" double precision DEFAULT 0.25 NOT NULL,
	"safety_enabled" boolean DEFAULT true NOT NULL,
	"lifetime_stop_loss_enabled" boolean DEFAULT true NOT NULL,
	"concentration_limits_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "betting_safety_limits_company_uniq" UNIQUE("company_id")
);
--> statement-breakpoint
ALTER TABLE "betting_safety_limits" ADD CONSTRAINT "betting_safety_limits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "betting_safety_limits_company_updated_idx" ON "betting_safety_limits" USING btree ("company_id","updated_at");
--> statement-breakpoint
ALTER TABLE "betting_placed_bets" ADD COLUMN "sport" text;
--> statement-breakpoint
ALTER TABLE "betting_placed_bets" ADD COLUMN "league" text;
--> statement-breakpoint
ALTER TABLE "betting_placed_bets" ADD COLUMN "bet_type" text;
--> statement-breakpoint
CREATE INDEX "betting_placed_bets_company_sport_placed_at_idx" ON "betting_placed_bets" USING btree ("company_id","sport","placed_at");
--> statement-breakpoint
CREATE INDEX "betting_placed_bets_company_league_placed_at_idx" ON "betting_placed_bets" USING btree ("company_id","league","placed_at");
