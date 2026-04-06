-- Migration 0006: Add annualized_return to sweep_run_summaries (feature 020)
ALTER TABLE sweep_run_summaries
  ADD COLUMN IF NOT EXISTS annualized_return numeric(10,4);
