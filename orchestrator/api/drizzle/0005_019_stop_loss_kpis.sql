ALTER TABLE "sweep_run_summaries"
  ADD COLUMN IF NOT EXISTS "total_stops_triggered" integer DEFAULT 0 NOT NULL;
