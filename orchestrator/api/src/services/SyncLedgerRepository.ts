/**
 * SyncLedgerRepository (T010)
 *
 * Database operations for the `market_data_syncs` table (Postgres).
 * Replaces the legacy ClickHouse `market_data_syncs` table writes.
 *
 * Used by:
 * - GapResolver.check() → checkCoverage() (Stage 1 of gap detection)
 * - BinanceDownloader.downloadAndStore() → upsert() (after successful download)
 */

import { and, lte, gte, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { marketDataSyncs } from '../db/schema.js';

export class SyncLedgerRepository {
  /**
   * Returns true if a prior download fully covers the requested [start, end] window
   * for the given symbol. Short-circuits GapResolver's COUNT(*) FINAL query when true.
   */
  async checkCoverage(symbol: string, start: Date, end: Date): Promise<boolean> {
    const [row] = await db
      .select({ id: marketDataSyncs.id })
      .from(marketDataSyncs)
      .where(
        and(
          eq(marketDataSyncs.symbol, symbol),
          lte(marketDataSyncs.startDate, start),
          gte(marketDataSyncs.endDate, end),
        ),
      )
      .limit(1);

    return row != null;
  }

  /**
   * Insert or update the sync ledger for a symbol.
   *
   * Finds any existing record whose range overlaps or is adjacent to
   * [startDate, endDate] and merges the two ranges into one row.
   * If no overlap exists, inserts a new record.
   *
   * @param symbol      Normalised symbol e.g. "BTCUSDC"
   * @param startDate   First candle timestamp of the downloaded range
   * @param endDate     Timestamp of the LAST downloaded candle (not user end param)
   */
  async upsert(symbol: string, startDate: Date, endDate: Date): Promise<void> {
    // Find any existing record that overlaps or is adjacent to the new range.
    // Adjacent means the existing endDate is within 1 minute of the new startDate.
    const adjacencyMs = 60_000;
    const [existing] = await db
      .select({
        id: marketDataSyncs.id,
        startDate: marketDataSyncs.startDate,
        endDate: marketDataSyncs.endDate,
      })
      .from(marketDataSyncs)
      .where(
        and(
          eq(marketDataSyncs.symbol, symbol),
          lte(marketDataSyncs.startDate, new Date(endDate.getTime() + adjacencyMs)),
          gte(marketDataSyncs.endDate, new Date(startDate.getTime() - adjacencyMs)),
        ),
      )
      .limit(1);

    if (existing) {
      // Merge ranges — take the earliest start and latest end
      const mergedStart = existing.startDate < startDate ? existing.startDate : startDate;
      const mergedEnd   = endDate > existing.endDate ? endDate : existing.endDate;
      if (mergedStart < existing.startDate || mergedEnd > existing.endDate) {
        await db
          .update(marketDataSyncs)
          .set({ startDate: mergedStart, endDate: mergedEnd, updatedAt: new Date() })
          .where(eq(marketDataSyncs.id, existing.id));
      }
    } else {
      await db.insert(marketDataSyncs).values({ symbol, startDate, endDate });
    }
  }
}
