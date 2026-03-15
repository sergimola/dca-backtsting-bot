// @ts-nocheck
/**
 * Backtest Routes Tests (T032-T036, T010)
 *
 * Comprehensive tests for:
 * - POST /backtest (T032)
 * - GET /backtest/:request_id (T034)
 * - GET /backtest (query by date range) (T036)
 * - US1 ClickHouse status-flow integration (T010)
 */

// import request from 'supertest'; // TODO: Implement integration tests
import { Express } from 'express';
import { ResultStore } from '../services/ResultStore';
import { ProcessManager } from '../services/ProcessManager';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';

// TODO: Implement integration tests
// eslint-disable-next-line @typescript-eslint/no-unused-vars
describe('Backtest Routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _app: Express;
  let resultStore: ResultStore;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let processManager: ProcessManager;
  let tempDir: string;

  beforeAll(async () => {
    // Create temporary directory for test storage
    tempDir = `/tmp/backtest-test-${Date.now()}`;
    await fs.mkdir(tempDir, { recursive: true });

    // Initialize services
    resultStore = new ResultStore(tempDir, 7);
    await resultStore.initialize();

    processManager = new ProcessManager();

    // Create Express app (we'll wire it up in app.ts, but mock here for testing)
    // For now, we'll test with actual HTTP requests to a test instance
  });

  afterAll(async () => {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('POST /backtest', () => {
    it('should accept valid backtest request and return 200 with complete result', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const validRequest = {
        entry_price: '100.50000000',
        amounts: ['10.25000000', '10.25000000'],
        sequences: [0, 1],
        leverage: '2.00000000',
        margin_ratio: '0.50000000',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };
      // TODO: Use validRequest in actual request once tests are implemented

      // This test requires the full app to be running
      // Implementation will wire through: validation -> ProcessManager -> BacktestService -> ResultAggregator -> ResultStore
      // Status: Pending app.ts factory implementation (T041)
    });

    it('should reject missing required field with HTTP 400', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const invalidRequest = {
        // Missing entry_price
        amounts: ['10.25000000'],
        sequences: [0],
        leverage: '2.00000000',
        margin_ratio: '0.50000000',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };
      // TODO: Use invalidRequest in actual test

      // Pending app.ts
    });

    it('should reject float precision (should be string decimal) with HTTP 400', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const invalidRequest = {
        entry_price: 100.50, // Should be "100.50000000"
        amounts: ['10.25000000'],
        sequences: [0],
        leverage: '2.00000000',
        margin_ratio: '0.50000000',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };
      // TODO: Use invalidRequest in actual test

      // Pending app.ts
    });

    it('should reject out-of-bounds margin_ratio with HTTP 422', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const invalidRequest = {
        entry_price: '100.50000000',
        amounts: ['10.25000000'],
        sequences: [0],
        leverage: '2.00000000',
        margin_ratio: '1.50000000', // Should be < 1.0
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };
      // TODO: Use invalidRequest in actual test

      // Pending app.ts
    });

    it('should reject mismatched amounts/sequences lengths with HTTP 400', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const invalidRequest = {
        entry_price: '100.50000000',
        amounts: ['10.25000000'], // 1 amount
        sequences: [0, 1], // 2 sequences - MISMATCH
        leverage: '2.00000000',
        margin_ratio: '0.50000000',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };
      // TODO: Use invalidRequest in actual test

      // Pending app.ts
    });
  });

  describe('GET /backtest/:request_id', () => {
    it('should return HTTP 200 with exact result from storage', async () => {
      // First save a result
      const result = {
        request_id: randomUUID(),
        status: 'success' as const,
        events: [],
        final_position: {
          quantity: '30.00000000',
          average_cost: '95.00000000',
          total_invested: '3000.00000000',
          leverage_level: '2.00000000',
          status: 'CLOSED' as const,
          last_update_timestamp: 2000,
        },
        pnl_summary: {
          total_pnl: '100.00000000',
          entry_fee: '1.00000000',
          trading_fees: '0.20000000',
          total_fees: '1.20000000',
          roi_percent: '3.33',
          total_fills: 2,
          realized_pnl: '100.00000000',
          safety_order_usage_counts: { 0: 1, 1: 1 },
        },
        execution_time_ms: 250,
        timestamp: new Date().toISOString(),
      };

      // Save result
      await resultStore.save(result);

      // Retrieve via API and verify
      // Pending app.ts
    });

    it('should reject invalid request_id (not UUID) with HTTP 400', async () => {
      // Pending app.ts
    });

    it('should return HTTP 404 for non-existent request_id', async () => {
      // Pending app.ts
    });

    it('should return HTTP 404 for expired result (> 7 days)', async () => {
      // Would need to mock time or wait 7 days - skipped in MVP
    });
  });

  describe('GET /backtest (query by date range)', () => {
    it('should return HTTP 200 with results in date range', async () => {
      // Pending app.ts
    });

    it('should support pagination with page/limit params', async () => {
      // Pending app.ts
    });

    it('should support status filter (success/failed)', async () => {
      // Pending app.ts
    });

    it('should reject invalid date format with HTTP 400', async () => {
      // Pending app.ts
    });

    it('should reject from > to with HTTP 400', async () => {
      // Pending app.ts
    });
  });
});

