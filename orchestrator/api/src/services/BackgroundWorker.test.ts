/**
 * Unit tests for BackgroundWorker — Phase 8 (T034)
 *
 * Uses @jest/globals (ESM-compatible) — no jest.mock() to avoid hoisting issues.
 * Dependencies are injected via constructor so no module-level mocking is needed.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { BacktestRow } from './BacktestJobRepository.js';
import { BackgroundWorker } from './BackgroundWorker.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_JOB: BacktestRow = {
  id:              'job-abc',
  status:          'running',
  config: {
    trading_pair: 'BTC/USDT', start_date: '2024-01-01T00:00:00Z',
    end_date: '2024-01-31T00:00:00Z', price_entry: '40000',
    price_scale: '1.1', amount_scale: '2.0', number_of_orders: 5,
    amount_per_trade: '0.1', margin_type: 'cross', multiplier: 1,
    take_profit_distance_percent: '2.0', account_balance: '1000',
    exit_on_last_order: false,
  },
  summary:         null,
  trades:          null,
  safetyOrders:    null,
  executionTimeMs: null,
  errorMessage:    null,
  progress:        0,
  currentMetrics:  null,
  createdAt:       new Date(),
  updatedAt:       new Date(),
};

const ENGINE_RESULT = {
  pnlSummary:            { roi: 5, maxDrawdown: 1, totalFees: 10 },
  tradeEvents:           [{ timestamp: 't', rawTimestamp: 'r', eventType: 'ENTRY', price: 40000, quantity: 0.025, balance: 1000, trade_id: '1', fee: 1 }],
  safetyOrderUsage:      [{ level: '1', count: 2 }],
  engineExecutionTimeMs: 1200,
  candleCount:           1000,
  eventCount:            10,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackgroundWorker.processJob', () => {
  let repo:        any;
  let service:     any;
  let gapResolver: any;
  let downloader:  any;
  let worker:      BackgroundWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = {
      claimNext:      jest.fn() as jest.Mock,
      markCompleted:  (jest.fn() as jest.Mock).mockImplementation(() => Promise.resolve()),
      markFailed:     (jest.fn() as jest.Mock).mockImplementation(() => Promise.resolve()),
      updateProgress: (jest.fn() as jest.Mock).mockImplementation(() => Promise.resolve()),
    };
    service = {
      execute: (jest.fn() as jest.Mock).mockImplementation(() => Promise.resolve(ENGINE_RESULT)),
    };
    gapResolver = {
      check: (jest.fn() as jest.Mock).mockImplementation(() => Promise.resolve({ hasGap: false })),
    };
    downloader = {
      downloadAndStore: (jest.fn() as jest.Mock).mockImplementation(() => Promise.resolve()),
    };
    worker = new BackgroundWorker(repo, service, gapResolver, downloader);
  });

  it('passes a progressHandler function to service.execute', async () => {
    await (worker as any).processJob(MOCK_JOB);

    expect(service.execute).toHaveBeenCalledTimes(1);
    const [, options] = (service.execute as jest.Mock).mock.calls[0] as [unknown, any];
    expect(typeof options?.progressHandler).toBe('function');
  });

  it('progressHandler calls repo.updateProgress with percent and metrics', async () => {
    (service.execute as jest.Mock).mockImplementationOnce(async (_req: unknown, opts: any) => {
      if (opts?.progressHandler) {
        await opts.progressHandler({
          type: 'progress', percent: 55, current_date: '2024-01-15T00:00:00Z',
          processed_candles: 550, total_candles: 1000, current_price: 42000,
          realized_pnl: 25, candles_per_second: 500000,
        });
      }
      return ENGINE_RESULT;
    });

    await (worker as any).processJob(MOCK_JOB);

    expect(repo.updateProgress).toHaveBeenCalledWith(
      'job-abc',
      55,
      expect.objectContaining({ type: 'progress', percent: 55 }),
    );
  });

  it('calls markCompleted with engine result data — no aggregator', async () => {
    await (worker as any).processJob(MOCK_JOB);

    expect(repo.markCompleted).toHaveBeenCalledWith(
      'job-abc',
      ENGINE_RESULT.pnlSummary,
      ENGINE_RESULT.tradeEvents,
      ENGINE_RESULT.safetyOrderUsage,
      expect.any(Number),
    );
  });

  it('calls markFailed when service.execute throws', async () => {
    (service.execute as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error('engine crash')));

    await (worker as any).processJob(MOCK_JOB);

    expect(repo.markFailed).toHaveBeenCalledWith('job-abc', expect.stringContaining('engine crash'));
    expect(repo.markCompleted).not.toHaveBeenCalled();
  });
});
