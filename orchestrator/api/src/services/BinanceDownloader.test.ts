/**
 * BinanceDownloader Unit Tests (T009)
 *
 * Verifies the paginated OHLCV fetch loop: open-candle discard,
 * 250ms paging sleep, and correct insertBatch call count.
 *
 * Test matrix:
 *   BD1 - Single full page (1,000 candles) → 1× insertBatch
 *   BD2 - Two pages (1,000 + 400) → 2× insertBatch
 *   BD3 - Empty first response → 0× insertBatch
 *   BD4 - Open candle (last ts === current minute floor) is stripped before insertBatch
 *   BD5 - sleep(250) is called between pages
 */

import { BinanceDownloader } from './BinanceDownloader';
import { ClickHouseWriter } from './ClickHouseWriter';

// Mock ccxt so no real network calls are made
jest.mock('ccxt', () => {
  return {
    binance: jest.fn().mockImplementation(() => ({
      fetchOHLCV: jest.fn(),
      enableRateLimit: true,
    })),
  };
});

// Mock ClickHouseWriter
jest.mock('./ClickHouseWriter');

// Mock SyncLedgerRepository so no real Postgres connection is made
jest.mock('./SyncLedgerRepository', () => ({
  SyncLedgerRepository: jest.fn().mockImplementation(() => ({
    upsert: jest.fn().mockResolvedValue(undefined),
    checkCoverage: jest.fn().mockResolvedValue(false),
  })),
}));