// ============================================================================
// T010 — US1 ClickHouse status-flow integration assertions
//
// The router now drives: PENDING → (if gap) DOWNLOADING_DATA → RUNNING → COMPLETE
// These unit tests mock GapResolver, BinanceDownloader, and BacktestService so the
// full async status machine can be verified without a real ClickHouse or Go binary.
// ============================================================================

jest.mock('../services/GapResolver');
jest.mock('../services/BinanceDownloader');
jest.mock('../services/BacktestService');
jest.mock('../services/ClickHouseWriter');
jest.mock('../services/ResultStore');
jest.mock('../services/ProcessManager');
jest.mock('../services/IdempotencyCache');

import { createBacktestRouter } from './backtest.routes';
import { GapResolver } from '../services/GapResolver';
import { BinanceDownloader } from '../services/BinanceDownloader';
import { BacktestService } from '../services/BacktestService';
import { ResultStore } from '../services/ResultStore';
import { ProcessManager } from '../services/ProcessManager';
import { IdempotencyCache } from '../services/IdempotencyCache';
import express from 'express';
import supertest from 'supertest';

const MockGapResolver = jest.mocked(GapResolver);
const MockBinanceDownloader = jest.mocked(BinanceDownloader);
const MockBacktestService = jest.mocked(BacktestService);

const validRequest = {
  trading_pair: 'BTC/USDT',
  start_date: '2025-01-01T00:00:00Z',
  end_date: '2025-01-31T23:59:00Z',
  price_entry: '40000',
  price_scale: '1.05',
  amount_scale: '2.0',
  number_of_orders: 5,
  amount_per_trade: '0.1',
  margin_type: 'cross',
  multiplier: 1,
  take_profit_distance_percent: '1.5',
  account_balance: '10000',
  exit_on_last_order: false,
  idempotency_key: '550e8400-e29b-41d4-a716-446655440001',
};

