import { chClient, database } from './ClickHouseClient.js';

export interface GapResult {
  hasGap: boolean;
  expectedCount: number;
  actualCount: number;
}

/**
 * GapResolver checks whether ClickHouse has full 1-minute OHLCV coverage for
 * a given symbol and date range.
 *
 * Constitution requirement: gap detection MUST use COUNT(*) FINAL — never MIN/MAX
 * alone (swiss-cheese prevention). The FINAL keyword forces synchronous dedup on
 * ReplacingMergeTree so the count reflects the true candle population.
 *
 * Swiss-cheese defence (two-stage check):
 * 1. Ledger check: if market_data_syncs contains a record covering [start, end]
 *    for this symbol, any row deficit is legitimate Binance downtime — accept and
 *    proceed without re-downloading (prevents infinite download loops).
 * 2. COUNT(*) FINAL: fall back to the mathematical count check only when no
 *    prior sync receipt exists.
 */
export class GapResolver {
  /**
   * Returns { hasGap: true } if the stored candle count is less than the
   * expected 1-minute count for the range [start, end] AND no sync receipt
   * exists covering the range in market_data_syncs.
   */
  async check(symbol: string, start: Date, end: Date): Promise<GapResult> {
    const startMs = start.getTime();
    const endMs = end.getTime();
    const expectedCount = Math.floor((endMs - startMs) / 60_000) + 1;

    // Stage 1: Check sync ledger — if the range was previously downloaded,
    // trust it and skip the COUNT math to avoid re-downloading Binance downtime gaps.
    const ledgerSet = await chClient.query({
      query: `
        SELECT 1
        FROM ${database}.market_data_syncs FINAL
        WHERE symbol = {symbol:String}
          AND synced_from <= {start:DateTime64(3)}
          AND synced_to >= {end:DateTime64(3)}
        LIMIT 1
      `,
      query_params: { symbol, start: startMs, end: endMs },
      format: 'JSONEachRow',
    });
    const ledgerRows = await ledgerSet.json<Record<string, number>>();
    if (ledgerRows.length > 0) {
      return { hasGap: false, expectedCount, actualCount: expectedCount };
    }

    // Stage 2: No prior sync — fall back to COUNT(*) FINAL math.
    const resultSet = await chClient.query({
      query: `
        SELECT toUInt64(COUNT(*)) AS cnt
        FROM ${database}.market_data FINAL
        WHERE symbol = {symbol:String}
          AND timestamp >= {start:DateTime64(3)}
          AND timestamp <= {end:DateTime64(3)}
      `,
      query_params: {
        symbol,
        start: startMs,
        end: endMs,
      },
      format: 'JSONEachRow',
    });

    const rows = await resultSet.json<{ cnt: string }>();
    const actualCount = rows.length > 0 ? parseInt(rows[0].cnt, 10) : 0;

    return {
      hasGap: actualCount < expectedCount,
      expectedCount,
      actualCount,
    };
  }
}
