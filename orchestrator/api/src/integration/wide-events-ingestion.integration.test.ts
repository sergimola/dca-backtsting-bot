/**
 * Wide Events Ingestion Integration Test (T033)
 *
 * Requires Docker ClickHouse running (docker-compose up clickhouse).
 * Validates:
 *   1. 1,000-line fixture file ingested → SELECT count() returns 1,000
 *   2. Re-run ingestion (idempotency) → count is still 1,000
 *
 * Skip condition: if CLICKHOUSE_HOST is not reachable, tests are skipped.
 */

import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { WideEventIngester } from '../services/WideEventIngester.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CH_HOST = process.env.CLICKHOUSE_HOST ?? 'localhost';
const CH_PORT = process.env.CLICKHOUSE_PORT ?? '18123';
const CH_DB = process.env.CLICKHOUSE_DATABASE ?? 'data';
const CH_USER = process.env.CLICKHOUSE_USER ?? 'default';
const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? '';

let client: ClickHouseClient;
let ingester: WideEventIngester;
let available = false;

function makeWideEventLine(runId: string, index: number): string {
  return JSON.stringify({
    schema_version: 1,
    run_id: runId,
    trade_id: '',
    timestamp: new Date(Date.now() + index * 60000).toISOString(),
    event_type: 'price_changed',
    symbol: 'BTCUSDC',
    candle_open: '50000.00000000',
    candle_high: '51000.00000000',
    candle_low: '49000.00000000',
    candle_close: '50500.00000000',
    candle_volume: '10.00000000',
    running_account_balance: '10000.00000000',
    global_candle_count: index + 1,
    position_state: '',
    average_entry_price: '0.00000000',
    position_quantity: '0.00000000',
    total_capital_deployed: '0.00000000',
    fees_accumulated: '0.00000000',
    take_profit_price: '0.00000000',
    liquidation_price: '0.00000000',
    filled_orders_count: 0,
    unrealized_pnl: '0.00000000',
    current_drawdown_pct: '0.00000000',
    action_price: '0.00000000',
    action_quantity: '0.00000000',
    action_fee: '0.00000000',
    order_number: 0,
    realized_pnl: '0.00000000',
    close_reason: '',
  });
}

beforeAll(async () => {
  client = createClient({
    url: `http://${CH_HOST}:${CH_PORT}`,
    username: CH_USER,
    password: CH_PASSWORD,
    database: CH_DB,
  });

  try {
    await client.query({ query: 'SELECT 1', format: 'JSONEachRow' });
    available = true;
  } catch {
    console.warn('[wide-events-ingestion] ClickHouse not available — skipping integration tests');
  }

  if (available) {
    // Create the wide_events table if it doesn't exist
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${CH_DB}.wide_events (
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

    ingester = new WideEventIngester(client, CH_DB);
  }
});

afterAll(async () => {
  if (client) await client.close();
});

describe('WideEventIngester ClickHouse Integration', () => {
  let tmpDir: string;
  const RUN_ID = `integ-test-${Date.now()}`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'we-integ-'));
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Clean up test data
    if (available) {
      await client.command({
        query: `ALTER TABLE ${CH_DB}.wide_events DROP PARTITION '${RUN_ID}'`,
      });
    }
  });

  it('ingests 1000-line fixture and verifies row count via SELECT', async () => {
    if (!available) return;

    // Write 1000-line fixture
    const lines = Array.from({ length: 1000 }, (_, i) => makeWideEventLine(RUN_ID, i));
    const filePath = path.join(tmpDir, `${RUN_ID}.jsonl`);
    fs.writeFileSync(filePath, lines.join('\n') + '\n');

    // Ingest
    const result = await ingester.ingest(RUN_ID, filePath);
    expect(result.rowsInserted).toBe(1000);

    // Verify via SELECT
    const rs = await client.query({
      query: `SELECT count() AS cnt FROM ${CH_DB}.wide_events WHERE run_id = {runId:String}`,
      query_params: { runId: RUN_ID },
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{ cnt: string }>();
    expect(parseInt(rows[0].cnt, 10)).toBe(1000);
  });

  it('re-ingest (idempotency) keeps count at 1000', async () => {
    if (!available) return;

    const lines = Array.from({ length: 1000 }, (_, i) => makeWideEventLine(RUN_ID, i));
    const filePath = path.join(tmpDir, `${RUN_ID}.jsonl`);
    fs.writeFileSync(filePath, lines.join('\n') + '\n');

    // First ingest
    await ingester.ingest(RUN_ID, filePath);

    // Second ingest (idempotent — drops partition then re-inserts)
    const result2 = await ingester.ingest(RUN_ID, filePath);
    expect(result2.rowsInserted).toBe(1000);

    // Verify count is still 1000, not 2000
    const rs = await client.query({
      query: `SELECT count() AS cnt FROM ${CH_DB}.wide_events WHERE run_id = {runId:String}`,
      query_params: { runId: RUN_ID },
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{ cnt: string }>();
    expect(parseInt(rows[0].cnt, 10)).toBe(1000);
  });
});
