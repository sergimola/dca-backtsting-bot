/**
 * Drizzle ORM Schema (T005)
 *
 * Tables:
 * - backtests: async job queue for backtest execution
 * - market_data_syncs: ledger of completed Binance downloads (replaces ClickHouse syncs table)
 */

import { pgTable, uuid, text, jsonb, integer, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ApiBacktestRequest, StoredPnlSummary, StoredTradeEvent } from '../types/index.js';

// ---------------------------------------------------------------------------
// backtests
// ---------------------------------------------------------------------------
export const backtests = pgTable('backtests', {
  id:              uuid('id').primaryKey().defaultRandom(),
  status:          text('status').notNull().default('pending'),
  config:          jsonb('config').notNull().$type<ApiBacktestRequest>(),
  summary:         jsonb('summary').$type<StoredPnlSummary | null>(),
  trades:          jsonb('trades').$type<StoredTradeEvent[] | null>(),
  safetyOrders:    jsonb('safety_orders').$type<Record<string, unknown>[] | null>(),
  executionTimeMs: integer('execution_time_ms'),
  errorMessage:    text('error_message'),
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
