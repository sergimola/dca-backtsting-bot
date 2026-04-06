/**
 * Drizzle ORM Schema (T005)
 *
 * Tables:
 * - backtests: async job queue for backtest execution
 * - market_data_syncs: ledger of completed Binance downloads (replaces ClickHouse syncs table)
 */

import { pgTable, uuid, text, jsonb, integer, bigint, numeric, timestamp, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ApiBacktestRequest, StoredPnlSummary, StoredTradeEvent, ProgressLine, SafetyOrderUsageEntry } from '../types/index.js';

// ---------------------------------------------------------------------------
// backtests
// ---------------------------------------------------------------------------
export const backtests = pgTable('backtests', {
  id:              uuid('id').primaryKey().defaultRandom(),
  status:          text('status').notNull().default('pending'),
  config:          jsonb('config').notNull().$type<ApiBacktestRequest>(),
  summary:         jsonb('summary').$type<StoredPnlSummary | null>(),
  trades:          jsonb('trades').$type<StoredTradeEvent[] | null>(),
  safetyOrders:    jsonb('safety_orders').$type<SafetyOrderUsageEntry[] | null>(),
  executionTimeMs: integer('execution_time_ms'),
  errorMessage:    text('error_message'),
  progress:        integer('progress').notNull().default(0),
  currentMetrics:  jsonb('current_metrics').$type<ProgressLine | null>(),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('backtests_status_check',
    sql`${t.status} IN ('pending','running','completed','failed')`),
]);

export type BacktestRow = typeof backtests.$inferSelect;
export type InsertBacktest = typeof backtests.$inferInsert;

// ---------------------------------------------------------------------------
// market_data_syncs
// ---------------------------------------------------------------------------
export const marketDataSyncs = pgTable('market_data_syncs', {
  id:        uuid('id').primaryKey().defaultRandom(),
  symbol:    text('symbol').notNull(),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate:   timestamp('end_date', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MarketDataSyncRow = typeof marketDataSyncs.$inferSelect;

// ---------------------------------------------------------------------------
// sweep_sessions  (T004)
// ---------------------------------------------------------------------------
export const sweepSessions = pgTable('sweep_sessions', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tradingPair:          text('trading_pair').notNull(),
  startDate:            text('start_date').notNull(),
  endDate:              text('end_date').notNull(),
  totalRuns:            integer('total_runs').notNull().default(0),
  maxRoi:               numeric('max_roi', { precision: 10, scale: 4 }),
  totalExecutionTimeMs: bigint('total_execution_time_ms', { mode: 'number' }),
  status:               text('status').notNull().default('running'),
  configSnapshot:       jsonb('config_snapshot').notNull(),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('sweep_sessions_status_check',
    sql`${t.status} IN ('running','completed','cancelled')`),
]);

export type SweepSessionRow = typeof sweepSessions.$inferSelect;
export type InsertSweepSession = typeof sweepSessions.$inferInsert;

// ---------------------------------------------------------------------------
// sweep_run_summaries  (T005)
// ---------------------------------------------------------------------------
export const sweepRunSummaries = pgTable('sweep_run_summaries', {
  id:              uuid('id').primaryKey().defaultRandom(),
  sessionId:       uuid('session_id').notNull().references(() => sweepSessions.id, { onDelete: 'cascade' }),
  runId:           text('run_id').notNull(),
  configJson:      jsonb('config_json').notNull(),
  roi:             numeric('roi', { precision: 10, scale: 4 }),
  maxDrawdown:     numeric('max_drawdown', { precision: 10, scale: 4 }),
  totalFees:       numeric('total_fees', { precision: 10, scale: 4 }),
  winRate:         numeric('win_rate', { precision: 6, scale: 4 }),
  capitalEfficiency: numeric('capital_efficiency', { precision: 10, scale: 4 }),
  executionTimeMs: bigint('execution_time_ms', { mode: 'number' }),
  longestTradeDurationMs: bigint('longest_trade_duration_ms', { mode: 'number' }).notNull().default(0),
  maxSafetyOrdersUsed:    integer('max_safety_orders_used').notNull().default(0),
  totalStopsTriggered:    integer('total_stops_triggered').notNull().default(0),
  annualizedReturn:       numeric('annualized_return', { precision: 10, scale: 4 }),
  promotedAt:             timestamp('promoted_at', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('sweep_run_summaries_session_id_idx').on(t.sessionId),
  index('idx_sweep_run_summaries_session_promoted').on(t.sessionId, t.promotedAt),
]);

export type SweepRunSummaryRow = typeof sweepRunSummaries.$inferSelect;
export type InsertSweepRunSummary = typeof sweepRunSummaries.$inferInsert;