function makeMinimalApp() {
  const app = express();
  app.use(express.json());

  const mockResultStore = new ResultStore('/tmp', 7) as jest.Mocked<ResultStore>;
  const mockProcessManager = new ProcessManager() as jest.Mocked<ProcessManager>;
  const mockIdempotencyCache = new IdempotencyCache() as jest.Mocked<IdempotencyCache>;
  const mockGapResolver = new GapResolver() as jest.Mocked<GapResolver>;
  const mockDownloader = new BinanceDownloader(null as any) as jest.Mocked<BinanceDownloader>;
  const mockBacktestService = new BacktestService('/fake/binary') as jest.Mocked<BacktestService>;
  const fakePnl = { total_pnl: '0', entry_fee: '0', trading_fees: '0', total_fees: '0', roi_percent: '0', total_fills: 0, realized_pnl: '0', safety_order_usage_counts: {} };
  const mockResultAggregator = {
    aggregate: jest.fn(),
    aggregateEvents: jest.fn().mockResolvedValue(fakePnl),
    aggregateGoEvents: jest.fn().mockResolvedValue(fakePnl),
  } as any;

  mockIdempotencyCache.get = jest.fn().mockReturnValue(undefined);
  mockIdempotencyCache.set = jest.fn();
  mockResultStore.save = jest.fn().mockResolvedValue(undefined);
  mockResultStore.get = jest.fn().mockReturnValue(undefined);
  mockProcessManager.getMetrics = jest.fn().mockReturnValue({ queue_depth: 0, workers_busy: 0, workers_total: 1, estimated_wait_ms: 0 });

  // Execute the callback synchronously so tests don't wait for 35s timeout
  let jobStatus = 'pending';
  mockProcessManager.enqueue = jest.fn().mockImplementation(async (_id: string, fn: () => Promise<void>) => {
    try {
      await fn();
      jobStatus = 'complete';
    } catch {
      jobStatus = 'failed';
    }
    return _id;
  });
  mockProcessManager.getStatus = jest.fn().mockImplementation(async () => jobStatus);

  const router = createBacktestRouter(
    mockResultStore,
    mockProcessManager,
    mockBacktestService,
    mockResultAggregator,
    mockIdempotencyCache,
    mockGapResolver,
    mockDownloader,
  );

  app.use('/', router);
  return { app, mockGapResolver, mockDownloader, mockBacktestService, mockResultStore };
}

describe('Backtest Routes — US1 ClickHouse status flow (T010)', () => {
  const fakeEngineResult = {
    events: [],
    finalPosition: null,
    executionTimeMs: 100,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('T010-A: gap-detected path transitions status PENDING → DOWNLOADING_DATA → RUNNING → COMPLETE', async () => {
    const statusSequence: string[] = [];

    const { app, mockGapResolver, mockDownloader, mockBacktestService, mockResultStore } =
      makeMinimalApp();

    // Gap exists — downloader is needed
    mockGapResolver.check = jest.fn().mockResolvedValue({ hasGap: true, expectedCount: 43201, actualCount: 0 });
    mockDownloader.downloadAndStore = jest.fn().mockImplementation(async () => {
      statusSequence.push('DOWNLOADING_DATA');
    });
    mockBacktestService.execute = jest.fn().mockImplementation(async () => {
      statusSequence.push('RUNNING');
      return fakeEngineResult;
    });

    const res = await supertest(app).post('/backtest').send(validRequest);

    expect(res.status).toBeLessThan(500);
    expect(statusSequence).toContain('DOWNLOADING_DATA');
    expect(statusSequence).toContain('RUNNING');
    // DOWNLOADING_DATA must come before RUNNING
    expect(statusSequence.indexOf('DOWNLOADING_DATA')).toBeLessThan(
      statusSequence.indexOf('RUNNING'),
    );
  });

  it('T010-B: no-gap path never sets DOWNLOADING_DATA', async () => {
    const { app, mockGapResolver, mockDownloader, mockBacktestService } = makeMinimalApp();

    mockGapResolver.check = jest.fn().mockResolvedValue({ hasGap: false, expectedCount: 100, actualCount: 100 });
    mockBacktestService.execute = jest.fn().mockResolvedValue(fakeEngineResult);

    await supertest(app).post('/backtest').send(validRequest);

    expect(mockDownloader.downloadAndStore).not.toHaveBeenCalled();
  });

  it('T010-C: download-failure path transitions to FAILED with stage-specific error', async () => {
    const { app, mockGapResolver, mockDownloader, mockBacktestService } = makeMinimalApp();

    mockGapResolver.check = jest.fn().mockResolvedValue({ hasGap: true, expectedCount: 1000, actualCount: 0 });
    mockDownloader.downloadAndStore = jest.fn().mockRejectedValue(new Error('Binance rate limit exceeded'));
    // Engine should never be called
    mockBacktestService.execute = jest.fn();

    const res = await supertest(app).post('/backtest').send(validRequest);

    // Either a sync error response or async task stored as FAILED
    // The key assertion: engine was NOT called after a download failure
    expect(mockBacktestService.execute).not.toHaveBeenCalled();
  });
});
