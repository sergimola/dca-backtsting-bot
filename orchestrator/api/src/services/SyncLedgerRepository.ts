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
   * Insert or update the sync ledger for a symbol+startDate key.
   *
   * If a record for (symbol, start_date) already exists, updates end_date and
   * updated_at if the new endDate is later (extending coverage forward).
   * Otherwise inserts a new record.
   *
   * @param symbol      Normalised symbol e.g. "BTCUSDC"
   * @param startDate   First candle timestamp of the downloaded range
   * @param endDate     Timestamp of the LAST downloaded candle (not user end param)
   */
  async upsert(symbol: string, startDate: Date, endDate: Date): Promise<void> {
    // Check for existing record covering this start
    const [existing] = await db
      .select({ id: marketDataSyncs.id, endDate: marketDataSyncs.endDate })
      .from(marketDataSyncs)
      .where(
        and(
          eq(marketDataSyncs.symbol, symbol),
          eq(marketDataSyncs.startDate, startDate),
        ),
      )
      .limit(1);

    if (existing) {
      // Extend endDate forward if new download covers more
      if (endDate > existing.endDate) {
        await db
          .update(marketDataSyncs)
          .set({ endDate, updatedAt: new Date() })
          .where(eq(marketDataSyncs.id, existing.id));
      }
    } else {
      await db.insert(marketDataSyncs).values({ symbol, startDate, endDate });
    }
  }
}