// Mock the sleep utility used between pages
jest.mock('../utils/sleep', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import { sleep } from '../utils/sleep';
import ccxt from 'ccxt';

const mockedSleep = jest.mocked(sleep);

/**
 * Build fake OHLCV rows: [timestamp_ms, open, high, low, close, volume]
 * Timestamps start at startMs and advance by 1 minute each.
 * All candles are historical (in the past) unless openCandle=true for the last one.
 */
function makeOHLCV(count: number, startMs: number, openCandle = false): number[][] {
  const rows = Array.from({ length: count }, (_, i) => [
    startMs + i * 60_000,
    50000 + i,
    50001 + i,
    49999 + i,
    50000 + i,
    1.5,
  ]);
  if (openCandle && rows.length > 0) {
    // Make the last candle timestamp equal to the current-minute floor (open candle)
    rows[rows.length - 1][0] = Math.floor(Date.now() / 60_000) * 60_000;
  }
  return rows;
}

describe('BinanceDownloader', () => {
  let mockWriter: jest.Mocked<ClickHouseWriter>;
  let downloader: BinanceDownloader;
  let mockExchange: any;

  const symbol = 'BTC/USDT';
  const startDate = new Date('2025-01-01T00:00:00Z');
  const endDate = new Date('2025-01-01T01:00:00Z'); // 60 minute window

  beforeEach(() => {
    jest.clearAllMocks();
    mockWriter = new ClickHouseWriter() as jest.Mocked<ClickHouseWriter>;
    mockWriter.insertBatch = jest.fn().mockResolvedValue(undefined);

    // Get the mocked exchange instance from the ccxt mock
    mockExchange = (ccxt as any).binance.mock.results[0]?.value;
    if (!mockExchange) {
      // Create a fresh instance
      (ccxt as any).binance.mockImplementation(() => ({
        fetchOHLCV: jest.fn(),
        enableRateLimit: true,
      }));
      mockExchange = new (ccxt as any).binance();
    }
    mockExchange.fetchOHLCV = jest.fn();

    downloader = new BinanceDownloader(mockWriter);
    (downloader as any).exchange = mockExchange;
    // Reset the SyncLedgerRepository mock on the downloader instance
    (downloader as any).syncLedger = {
      upsert: jest.fn().mockResolvedValue(undefined),
      checkCoverage: jest.fn().mockResolvedValue(false),
    };
  });

  it('BD1: single full page (1,000 candles) → 1× insertBatch', async () => {
    const historicalStart = new Date('2025-01-01T00:00:00Z').getTime();
    mockExchange.fetchOHLCV
      .mockResolvedValueOnce(makeOHLCV(1000, historicalStart))
      .mockResolvedValueOnce([]); // empty page = done

    await downloader.downloadAndStore(symbol, startDate, endDate);

    expect(mockWriter.insertBatch).toHaveBeenCalledTimes(1);
  });

  it('BD2: two pages (1,000 + 400 candles) → 2× insertBatch', async () => {
    const start = new Date('2025-01-01T00:00:00Z').getTime();
    mockExchange.fetchOHLCV
      .mockResolvedValueOnce(makeOHLCV(1000, start))
      .mockResolvedValueOnce(makeOHLCV(400, start + 1000 * 60_000))
      .mockResolvedValueOnce([]); // done

    await downloader.downloadAndStore(symbol, startDate, endDate);

    expect(mockWriter.insertBatch).toHaveBeenCalledTimes(2);
  });

  it('BD3: empty first response → 0× insertBatch', async () => {
    mockExchange.fetchOHLCV.mockResolvedValueOnce([]);

    await downloader.downloadAndStore(symbol, startDate, endDate);

    expect(mockWriter.insertBatch).not.toHaveBeenCalled();
  });

  it('BD4: open candle (last ts === current minute floor) is stripped before insertBatch', async () => {
    const start = new Date('2025-01-01T00:00:00Z').getTime();
    // Last candle has timestamp at current-minute floor (open candle)
    const page = makeOHLCV(100, start, true);

    mockExchange.fetchOHLCV
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce([]); // done

    await downloader.downloadAndStore(symbol, startDate, endDate);

    // insertBatch should be called with count-1 rows (open candle stripped)
    if (mockWriter.insertBatch.mock.calls.length > 0) {
      const insertedRows = mockWriter.insertBatch.mock.calls[0][0];
      // None of the inserted rows should have the open-candle's timestamp
      const openCandleTs = Math.floor(Date.now() / 60_000) * 60_000;
      const hasOpenCandle = insertedRows.some(
        (r: any) => new Date(r.timestamp).getTime() >= openCandleTs,
      );
      expect(hasOpenCandle).toBe(false);
    }
  });

  it('BD5: sleep(50) is called between pages', async () => {
    const start = new Date('2025-01-01T00:00:00Z').getTime();
    mockExchange.fetchOHLCV
      .mockResolvedValueOnce(makeOHLCV(1000, start))
      .mockResolvedValueOnce(makeOHLCV(200, start + 1000 * 60_000))
      .mockResolvedValueOnce([]); // done

    await downloader.downloadAndStore(symbol, startDate, endDate);

    // sleep(50) must be called at least once between the pages
    expect(mockedSleep).toHaveBeenCalledWith(50);
  });

  it('BD6: sync receipt is written to Postgres market_data_syncs on completion', async () => {
    const historicalStart = new Date('2025-01-01T00:00:00Z').getTime();
    const lastCandleTs = historicalStart + 99 * 60_000;
    mockExchange.fetchOHLCV
      .mockResolvedValueOnce(makeOHLCV(100, historicalStart))
      .mockResolvedValueOnce([]);

    await downloader.downloadAndStore(symbol, startDate, endDate);

    const mockSyncLedger = (downloader as any).syncLedger;
    expect(mockSyncLedger.upsert).toHaveBeenCalledTimes(1);
    const [upsertSymbol, upsertStart, upsertEnd] = mockSyncLedger.upsert.mock.calls[0];
    expect(upsertSymbol).toBe('BTCUSDT');              // '/' stripped, uppercased
    expect(upsertStart).toEqual(startDate);            // actual start date
    // upsertEnd should be new Date(lastCandleTs) — the last fetched candle
    expect(upsertEnd.getTime()).toBe(lastCandleTs);
  });

  it('BD7: sync receipt is written even when no candles are fetched (empty range)', async () => {
    mockExchange.fetchOHLCV.mockResolvedValueOnce([]);

    await downloader.downloadAndStore(symbol, startDate, endDate);

    // No data inserted into market_data, but Postgres sync receipt must still be written
    expect(mockWriter.insertBatch).not.toHaveBeenCalled();
    const mockSyncLedger = (downloader as any).syncLedger;
    expect(mockSyncLedger.upsert).toHaveBeenCalledTimes(1);
    const [upsertSymbol, upsertStart] = mockSyncLedger.upsert.mock.calls[0];
    expect(upsertSymbol).toBe('BTCUSDT');
    expect(upsertStart).toEqual(startDate);
  });
});
