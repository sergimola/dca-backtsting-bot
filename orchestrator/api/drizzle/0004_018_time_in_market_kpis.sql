ALTER TABLE "sweep_run_summaries" ADD COLUMN "longest_trade_duration_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sweep_run_summaries" ADD COLUMN "max_safety_orders_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sweep_run_summaries" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_sweep_run_summaries_session_promoted" ON "sweep_run_summaries" USING btree ("session_id","promoted_at");