import { chClient, database } from './ClickHouseClient.js';
import { SyncLedgerRepository } from './SyncLedgerRepository.js';

export interface GapResult {
  hasGap: boolean;
  expectedCount: number;
  actualCount: number;
  /** When hasGap is true, the timestamp just after the last available candle.
   *  Callers can start downloading from here instead of from range start. */
  gapStart?: Date;
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
  private readonly syncLedger: SyncLedgerRepository;

  constructor(syncLedger?: SyncLedgerRepository) {
    // Allow injecting a custom SyncLedgerRepository for testing; fall back to default instance
    this.syncLedger = syncLedger ?? new SyncLedgerRepository();
  }

  /**
   * Returns { hasGap: true } if the stored candle count is less than the
   * expected 1-minute count for the range [start, end] AND no sync receipt
   * exists covering the range in market_data_syncs.
   */
  async check(symbol: string, start: Date, end: Date): Promise<GapResult> {
    const startMs = start.getTime();
    const endMs = end.getTime();
    const expectedCount = Math.floor((endMs - startMs) / 60_000) + 1;

    // Stage 1: Check Postgres sync ledger (replaces ClickHouse market_data_syncs query)
    const covered = await this.syncLedger.checkCoverage(symbol, start, end);
    if (covered) {
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
    const hasGap = actualCount < expectedCount;

    // When a gap exists, find where existing data ends so the caller can
    // start downloading from the gap instead of re-fetching everything.
    let gapStart: Date | undefined;
    if (hasGap && actualCount > 0) {
      const maxRs = await chClient.query({
        query: `
          SELECT toUnixTimestamp64Milli(MAX(timestamp)) AS max_ts
          FROM ${database}.market_data FINAL
          WHERE symbol = {symbol:String}
            AND timestamp >= {start:DateTime64(3)}
            AND timestamp <= {end:DateTime64(3)}
        `,
        query_params: { symbol, start: startMs, end: endMs },
        format: 'JSONEachRow',
      });
      const maxRows = await maxRs.json<{ max_ts: string }>();
      if (maxRows.length > 0 && maxRows[0].max_ts !== '0') {
        gapStart = new Date(parseInt(maxRows[0].max_ts, 10) + 60_000);
      }
    }

    return {
      hasGap,
      expectedCount,
      actualCount,
      gapStart,
    };
  }
}
