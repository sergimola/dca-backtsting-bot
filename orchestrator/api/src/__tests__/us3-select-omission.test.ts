/**
 * US3 Select Omission Test (T022)
 *
 * Verifies that GET /backtests (list endpoint) does NOT return
 * the `trades` or `safety_orders` JSONB columns (constitution gate: select omission).
 *
 * This test is the authoritative gate for FR-017.
 */

import request from 'supertest';
import { createApp } from '../app.js';
import { BacktestJobRepository, type BacktestRow } from '../services/BacktestJobRepository.js';
import { SyncLedgerRepository } from '../services/SyncLedgerRepository.js';
import { HealthMonitor } from '../services/HealthMonitor.js';
import type { StoredPnlSummary, StoredTradeEvent } from '../types/index.js';

const JOB_ID_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const JOB_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const MOCK_SUMMARY: StoredPnlSummary = {
  roi:         1.0,
  maxDrawdown: 0,
  totalFees:   3.0,
};

const MOCK_TRADES: StoredTradeEvent[] = [
  {
    timestamp:    '1/10/2024, 10:00:00 AM',
    rawTimestamp: '2024-01-10T10:00:00',
    eventType:    'ENTRY',
    price:        95000,
    quantity:     0.001,
    balance:      -95,
    trade_id:     '1',
    fee:          0.05,
  },
];

function makeListRow(id: string, overrides: Partial<Omit<BacktestRow, 'trades' | 'safetyOrders'>> = {}) {
  // Simulates what listWithoutBlobs() returns — NO trades/safetyOrders
  return {
    id,
    status:          'completed' as const,
    config:          {} as any,
    summary:         MOCK_SUMMARY,
    executionTimeMs: null,
    errorMessage:    null,
    createdAt:       new Date(),
    updatedAt:       new Date(),
    ...overrides,
  };
}

describe('US3 — Select Omission: GET /backtests', () => {
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
  // AC1: trades and safety_orders must NOT be present in list response (FR-017)
  // ---------------------------------------------------------------------------
  it('does NOT include trades or safety_orders in the list response', async () => {
    mockRepo.listWithoutBlobs.mockResolvedValueOnce([
      makeListRow(JOB_ID_1),
      makeListRow(JOB_ID_2),
    ]);

    const res = await request(app).get('/backtests');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);

    // Constitution gate: neither heavy column must appear
    for (const job of res.body) {
      expect(job).not.toHaveProperty('trades');
      expect(job).not.toHaveProperty('safety_orders');
      expect(job).not.toHaveProperty('safetyOrders');
    }
  });

  // ---------------------------------------------------------------------------
  // AC2: pnlSummary IS present in list response (needed by frontend sidebar)
  // ---------------------------------------------------------------------------
  it('includes pnlSummary in the list response', async () => {
    mockRepo.listWithoutBlobs.mockResolvedValueOnce([makeListRow(JOB_ID_1)]);

    const res = await request(app).get('/backtests');
    expect(res.status).toBe(200);
    expect(res.body[0].pnlSummary).toBeDefined();
    expect(res.body[0].pnlSummary.roi).toBeCloseTo(1.0);
  });

  // ---------------------------------------------------------------------------
  // AC3: listWithoutBlobs is called with the correct limit/offset params
  // ---------------------------------------------------------------------------
  it('forwards limit and offset query params to repository', async () => {
    mockRepo.listWithoutBlobs.mockResolvedValueOnce([]);

    await request(app).get('/backtests?limit=10&offset=20');
    expect(mockRepo.listWithoutBlobs).toHaveBeenCalledWith({ limit: 10, offset: 20 });
  });

  it('returns 200 with an empty array when no jobs exist', async () => {
    mockRepo.listWithoutBlobs.mockResolvedValueOnce([]);
    const res = await request(app).get('/backtests');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // AC4: GET /backtests/:id DOES include trades (full result query)
  // ---------------------------------------------------------------------------
  it('GET /backtests/:id includes trades when present', async () => {
    const fullJob = {
      ...makeListRow(JOB_ID_1),
      trades:       MOCK_TRADES,
      safetyOrders: [],
    } as BacktestRow;
    mockRepo.findById.mockResolvedValueOnce(fullJob);

    const res = await request(app).get(`/backtests/${JOB_ID_1}`);
    expect(res.status).toBe(200);
    expect(res.body.tradeEvents).toBeDefined();
    expect(res.body.tradeEvents).toHaveLength(1);
  });
});
