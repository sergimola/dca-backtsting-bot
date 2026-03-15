/**
 * US2 Acceptance Test: Job Lifecycle (T020)
 *
 * Verifies the full job lifecycle:
 * - GET /backtests/:id/status returns correct status at each stage
 * - GET /backtests/:id returns the full result when completed
 * - Transitions: pending → running → completed | failed
 *
 * All DB calls are mocked — no Postgres required.
 */

import request from 'supertest';
import { createApp } from '../../app.js';
import { BacktestJobRepository, type BacktestRow } from '../../services/BacktestJobRepository.js';
import { SyncLedgerRepository } from '../../services/SyncLedgerRepository.js';
import { HealthMonitor } from '../../services/HealthMonitor.js';
import type { StoredPnlSummary, StoredTradeEvent } from '../../types/index.js';

const JOB_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

const BASE_CONFIG = {
  trading_pair:                 'BTC/USDC',
  start_date:                   '2021-01-01T00:00:00Z',
  end_date:                     '2024-12-31T23:59:59Z',
  price_entry:                  '95000.00',
  price_scale:                  '1.05',
  amount_scale:                 '1.5',
  number_of_orders:             5,
  amount_per_trade:             '0.05',
  margin_type:                  'cross' as const,
  multiplier:                   1,
  take_profit_distance_percent: '2.0',
  account_balance:              '10000.00',
  exit_on_last_order:           false,
};

const MOCK_SUMMARY: StoredPnlSummary = {
  roi:         48.21,
  maxDrawdown: 0,
  totalFees:   182.44,
};

function makeJob(overrides: Partial<BacktestRow> = {}): BacktestRow {
  return {
    id:              JOB_ID,
    status:          'pending',
    config:          BASE_CONFIG as any,
    summary:         null,
    trades:          null,
    safetyOrders:    null,
    executionTimeMs: null,
    errorMessage:    null,
    createdAt:       new Date('2026-03-15T12:00:00.000Z'),
    updatedAt:       new Date('2026-03-15T12:00:00.000Z'),
    ...overrides,
  };
}

describe('US2 — Job Lifecycle', () => {
  let app: ReturnType<typeof createApp>;
  let mockRepo: jest.Mocked<BacktestJobRepository>;

  beforeEach(() => {
    mockRepo = {
      create:           jest.fn(),
      findById:         jest.fn(),
      listWithoutBlobs: jest.fn(),
      claimNext:        jest.fn(),
      markCompleted:    jest.fn(),
      markFailed:       jest.fn(),
    } as unknown as jest.Mocked<BacktestJobRepository>;

    app = createApp({
      backtestJobRepository: mockRepo,
      syncLedgerRepository:  {} as SyncLedgerRepository,
      healthMonitor:         { getMetrics: jest.fn() } as unknown as HealthMonitor,
    });
  });

  // ---------------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------------
  it('status endpoint returns pending when job is pending', async () => {
    mockRepo.findById.mockResolvedValueOnce(makeJob({ status: 'pending' }));
    const res = await request(app).get(`/backtests/${JOB_ID}/status`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.error_message).toBeNull();
  });

  it('status endpoint returns running when job is running', async () => {
    mockRepo.findById.mockResolvedValueOnce(makeJob({ status: 'running' }));
    const res = await request(app).get(`/backtests/${JOB_ID}/status`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
  });

  it('status endpoint returns completed when job is completed', async () => {
    mockRepo.findById.mockResolvedValueOnce(makeJob({ status: 'completed', summary: MOCK_SUMMARY }));
    const res = await request(app).get(`/backtests/${JOB_ID}/status`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('status endpoint returns failed + error_message when job failed', async () => {
    const failedJob = makeJob({
      status:       'failed',
      errorMessage: 'Engine process exited with code 1',
    });
    mockRepo.findById.mockResolvedValueOnce(failedJob);

    const res = await request(app).get(`/backtests/${JOB_ID}/status`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(res.body.error_message).toBe('Engine process exited with code 1');
  });

  // ---------------------------------------------------------------------------
  // Full result retrieval
  // ---------------------------------------------------------------------------
  it('GET /backtests/:id returns full job result including summary and trades', async () => {
    const trades: StoredTradeEvent[] = [];
    const completedJob = makeJob({
      status:  'completed',
      summary: MOCK_SUMMARY,
      trades,
    });
    mockRepo.findById.mockResolvedValueOnce(completedJob);

    const res = await request(app).get(`/backtests/${JOB_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.backtestId).toBe(JOB_ID);
    expect(res.body.pnlSummary).toBeDefined();
    expect(res.body.pnlSummary.roi).toBeCloseTo(48.21);
    expect(res.body.pnlSummary.totalFees).toBeCloseTo(182.44);
    expect(res.body.tradeEvents).toEqual([]);
  });

  it('GET /backtests/:id returns 404 for unknown job', async () => {
    mockRepo.findById.mockResolvedValueOnce(null);
    const res = await request(app).get(`/backtests/${JOB_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /backtests/:id returns 400 for non-UUID id', async () => {
    const res = await request(app).get('/backtests/not-a-uuid');
    expect(res.status).toBe(400);
    expect(mockRepo.findById).not.toHaveBeenCalled();
  });
});
