/**
 * T005 — Canonical Integration Tests
 *
 * Validates the complete SDD §4.1 parameter mapping pipeline:
 * - IT-001: Price sequence P_1 = 98.00 (SDD §2.1)
 * - IT-002: Price sequence P_2 = 95.844 (SDD §2.1 geometric growth)
 * - IT-003: Amount scaling A_0 ≈ 428.57 (SDD §2.2)
 * - IT-004: No liquidation event with multiplier=1 (spot clamp, SDD §2.5)
 * - IT-005: PositionOpened event is emitted
 * - IT-006: margin_type echoed correctly in final_position
 * - IT-007: 404 returned for missing market data CSV
 * - IT-008: 400 returned for cross-month date range
 *
 * IT-001 to IT-006 invoke the real Go binary directly via stdin/stdout.
 * IT-007 and IT-008 call the HTTP API through the full Express app stack.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import request from 'supertest';
import {
  setupTestApp,
  cleanupTestApp,
  getTestApp,
} from '../__tests__/helpers/test-setup.js';

// ─── Binary Resolution ────────────────────────────────────────────────────────

const BINARY_SUFFIX = process.platform === 'win32' ? '.exe' : '';
const BINARY_PATH = path.resolve(
  __dirname,
  `../../core-engine${BINARY_SUFFIX}`,
);
const BINARY_EXISTS =
  fs.existsSync(BINARY_PATH) ||
  fs.existsSync(BINARY_PATH.replace('.exe', '') + '.exe');

/** Conditionally skip test if binary is unavailable */
const itIfBinary = BINARY_EXISTS ? it : it.skip;

// ─── CSV Fixture ─────────────────────────────────────────────────────────────

/**
 * Four-candle OHLCV fixture designed for SDD §2.1 / §2.2 math proofs.
 *
 * Candle 1: close=100 → P_0 = 100, position opens (TradeOpenedEvent)
 * Candle 2: low=97.5 ≤ P_1=98.00 → BuyOrderExecuted at P_1=98.00 (high=99.0 < P_tp≈99.5, no TP)
 * Candle 3: low=95.0 ≤ P_2=95.844 → BuyOrderExecuted at P_2=95.844 (high=97.5 < P_tp, no TP)
 * Candle 4: high=102.0 ≥ P_tp≈99.5 → PositionClosed reason=take_profit
 */
const SDD_CSV_CONTENT = `symbol,timestamp,open,high,low,close,volume
LTCUSDT,2024-01-02T14:00:00Z,100.0,100.4,99.5,100.0,1000.0
LTCUSDT,2024-01-02T14:01:00Z,98.5,99.0,97.5,98.5,1000.0
LTCUSDT,2024-01-02T14:02:00Z,97.0,97.4,95.0,96.0,1000.0
LTCUSDT,2024-01-02T14:03:00Z,96.5,103.0,96.0,99.0,1000.0
`;

// ─── Engine Request Types ─────────────────────────────────────────────────────

interface EngineRequest {
  trading_pair: string;
  start_date: string;
  end_date: string;
  price_entry: string;
  price_scale: string;
  amount_scale: string;
  number_of_orders: number;
  amount_per_trade: string;
  margin_type: string;
  multiplier: number;
  take_profit_distance_percent: string;
  account_balance: string;
  exit_on_last_order: boolean;
  market_data_csv_path: string;
  idempotency_key?: string;
}

interface EngineEvent {
  timestamp: string;
  type: string;
  data: Record<string, any>;
}

interface EngineOutput {
  events: EngineEvent[];
  execution_time_ms: number;
  candle_count: number;
  event_count: number;
  final_position: Record<string, any>;
}

// ─── Helper: Direct Binary Invocation ────────────────────────────────────────

