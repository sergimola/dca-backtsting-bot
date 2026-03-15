/**
 * US1 Acceptance Test: Async Submit (T015)
 *
 * Verifies that POST /backtest → 202 Accepted (async job submission).
 * No synchronous execute — the worker picks up the job separately.
 *
 * All DB calls are mocked so no Postgres connection is required.
 */

import request from 'supertest';
import { createApp } from '../../app.js';
import { BacktestJobRepository, type BacktestRow } from '../../services/BacktestJobRepository.js';
import { SyncLedgerRepository } from '../../services/SyncLedgerRepository.js';
import { HealthMonitor } from '../../services/HealthMonitor.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_BODY = {
  trading_pair:                  'BTC/USDC',
  start_date:                    '2021-01-01T00:00:00Z',
  end_date:                      '2021-06-30T23:59:59Z',   // multi-month — guard removed
  price_entry:                   '95000.00',
  price_scale:                   '1.05',
  amount_scale:                  '1.5',
  number_of_orders:              10,
  amount_per_trade:              '0.05',
  margin_type:                   'cross',
  multiplier:                    1,
  take_profit_distance_percent:  '2.0',
  account_balance:               '10000.00',
  exit_on_last_order:            false,
};

const MOCK_JOB: BacktestRow = {
  id:              'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  status:          'pending',
  config:          VALID_BODY as any,
  summary:         null,
  trades:          null,
  safetyOrders:    null,
  executionTimeMs: null,
  errorMessage:    null,
  createdAt:       new Date('2026-03-15T12:00:00.000Z'),
  updatedAt:       new Date('2026-03-15T12:00:00.000Z'),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('US1 — Async Submit: POST /backtest', () => {
  let app: ReturnType<typeof createApp>;
  let mockRepo: jest.Mocked<BacktestJobRepository>;

  beforeEach(() => {
    // Create mock repository — no DB required
    mockRepo = {
      create:           jest.fn(),
      findById:         jest.fn(),
      listWithoutBlobs: jest.fn(),
      claimNext:        jest.fn(),
      markCompleted:    jest.fn(),
      markFailed:       jest.fn(),
    } as unknown as jest.Mocked<BacktestJobRepository>;

    const mockSyncRepo = {} as SyncLedgerRepository;
    const mockHealthMonitor = { getMetrics: jest.fn() } as unknown as HealthMonitor;

    app = createApp({
      backtestJobRepository: mockRepo,
      syncLedgerRepository:  mockSyncRepo,
      healthMonitor:         mockHealthMonitor,
    });
  });

  // -------------------------------------------------------------------------
  // AC1: Valid submission → 202 with job_id + status: pending
  // -------------------------------------------------------------------------
  it('returns 202 with job_id and status:pending for a valid request', async () => {
    mockRepo.create.mockResolvedValueOnce(MOCK_JOB);

    const res = await request(app)
      .post('/backtests')
      .set('Content-Type', 'application/json')
      .send(VALID_BODY);

    expect(res.status).toBe(202);
    expect(res.body.backtestId).toBe(MOCK_JOB.id);
    expect(res.body.status).toBe('pending');
    expect(res.body.message).toMatch(/Poll GET \/backtests\//);
  });

  // -------------------------------------------------------------------------
  // AC2: 202 is returned BEFORE BackgroundWorker executes (detachment guarantee)
  // -------------------------------------------------------------------------
  it('resolves before any background execution (create() is the last async call)', async () => {
    const createOrder: string[] = [];
    mockRepo.create.mockImplementationOnce(async () => {
      createOrder.push('create');
      return MOCK_JOB;
    });

    const res = await request(app)
      .post('/backtests')
      .send(VALID_BODY);

    expect(res.status).toBe(202);
    // create() was called exactly once — nothing else (no engine spawn)
    expect(createOrder).toEqual(['create']);
    expect(mockRepo.create).toHaveBeenCalledTimes(1);
    expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      trading_pair: VALID_BODY.trading_pair,
    }));
  });

  // -------------------------------------------------------------------------
  // AC3: Multi-month date range is now accepted (same_month_guard removed)
  // -------------------------------------------------------------------------
  it('accepts a multi-month date range (same_month_guard removed)', async () => {
    mockRepo.create.mockResolvedValueOnce({ ...MOCK_JOB, id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });

    const multiMonthBody = {
      ...VALID_BODY,
      start_date: '2021-01-01T00:00:00Z',
      end_date:   '2024-12-31T23:59:59Z',
    };

    const res = await request(app)
      .post('/backtests')
      .send(multiMonthBody);

    expect(res.status).toBe(202);
  });

  // -------------------------------------------------------------------------
  // AC4: Invalid payload → 400 (validation still runs)
  // -------------------------------------------------------------------------
  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/backtests')
      .send({ trading_pair: 'BTC/USDC' }); // all other fields missing

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    // repo.create should NOT have been called
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it('returns 400 when end_date < start_date', async () => {
    const res = await request(app)
      .post('/backtests')
      .send({
        ...VALID_BODY,
        start_date: '2021-06-01T00:00:00Z',
        end_date:   '2021-01-01T00:00:00Z',
      });

    expect(res.status).toBe(400);
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC5: GET /backtests/:id/status returns pending status
  // -------------------------------------------------------------------------
  it('GET /backtests/:id/status returns {id, status, error_message} for a known job', async () => {
    mockRepo.findById.mockResolvedValueOnce(MOCK_JOB);

    const res = await request(app)
      .get(`/backtests/${MOCK_JOB.id}/status`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(MOCK_JOB.id);
    expect(res.body.status).toBe('pending');
    expect(res.body.error_message).toBeNull();
  });

  it('GET /backtests/:id/status returns 404 for unknown job', async () => {
    mockRepo.findById.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/backtests/00000000-0000-0000-0000-000000000000/status');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /backtests/:id/status returns 400 for non-UUID id', async () => {
    const res = await request(app).get('/backtests/not-a-uuid/status');
    expect(res.status).toBe(400);
    expect(mockRepo.findById).not.toHaveBeenCalled();
  });
});
