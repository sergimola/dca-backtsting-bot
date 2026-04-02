CREATE TABLE "sweep_run_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"config_json" jsonb NOT NULL,
	"roi" numeric(10, 4),
	"max_drawdown" numeric(10, 4),
	"total_fees" numeric(10, 4),
	"win_rate" numeric(6, 4),
	"capital_efficiency" numeric(10, 4),
	"execution_time_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sweep_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trading_pair" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"max_roi" numeric(10, 4),
	"total_execution_time_ms" bigint,
	"status" text DEFAULT 'running' NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sweep_sessions_status_check" CHECK ("sweep_sessions"."status" IN ('running','completed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "sweep_run_summaries" ADD CONSTRAINT "sweep_run_summaries_session_id_sweep_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sweep_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sweep_run_summaries_session_id_idx" ON "sweep_run_summaries" USING btree ("session_id");