import { chClient } from './ClickHouseClient.js';

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
 */
export class GapResolver {
  /**
   * Returns { hasGap: true } if the stored candle count is less than the
   * expected 1-minute count for the range [start, end].
   */
  async check(symbol: string, start: Date, end: Date): Promise<GapResult> {
    const startMs = start.getTime();
    const endMs = end.getTime();
    const expectedCount = Math.floor((endMs - startMs) / 60_000) + 1;

    const resultSet = await chClient.query({
      query: `
        SELECT toUInt64(COUNT(*)) AS cnt
        FROM dca_bot.market_data FINAL
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
