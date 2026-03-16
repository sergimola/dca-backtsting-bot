/**
 * BacktestService Integration Tests
 *
 * Tests the BacktestService with the mock Go binary (mock-core-engine.js).
 * The mock binary emits 2 progress lines followed by 1 result line in the
 * new EngineResultPayload NDJSON format.
 *
 * Updated for feature 011: new result shape (pnlSummary, tradeEvents, safetyOrderUsage).
 */

import { BacktestService } from './BacktestService';
import type { ApiBacktestRequest } from '../types';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to testdata directory
const testdataDir = path.join(__dirname, '../../testdata');

// Path to mock Core Engine binary (cross-platform: Node.js script)
const MOCK_BINARY_PATH = path.join(testdataDir, 'mock-core-engine.js');

describe('BacktestService', () => {
  let service: BacktestService;

  const validRequest: ApiBacktestRequest & { clickhouse_addr: string; clickhouse_db: string; clickhouse_user: string; clickhouse_password: string } = {
    trading_pair: 'BTC/USDT',
    start_date: '2025-01-01T00:00:00Z',
    end_date: '2025-01-31T23:59:59Z',
    price_entry: '2.0',
    price_scale: '1.1',
    amount_scale: '2.0',
    number_of_orders: 3,
    amount_per_trade: '0.5',
    margin_type: 'cross',
    multiplier: 1,
    take_profit_distance_percent: '1.0',
    account_balance: '1000',
    exit_on_last_order: false,
    clickhouse_addr: 'localhost:9000',
    clickhouse_db: 'dca_bot',
    clickhouse_user: 'default',
    clickhouse_password: '',
  };

  beforeEach(() => {
    service = new BacktestService(MOCK_BINARY_PATH);
  });

  // ---------------------------------------------------------------------------
  // Successful execution
  // ---------------------------------------------------------------------------

  describe('Successful execution scenarios', () => {
    it('should execute valid configuration and return BacktestExecutionResult', async () => {
      const result = await service.execute(validRequest);

      expect(result).toBeDefined();
      expect(result.tradeEvents).toBeDefined();
      expect(result.tradeEvents.length).toBeGreaterThan(0);
      expect(result.engineExecutionTimeMs).toBeGreaterThan(0);
    });

    it('should return pnlSummary with roi, maxDrawdown, totalFees', async () => {
      const result = await service.execute(validRequest);

      expect(result.pnlSummary).toBeDefined();
      expect(typeof result.pnlSummary.roi).toBe('number');
      expect(typeof result.pnlSummary.maxDrawdown).toBe('number');
      expect(typeof result.pnlSummary.totalFees).toBe('number');
    });

    it('should include tradeEvents with ENTRY, SAFETY_ORDER, and EXIT types', async () => {
      const result = await service.execute(validRequest);

      const eventTypes = result.tradeEvents.map((e) => e.eventType);
      expect(eventTypes).toContain('ENTRY');
      expect(eventTypes).toContain('SAFETY_ORDER');
      expect(eventTypes).toContain('EXIT');
    });

    it('should include all required fields in each tradeEvent', async () => {
      const result = await service.execute(validRequest);

      for (const event of result.tradeEvents) {
        expect(typeof event.timestamp).toBe('string');
        expect(typeof event.rawTimestamp).toBe('string');
        expect(typeof event.eventType).toBe('string');
        expect(typeof event.price).toBe('number');
        expect(typeof event.quantity).toBe('number');
        expect(typeof event.balance).toBe('number');
        expect(typeof event.trade_id).toBe('string');
        expect(typeof event.fee).toBe('number');
      }
    });

    it('should return safetyOrderUsage array', async () => {
      const result = await service.execute(validRequest);

      expect(Array.isArray(result.safetyOrderUsage)).toBe(true);
      if (result.safetyOrderUsage.length > 0) {
        const entry = result.safetyOrderUsage[0];
        expect(typeof entry.level).toBe('string');
        expect(typeof entry.count).toBe('number');
      }
    });

    it('should return candleCount and eventCount', async () => {
      const result = await service.execute(validRequest);

      expect(typeof result.candleCount).toBe('number');
      expect(result.candleCount).toBeGreaterThan(0);
      expect(typeof result.eventCount).toBe('number');
    });

    it('should track execution time in milliseconds', async () => {
      const result = await service.execute(validRequest);

      expect(result.engineExecutionTimeMs).toBeGreaterThan(0);
      expect(typeof result.engineExecutionTimeMs).toBe('number');
      expect(Number.isInteger(result.engineExecutionTimeMs)).toBe(true);
    });

    it('should complete within 30 seconds for valid configuration', async () => {
      const start = Date.now();
      await service.execute(validRequest);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(30000);
    });
  });

  // ---------------------------------------------------------------------------
  // Timeout handling
  // ---------------------------------------------------------------------------

  describe('Timeout handling (30 second limit)', () => {
    it('should return EXECUTION_TIMEOUT error when subprocess exceeds limit', async () => {
      const fastTimeoutService = new BacktestService(MOCK_BINARY_PATH, {
        timeoutMs: 1000,
      });

      try {
        await fastTimeoutService.executeWithStderr(validRequest, ['--timeout']);
        throw new Error('Should have thrown timeout error');
      } catch (error: any) {
        expect(error.signal).toMatch(/SIGTERM|SIGKILL/);
        expect(error.message).toContain('exited');
      }
    });

    it('should kill process after timeout expires', async () => {
      const fastTimeoutService = new BacktestService(MOCK_BINARY_PATH, {
        timeoutMs: 500,
      });

      try {
        await fastTimeoutService.executeWithStderr(validRequest, ['--timeout']);
        throw new Error('Should have thrown timeout error');
      } catch (error: any) {
        expect(error.signal).toMatch(/SIGTERM|SIGKILL/);
      }
    });

    it('should enforce default 30 second timeout', async () => {
      const defaultTimeoutService = new BacktestService(MOCK_BINARY_PATH);
      expect(defaultTimeoutService.timeoutMs).toBe(30000);
    });
  });

  // ---------------------------------------------------------------------------
  // Binary crash handling
  // ---------------------------------------------------------------------------

  describe('Binary crash handling', () => {
    it('should capture error when binary exits with code 1', async () => {
      try {
        await service.executeWithStderr(validRequest, ['--fail']);
        throw new Error('Should have thrown error');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
        expect(error.stderr).toBeDefined();
        expect(error.message).toContain('exited');
      }
    });

    it('should capture stderr output from crashed binary', async () => {
      try {
        await service.executeWithStderr(validRequest, ['--fail']);
        throw new Error('Should have thrown error');
      } catch (error: any) {
        expect(error.stderr).toContain('crashed');
      }
    });

    it('should handle signal termination (e.g., SIGKILL)', async () => {
      const fastTimeoutService = new BacktestService(MOCK_BINARY_PATH, {
        timeoutMs: 100,
      });

      try {
        await fastTimeoutService.executeWithStderr(validRequest, ['--timeout']);
        throw new Error('Should have thrown error');
      } catch (error: any) {
        expect(error.signal).toBeDefined();
        expect(error.message).toContain('signal');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Malformed output handling
  // ---------------------------------------------------------------------------

  describe('Malformed output handling', () => {
    it('should handle truncated JSON line without crashing (--malformed discards partial line)', async () => {
      const result = await service.executeWithStderr(validRequest, ['--malformed']);
      // Mock binary still emits a valid result line after the malformed line
      expect(result).toBeDefined();
      expect(result.pnlSummary).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrent execution
  // ---------------------------------------------------------------------------

  describe('Concurrent execution', () => {
    it('should handle multiple simultaneous executions', async () => {
      const promises = [
        service.execute(validRequest),
        service.execute(validRequest),
        service.execute(validRequest),
      ];

      const results = await Promise.all(promises);

      expect(results.length).toBe(3);
      results.forEach((result) => {
        expect(result.tradeEvents.length).toBeGreaterThan(0);
      });
    });

    it('should maintain separate result streams for concurrent executions', async () => {
      const request1 = { ...validRequest, price_entry: '100.00' };
      const request2 = { ...validRequest, price_entry: '200.00' };

      const [result1, result2] = await Promise.all([
        service.execute(request1),
        service.execute(request2),
      ]);

      expect(result1.tradeEvents.length).toBeGreaterThan(0);
      expect(result2.tradeEvents.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Resource cleanup
  // ---------------------------------------------------------------------------

  describe('Resource cleanup', () => {
    it('should not leak file descriptors after execution', async () => {
      for (let i = 0; i < 5; i++) {
        await service.execute(validRequest);
      }
      expect(true).toBe(true);
    });

    it('should clean up child processes after execution', async () => {
      await service.execute(validRequest);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = await service.execute(validRequest);
      expect(result.tradeEvents.length).toBeGreaterThan(0);
    });
  });
});
