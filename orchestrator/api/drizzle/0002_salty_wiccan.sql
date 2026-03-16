ALTER TABLE "backtests" ADD COLUMN "progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "backtests" ADD COLUMN "current_metrics" jsonb;