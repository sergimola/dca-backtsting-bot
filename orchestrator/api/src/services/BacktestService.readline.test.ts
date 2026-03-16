/**
 * Unit tests for BacktestService readline behaviour — Phase 7 (T030)
 *
 * Tests the pure mapResultLine helper plus the integration-level readline flow
 * via the mock binary (testdata/mock-core-engine.js).
 */

import { BacktestService, mapResultLine } from './BacktestService';
import type { EngineResultLine } from '../types/index.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MOCK_BINARY_PATH = path.join(__dirname, '../../testdata/mock-core-engine.js');

const VALID_REQUEST = {
  trading_pair: 'BTC/USDT',
  start_date:   '2025-01-01T00:00:00Z',
  end_date:     '2025-01-31T23:59:59Z',
  price_entry:  '100.50',
  price_scale:  '1.1',
  amount_scale: '2.0',
  number_of_orders: 3,
  amount_per_trade: '0.5',
  margin_type:  'cross' as const,
  multiplier:   1,
  take_profit_distance_percent: '1.0',
  account_balance: '1000',
  exit_on_last_order: false,
  clickhouse_addr: 'localhost:9000',
  clickhouse_db:   'dca_bot',
  clickhouse_user: 'default',
  clickhouse_password: '',
};

// ---------------------------------------------------------------------------
// mapResultLine — pure function, no I/O
// ---------------------------------------------------------------------------

describe('mapResultLine', () => {
  it('maps all fields from EngineResultLine to BacktestExecutionResult', () => {
    const line: EngineResultLine = {
      type:             'result',
      pnlSummary:       { roi: 10, maxDrawdown: 2, totalFees: 5 },
      tradeEvents:      [],
      safetyOrderUsage: [],
      executionTimeMs:  2000,
      candleCount:      500,
      eventCount:       6,
    };
    const result = mapResultLine(line);
    expect(result.pnlSummary).toEqual(line.pnlSummary);
    expect(result.engineExecutionTimeMs).toBe(2000);
    expect(result.candleCount).toBe(500);
    expect(result.eventCount).toBe(6);
    expect(result.tradeEvents).toEqual([]);
    expect(result.safetyOrderUsage).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Integration: readline behaviour against mock binary
// ---------------------------------------------------------------------------

describe('BacktestService readline integration', () => {
  let service: BacktestService;

  beforeEach(() => {
    service = new BacktestService(MOCK_BINARY_PATH, { timeoutMs: 10000 });
  });

  it('progress lines invoke progressHandler', async () => {
    const captured: unknown[] = [];
    const handler = async (line: unknown) => { captured.push(line); };
    await service.execute(VALID_REQUEST, { progressHandler: handler as (line: import('../types/index.js').ProgressLine) => Promise<void> });
    // Mock binary emits 2 progress lines
    expect(captured).toHaveLength(2);
    expect((captured[0] as any).type).toBe('progress');
    expect((captured[0] as any).percent).toBe(25);
  });

  it('result line resolves with BacktestExecutionResult', async () => {
    const result = await service.execute(VALID_REQUEST);
    expect(result.pnlSummary.roi).toBe(5.5);
    expect(result.tradeEvents).toHaveLength(3);
    expect(result.safetyOrderUsage).toHaveLength(1);
    expect(result.engineExecutionTimeMs).toBe(120);
    expect(result.candleCount).toBe(44640);
    expect(result.eventCount).toBe(12);
  });

  it('non-JSON stdout line (malformed mode) is discarded without crash', async () => {
    const malformedService = new BacktestService(MOCK_BINARY_PATH, { timeoutMs: 10000 });
    // executeWithStderr passes --malformed flag
    const result = await malformedService.executeWithStderr(VALID_REQUEST, ['--malformed']);
    expect(result).toBeDefined();
    expect(result.pnlSummary).toBeDefined();
  });

  it('exit with failure rejects with ProcessError', async () => {
    const { ProcessError } = await import('../types/errors.js');
    await expect(service.executeWithStderr(VALID_REQUEST, ['--fail']))
      .rejects.toBeInstanceOf(ProcessError);
  });
});
