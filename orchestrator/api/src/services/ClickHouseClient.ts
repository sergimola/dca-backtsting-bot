import { createClient, ClickHouseClient } from '@clickhouse/client';

const host = process.env.CLICKHOUSE_HOST ?? 'localhost';
const port = process.env.CLICKHOUSE_PORT ?? '8123';
const username = process.env.CLICKHOUSE_USER ?? 'admin';
const password = process.env.CLICKHOUSE_PASSWORD ?? 'admin';
export const database = process.env.CLICKHOUSE_DATABASE ?? 'data';

// Singleton ClickHouse HTTP client — shared across all services.
// The @clickhouse/client connection is request-scoped (stateless HTTP), so a
// single instance is safe under concurrent use.
//
// keep_alive.enabled = false: Node.js http.Agent with keepAlive:true hangs on
// Windows + Docker Desktop (WSL2 backend) due to a TCP keep-alive probe issue.
// Disabling keep-alive uses a fresh socket per request, which is slightly slower
// but avoids indefinite connection hangs.
export const chClient: ClickHouseClient = createClient({
  url: `http://${host}:${port}`,
  username,
  password,
  database,
  keep_alive: { enabled: false },
  clickhouse_settings: {
    // Ensure we see deduplicated rows in gap-detection queries
    final: 1,
  },
});

/**
 * pingClickHouse runs a lightweight SELECT 1 against ClickHouse to verify
 * the connection is healthy. Called once at server startup.
 * Throws on connection failure so the process exits with a clear error.
 *
 * Retries up to 5 times with 2s delay to tolerate transient Docker/network
 * hiccups during startup (e.g., ClickHouse HTTP server not yet ready).
 */
export async function pingClickHouse(): Promise<void> {
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 2_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await chClient.query({
        query: 'SELECT 1',
        format: 'JSONEachRow',
      });
      await result.json(); // consume the response to confirm transport works
      return;
    } catch (err: any) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        console.warn(`[clickhouse] Ping failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw lastErr;
}

export async function initClickHouseSchema(): Promise<void> {
  await chClient.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${database}.wide_events (
        schema_version    UInt8,
        run_id            String,
        trade_id          String,
        timestamp         DateTime64(3, 'UTC'),
        event_type        LowCardinality(String),
        symbol            LowCardinality(String),
        candle_open       Decimal128(8),
        candle_high       Decimal128(8),
        candle_low        Decimal128(8),
        candle_close      Decimal128(8),
        candle_volume     Decimal128(8),
        running_account_balance Decimal128(8),
        global_candle_count UInt32,
        position_state    LowCardinality(String),
        average_entry_price Decimal128(8),
        position_quantity Decimal128(8),
        total_capital_deployed Decimal128(8),
        fees_accumulated  Decimal128(8),
        take_profit_price Decimal128(8),
        liquidation_price Decimal128(8),
        filled_orders_count UInt16,
        unrealized_pnl    Decimal128(8),
        current_drawdown_pct Decimal128(8),
        action_price      Decimal128(8),
        action_quantity   Decimal128(8),
        action_fee        Decimal128(8),
        order_number      UInt16,
        realized_pnl      Decimal128(8),
        close_reason      LowCardinality(String)
      )
      ENGINE = ReplacingMergeTree()
      PARTITION BY run_id
      ORDER BY (run_id, timestamp, event_type)
    `,
  });
  // Idempotent schema migration: add stop-loss columns to sweep_wide_events if missing.
  // Uses IF NOT EXISTS so this is safe on both fresh installs and upgrades.
  await chClient.command({
    query: `ALTER TABLE ${database}.sweep_wide_events ADD COLUMN IF NOT EXISTS realized_pnl Decimal64(8) DEFAULT 0`,
  });
  await chClient.command({
    query: `ALTER TABLE ${database}.sweep_wide_events ADD COLUMN IF NOT EXISTS close_reason LowCardinality(String) DEFAULT ''`,
  });
}