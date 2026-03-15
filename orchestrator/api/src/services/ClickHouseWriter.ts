import { chClient, database } from './ClickHouseClient.js';

export interface OHLCVRow {
  symbol: string;
  timestamp: string; // ClickHouse DateTime64 format: "YYYY-MM-DD HH:MM:SS.mmm" (no T, no Z)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * ClickHouseWriter wraps bulk OHLCV inserts into ClickHouse.
 *
 * Constitution requirement: every call to insertBatch must insert all provided rows
 * in a single INSERT statement. The caller (BinanceDownloader) pages its own batches;
 * this class does NOT split or buffer internally.
 */
export class ClickHouseWriter {
  /**
   * Inserts a batch of OHLCV rows into {database}.market_data.
   * @throws Error if rows is empty — callers must never call with an empty array.
   */
  async insertBatch(rows: OHLCVRow[]): Promise<void> {
    if (rows.length === 0) {
      throw new Error('insertBatch called with empty array');
    }

    await chClient.insert<OHLCVRow>({
      table: `${database}.market_data`,
      values: rows,
      format: 'JSONEachRow',
    });
  }
}