function invokeEngine(reqData: EngineRequest): Promise<EngineOutput> {
  return new Promise((resolve, reject) => {
    const binPath = fs.existsSync(BINARY_PATH)
      ? BINARY_PATH
      : BINARY_PATH.replace('.exe', '') + '.exe';

    const child = spawn(binPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('exit', (code: number | null) => {
      if (code !== 0) {
        reject(
          new Error(
            `Engine exited with code ${code}. stderr: ${stderr.substring(0, 500)}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as EngineOutput);
      } catch (e) {
        reject(
          new Error(
            `Failed to parse engine output: ${stdout.substring(0, 500)}`,
          ),
        );
      }
    });

    child.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn engine: ${err.message}`));
    });

    child.stdin.write(JSON.stringify(reqData) + '\n');
    child.stdin.end();
  });
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('T005 — Canonical Integration Tests', () => {
  let tmpDir: string;
  let csvPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't005-'));
    csvPath = path.join(tmpDir, 'LTCUSDT-1m-2024-01.csv');
    fs.writeFileSync(csvPath, SDD_CSV_CONTENT, 'utf8');
  });

  afterAll(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Math Proof Tests (Direct Binary) ──────────────────────────────────────

  describe('SDD Math Proofs (direct binary invocation)', () => {
    let sddResult: EngineOutput;

    /**
     * SDD §4.1 canonical config (with 0.05% market tolerance):
     *   P_0 = 100.05 (CSV close=100 + 0.05% slippage), price_entry=2.0%, price_scale=1.1, N=3
     *   → P_1 = 98.049, P_2 = 95.892
     *   amount_per_trade=1000, amount_scale=2.0, multiplier=3
     *   → A_0 = 1000*3/7 ≈ 428.57
     */
    beforeAll(async () => {
      if (!BINARY_EXISTS) return;

      sddResult = await invokeEngine({
        trading_pair: 'LTC/USDT',
        start_date: '2024-01-02T14:00:00Z',
        end_date: '2024-01-02T23:59:59Z',
        price_entry: '2.0',
        price_scale: '1.1',
        amount_scale: '2.0',
        number_of_orders: 3,
        amount_per_trade: '1000.0',
        margin_type: 'cross',
        multiplier: 3,
        take_profit_distance_percent: '2.0',
        account_balance: '10000.0',
        exit_on_last_order: false,
        market_data_csv_path: csvPath,
        idempotency_key: 'it-001-003',
      });
    }, 30000);

    /**
     * IT-001: Price sequence — first DCA order price (with 0.05% slippage)
     * Slippage: P_0 = 100.00 × 1.0005 = 100.05
     * SDD §2.1: P_1 = P_0 × (1 − δ/100) = 100.05 × (1 − 0.02) = 98.049
     */
    itIfBinary(
      'IT-001: first BuyOrderExecuted price ≈ 98.049 (SDD §2.1 + 0.05% slippage)',
      () => {
        expect(sddResult).toBeDefined();
        const buyEvents = sddResult.events.filter(
          (e) => e.type === 'BuyOrderExecuted',
        );
        expect(buyEvents.length).toBeGreaterThanOrEqual(1);
        // P_0 = 100.05 (slippage), P_1 = 100.05 × 0.98 = 98.049
        expect(parseFloat(buyEvents[0].data.price)).toBeCloseTo(98.049, 1);
      },
    );

    /**
     * IT-002: Price sequence — geometric growth (with 0.05% slippage)
     * Slippage: P_0 = 100.05
     * SDD §2.1: P_2 = P_1 × (1 − δ/100 × s_p) = 98.049 × (1 − 0.02 × 1.1) = 95.892
     */
    itIfBinary(
      'IT-002: second BuyOrderExecuted price ≈ 95.892 (SDD §2.1 geometric + slippage)',
      () => {
        expect(sddResult).toBeDefined();
        const buyEvents = sddResult.events.filter(
          (e) => e.type === 'BuyOrderExecuted',
        );
        expect(buyEvents.length).toBeGreaterThanOrEqual(2);
        // P_2 = 98.049 × (1 − 0.022) = 98.049 × 0.978 = 95.892
        expect(parseFloat(buyEvents[1].data.price)).toBeCloseTo(95.892, 1);
      },
    );

    /**
     * IT-003: Amount scaling — A_0 ≈ 428.57
     * SDD §2.2: A_0 = C×m / R where C=1000, m=3, s_a=2, N=3 → R=7 → A_0=428.57
     */
    itIfBinary(
      'IT-003: PositionOpened configured_orders[0].amount ≈ 428.57 (SDD §2.2)',
      () => {
        expect(sddResult).toBeDefined();
        const openEvents = sddResult.events.filter(
          (e) => e.type === 'PositionOpened',
        );
        expect(openEvents.length).toBeGreaterThanOrEqual(1);
        const orders = openEvents[0].data.configured_orders as Array<{
          amount: string;
        }>;
        expect(orders).toBeDefined();
        expect(orders.length).toBeGreaterThanOrEqual(1);
        const a0 = parseFloat(orders[0].amount);
        expect(a0).toBeGreaterThan(428.0);
        expect(a0).toBeLessThan(429.0);
      },
    );

    /**
     * IT-004: Spot clamp — no liquidation event with multiplier=1
     * SDD §2.5: with multiplier=1 (spot), no liquidation should be triggered.
     * CSV prices never drop near P_liq, confirming spot safety.
     */
    itIfBinary(
      'IT-004: no liquidation event when multiplier=1 (SDD §2.5 spot clamp)',
      async () => {
        const spotResult = await invokeEngine({
          trading_pair: 'LTC/USDT',
          start_date: '2024-01-02T14:00:00Z',
          end_date: '2024-01-02T23:59:59Z',
          price_entry: '2.0',
          price_scale: '1.1',
          amount_scale: '1.0',
          number_of_orders: 3,
          amount_per_trade: '1000.0',
          margin_type: 'cross',
          multiplier: 1,
          take_profit_distance_percent: '2.0',
          account_balance: '10000.0',
          exit_on_last_order: false,
          market_data_csv_path: csvPath,
          idempotency_key: 'it-004-spot',
        });

        // With multiplier=1 (spot), no TradeClosedEvent should have reason="liquidation"
        const liquidationCloses = spotResult.events.filter(
          (e) =>
            e.type === 'PositionClosed' && e.data.reason === 'liquidation',
        );
        expect(liquidationCloses).toHaveLength(0);
      },
    );

    /**
     * IT-005: PositionOpened event is emitted on the first candle
     */
    itIfBinary('IT-005: PositionOpened event emitted on first candle', () => {
      expect(sddResult).toBeDefined();
      const openEvents = sddResult.events.filter(
        (e) => e.type === 'PositionOpened',
      );
      expect(openEvents.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * IT-006: margin_type round-trip — echoed correctly in final_position
     */
    itIfBinary(
      'IT-006: margin_type="cross" round-trips through engine to final_position',
      () => {
        expect(sddResult).toBeDefined();
        expect(sddResult.final_position).toBeDefined();
        expect(sddResult.final_position['margin_type']).toBe('cross');
      },
    );
  });

  // ─── Boundary Error Tests (HTTP API) ──────────────────────────────────────

  describe('Boundary Error Handling (HTTP API)', () => {
    beforeAll(async () => {
      await setupTestApp();
    });

    afterAll(async () => {
      await cleanupTestApp();
    });

    /** Base valid payload — all 13 SDD §4.1 fields present */
    const basePayload = {
      trading_pair: 'LTC/USDT',
      start_date: '2024-01-02T00:00:00Z',
      end_date: '2024-01-02T23:59:59Z',
      price_entry: '2.0',
      price_scale: '1.1',
      amount_scale: '2.0',
      number_of_orders: 3,
      amount_per_trade: '1000.0',
      margin_type: 'cross',
      multiplier: 1,
      take_profit_distance_percent: '2.0',
      account_balance: '10000.0',
      exit_on_last_order: false,
    };

    /**
     * IT-007: 404 for non-existent trading pair CSV
     * MarketDataResolver cannot find NONEXISTENTUSDT-1m-2024-01.csv
     */
    it('IT-007: returns 404 when market data CSV does not exist', async () => {
      const app = getTestApp();
      const res = await request(app)
        .post('/backtest')
        .set('Content-Type', 'application/json')
        .send({ ...basePayload, trading_pair: 'NONEXISTENT/USDT' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('CSV_FILE_NOT_FOUND');
    });

    /**
     * IT-008: 400 for cross-month date range
     * Validation middleware rejects start_date and end_date in different months
     */
    it('IT-008: returns 400 when start_date and end_date span different months', async () => {
      const app = getTestApp();
      const res = await request(app)
        .post('/backtest')
        .set('Content-Type', 'application/json')
        .send({
          ...basePayload,
          start_date: '2024-01-15T00:00:00Z',
          end_date: '2024-02-10T23:59:59Z',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('VALIDATION_OUT_OF_BOUNDS');
    });
  });
});
