import ccxt from 'ccxt';
import { ClickHouseWriter, OHLCVRow } from './ClickHouseWriter.js';
import { SyncLedgerRepository } from './SyncLedgerRepository.js';
import { sleep } from '../utils/sleep.js';

/**
 * BinanceDownloader fetches historical 1-minute OHLCV candles from Binance
 * via ccxt and streams them page-by-page into ClickHouse.
 *
 * Constitution requirements enforced here:
 * - enableRateLimit: true on the exchange (ccxt built-in throttle)
 * - explicit sleep(50) between every paginated fetch (belt-and-suspenders)
 * - open-candle discard: any candle whose timestamp >= current-minute floor
 *   is stripped before calling insertBatch (partially-formed OHLCV protection)
 */
export class BinanceDownloader {
  private exchange: InstanceType<typeof ccxt.binance>;
  private writer: ClickHouseWriter;
  private syncLedger: SyncLedgerRepository;

  constructor(writer: ClickHouseWriter, syncLedger?: SyncLedgerRepository) {
    this.writer = writer;
    this.syncLedger = syncLedger ?? new SyncLedgerRepository();
    this.exchange = new ccxt.binance({ enableRateLimit: true });
  }

  /**
   * Downloads all 1-minute candles for [start, end] and persists them.
   * On success (including empty ranges), writes a sync receipt to
   * market_data_syncs so GapResolver skips re-downloading on future runs.
   * @returns Total number of candle rows stored.
   */
  async downloadAndStore(symbol: string, start: Date, _end: Date): Promise<number> {
    let since        = start.getTime();
    let totalStored  = 0;
    let isFirstPage  = true;
    // Track the ACTUAL last-candle timestamp (not the user's end_date param)
    let lastCandleTs = start.getTime();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!isFirstPage) {
        await sleep(1); // 50ms pacing between pages (constitution gate)
      }
      isFirstPage = false;

      // ccxt returns OHLCV[] where each element is [Num, Num, ...] and Num = number | undefined.
      // Cast to number[][] so downstream code can use numeric indexing safely.
      const ohlcv = (await this.exchange.fetchOHLCV(symbol, '1m', since, 1000)) as unknown as number[][];

      if (ohlcv.length === 0) {
        break; // no more data — terminate pagination
      }

      // Discard any candle with timestamp >= current-minute floor (open candle)
      const nowMinuteFloor = Math.floor(Date.now() / 60_000) * 60_000;
      const filtered = ohlcv.filter((c) => c[0] < nowMinuteFloor);

      if (filtered.length > 0) {
        const rows: OHLCVRow[] = filtered.map((c) => ({
          symbol: symbol.replace('/', '').toUpperCase(),
          timestamp: new Date(c[0]).toISOString().replace('T', ' ').replace('Z', ''),
          open: c[1],
          high: c[2],
          low: c[3],
          close: c[4],
          volume: c[5],
        }));

        await this.writer.insertBatch(rows);
        totalStored += rows.length;
      }

      // Advance cursor + update lastCandleTs to the actual last-fetched candle
      const lastTs = ohlcv[ohlcv.length - 1][0];
      lastCandleTs = lastTs;
      since = lastTs + 60_000;
    }

    // Write sync receipt to Postgres so GapResolver trusts this range on future requests.
    // Uses lastCandleTs (actual last downloaded candle) NOT user's end param.
    const symbolNormalized = symbol.replace('/', '').toUpperCase();
    await this.syncLedger.upsert(symbolNormalized, start, new Date(lastCandleTs));

    return totalStored;
  }
}
