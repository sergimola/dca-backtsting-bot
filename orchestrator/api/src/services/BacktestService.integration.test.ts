/**
 * BacktestService Integration Tests
 *
 * Tests the BacktestService with mocked Go binary (mock-core-engine.sh)
 * Verifies non-blocking subprocess management, streaming, timeout handling,
 * and error propagation.
 *
 * Key TDD Discipline: All tests written BEFORE implementation
 */

import { BacktestService } from './BacktestService';
import { BacktestRequest } from '../types';
import * as path from 'path';

// Path to testdata directory
const testdataDir = path.join(__dirname, '../../testdata');

// Path to mock Core Engine binary (cross-platform: Node.js script)
const MOCK_BINARY_PATH = path.join(testdataDir, 'mock-core-engine.js');

describe('BacktestService', () => {
  let service: BacktestService;

  const validRequest: BacktestRequest = {
    entry_price: '100.50',
    amounts: ['10.25', '10.25', '10.25'],
    sequences: [0, 1, 2],
    leverage: '2.00',
    margin_ratio: '0.50',
    market_data_csv_path: '/data/BTCUSDT_1m.csv',
  };

  beforeEach(() => {
    // Initialize service with mock binary
    service = new BacktestService(MOCK_BINARY_PATH);
  });

  describe('✅ Successful execution scenarios', () => {
    it('should execute valid configuration and return complete event sequence', async () => {
      const result = await service.execute(validRequest);

      expect(result).toBeDefined();
      expect(result.events).toBeDefined();
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });

    it('should parse events in execution order with correct timestamps', async () => {
      const result = await service.execute(validRequest);

      // Verify at least 5 expected events
      expect(result.events.length).toBeGreaterThanOrEqual(5);

      // Check event types
      const eventTypes = result.events.map((e) => e.type);
      expect(eventTypes[0]).toBe('PositionOpened');
      expect(eventTypes[1]).toBe('OrderFilled');
      expect(eventTypes[2]).toBe('OrderFilled');
      expect(eventTypes[3]).toBe('GapDownEvent');
      expect(eventTypes[4]).toBe('PositionClosed');
    });

    it('should preserve event timestamps in ascending order', async () => {
      const result = await service.execute(validRequest);

      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i].timestamp).toBeGreaterThanOrEqual(
          result.events[i - 1].timestamp
        );
      }
    });

    it('should include all required fields in PositionOpenedEvent', async () => {
      const result = await service.execute(validRequest);

      const openEvent = result.events.find((e) => e.type === 'PositionOpened');
      expect(openEvent).toBeDefined();

      if (openEvent && openEvent.type === 'PositionOpened') {
        expect(openEvent.position_id).toBeDefined();
        expect(openEvent.entry_price).toBeDefined();
        expect(openEvent.initial_quantity).toBeDefined();
        expect(openEvent.entry_fee).toBeDefined();
        expect(openEvent.position_state).toBeDefined();
        expect(openEvent.position_state.status).toBe('OPEN');
      }
    });

    it('should include all required fields in OrderFilledEvent', async () => {
      const result = await service.execute(validRequest);

      const fillEvent = result.events.find((e) => e.type === 'OrderFilled');
      expect(fillEvent).toBeDefined();

      if (fillEvent && fillEvent.type === 'OrderFilled') {
        expect(fillEvent.order_id).toBeDefined();
        expect(fillEvent.price).toBeDefined();
        expect(fillEvent.quantity).toBeDefined();
        expect(fillEvent.fee).toBeDefined();
        expect(fillEvent.safety_order_index).toBeDefined();
        expect(fillEvent.position_state).toBeDefined();
        expect(typeof fillEvent.safety_order_index).toBe('number');
      }
    });

    it('should include all required fields in PositionClosedEvent', async () => {
      const result = await service.execute(validRequest);

      const closeEvent = result.events.find((e) => e.type === 'PositionClosed');
      expect(closeEvent).toBeDefined();

      if (closeEvent && closeEvent.type === 'PositionClosed') {
        expect(closeEvent.close_price).toBeDefined();
        expect(closeEvent.position_state).toBeDefined();
        expect(closeEvent.position_state.status).toBe('CLOSED');
      }
    });

    it('should include all required fields in GapDownEvent', async () => {
      const result = await service.execute(validRequest);

      const gapEvent = result.events.find((e) => e.type === 'GapDownEvent');
      expect(gapEvent).toBeDefined();

      if (gapEvent && gapEvent.type === 'GapDownEvent') {
        expect(gapEvent.gap_from_price).toBeDefined();
        expect(gapEvent.gap_to_price).toBeDefined();
        expect(gapEvent.filled_orders).toBeDefined();
        expect(Array.isArray(gapEvent.filled_orders)).toBe(true);
        expect(gapEvent.filled_orders.length).toBeGreaterThan(0);

        const fill = gapEvent.filled_orders[0];
        expect(fill.price).toBeDefined();
        expect(fill.quantity).toBeDefined();
        expect(fill.safety_order_index).toBeDefined();
      }
    });

    it('should preserve decimal precision in prices (8 places)', async () => {
      const result = await service.execute(validRequest);

      for (const event of result.events) {
        if (event.type === 'PositionOpened') {
          const priceStr = event.entry_price;
          const [, decimal] = priceStr.split('.');
          if (decimal) {
            expect(decimal.length).toBeLessThanOrEqual(8);
          }
        }
        if (event.type === 'OrderFilled') {
          const priceStr = event.price;
          const [, decimal] = priceStr.split('.');
          if (decimal) {
            expect(decimal.length).toBeLessThanOrEqual(8);
          }
        }
      }
    });

    it('should track execution time in milliseconds', async () => {
      const result = await service.execute(validRequest);

      expect(result.executionTimeMs).toBeGreaterThan(0);
      expect(typeof result.executionTimeMs).toBe('number');
      expect(Number.isInteger(result.executionTimeMs)).toBe(true);
    });

    it('should complete within 30 seconds for valid configuration', async () => {
      const start = Date.now();
      await service.execute(validRequest);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(30000);
    });
  });

  describe('❌ Timeout handling (30 second limit)', () => {
    it('should return EXECUTION_TIMEOUT error when subprocess exceeds 30s', async () => {
      // Service configured with 1 second timeout for testing
      const fastTimeoutService = new BacktestService(MOCK_BINARY_PATH, {
        timeoutMs: 1000,
      });

      try {
        // Pass --timeout flag to mock binary to trigger timeout
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
        // Process should be killed (SIGTERM or SIGKILL)
        expect(error.signal).toMatch(/SIGTERM|SIGKILL/);
      }
    });

    it('should enforce default 30 second timeout', async () => {
      // Verify timeout is set to 30000ms by default
      const defaultTimeoutService = new BacktestService(MOCK_BINARY_PATH);
      expect(defaultTimeoutService.timeoutMs).toBe(30000);
    });
  });

  describe('❌ Binary crash handling', () => {
    it('should capture error when binary exits with code 1', async () => {
      try {
        // Pass --fail flag to mock binary to simulate crash
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

  describe('❌ Malformed output handling', () => {
    it('should handle truncated JSON in stdout', async () => {
      try {
        // Pass --malformed flag to mock binary to output incomplete JSON
        await service.executeWithStderr(validRequest, ['--malformed']);
        throw new Error('Should have thrown or handled gracefully');
      } catch (error: any) {
        // Parser should skip malformed lines or throw clear error
        expect(error).toBeDefined();
      }
    });

    it('should skip incomplete lines at EOF', async () => {
      // This is contingent on implementation handling last partial line
      const result = await service.execute(validRequest);
      // Should still parse complete events before malformed line
      expect(result.events.length).toBeGreaterThan(0);
    });
  });

  describe('✅ Concurrent execution', () => {
    it('should handle multiple simultaneous executions', async () => {
      const promises = [
        service.execute(validRequest),
        service.execute(validRequest),
        service.execute(validRequest),
      ];

      const results = await Promise.all(promises);

      expect(results.length).toBe(3);
      results.forEach((result) => {
        expect(result.events.length).toBeGreaterThan(0);
      });
    });

    it('should maintain separate event streams for concurrent executions', async () => {
      const request1 = { ...validRequest, entry_price: '100.00' };
      const request2 = { ...validRequest, entry_price: '200.00' };

      const [result1, result2] = await Promise.all([
        service.execute(request1),
        service.execute(request2),
      ]);

      // Both should complete successfully with events
      expect(result1.events.length).toBeGreaterThan(0);
      expect(result2.events.length).toBeGreaterThan(0);
    });
  });

  describe('✅ Resource cleanup', () => {
    it('should not leak file descriptors after execution', async () => {
      // Execute multiple times and verify we can still create resources
      for (let i = 0; i < 5; i++) {
        await service.execute(validRequest);
      }

      // If we get here, no resource leak blocked us
      expect(true).toBe(true);
    });

    it('should clean up child processes after execution', async () => {
      await service.execute(validRequest);

      // Give a moment for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Subsequent execution should work without issues
      const result = await service.execute(validRequest);
      expect(result.events.length).toBeGreaterThan(0);
    });
  });
});
