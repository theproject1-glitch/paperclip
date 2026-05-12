CREATE TABLE "betting_calibration_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sport" text NOT NULL,
	"league" text NOT NULL,
	"bet_type" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"actual_win_rate" double precision NOT NULL,
	"avg_estimated_prob" double precision NOT NULL,
	"calibration_error" double precision NOT NULL,
	"adjustment_factor" double precision DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "betting_calibration_signals" ADD CONSTRAINT "betting_calibration_signals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "betting_calibration_signals_company_bucket_idx" ON "betting_calibration_signals" USING btree ("company_id","sport","league","bet_type","computed_at");
