ALTER TABLE "betting_predictions" ADD COLUMN "edge" double precision;
--> statement-breakpoint
ALTER TABLE "betting_predictions" ADD COLUMN "recommended_stake" double precision;
--> statement-breakpoint
ALTER TABLE "betting_predictions" ADD COLUMN "created_by_agent" text;
--> statement-breakpoint
CREATE TABLE "betting_performance_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"report_date" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "betting_performance_reports" ADD CONSTRAINT "betting_performance_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "betting_performance_reports_company_report_date_idx" ON "betting_performance_reports" USING btree ("company_id","report_date");
