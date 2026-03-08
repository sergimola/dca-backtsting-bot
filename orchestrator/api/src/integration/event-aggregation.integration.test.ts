/**
 * Event Aggregation Integration Tests (T024)
 *
 * End-to-end tests verifying complete flow:
 * Mock binary → BacktestService → ndjson → EventBusParser → ResultAggregator → PnlSummary
 */

import { BacktestService } from '../services/BacktestService';
import { ResultAggregator } from '../services/ResultAggregator';
import { BacktestRequest } from '../types';
import * as path from 'path';
import Decimal from 'decimal.js';
import * as PrecisionFormatter from '../utils/PrecisionFormatter';

describe('Event Aggregation Integration', () => {
  let service: BacktestService;
  let aggregator: ResultAggregator;

  const testdataDir = path.join(__dirname, '../../testdata');
  const MOCK_BINARY_PATH = path.join(testdataDir, 'mock-core-engine.js');

  beforeEach(() => {
    service = new BacktestService(MOCK_BINARY_PATH);
    aggregator = new ResultAggregator();
  });

  describe('✅ End-to-end workflow', () => {
    it('should execute backtest and aggregate events into PnlSummary', async () => {
      const request: BacktestRequest = {
        entry_price: '100.50',
        amounts: ['10.25', '10.25', '10.25'],
        sequences: [0, 1, 2],
        leverage: '2.00',
        margin_ratio: '0.50',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      // Step 1: Execute backtest with mock binary
      const result = await service.execute(request);

      expect(result.events.length).toBeGreaterThan(0);
      expect(result.executionTimeMs).toBeGreaterThan(0);

      // Step 2: Aggregate events into PnlSummary
      const summary = await aggregator.aggregateEvents(result.events);

      expect(summary).toBeDefined();
      expect(summary.total_fills).toBe(3); // 3 OrderFilled events from mock
      expect(summary.safety_order_usage_counts[0]).toBe(1);
      expect(summary.safety_order_usage_counts[1]).toBe(1);
      expect(summary.safety_order_usage_counts[2]).toBe(1);
    });

    it('should preserve decimal precision through full pipeline', async () => {
      const request: BacktestRequest = {
        entry_price: '100.50',
        amounts: ['10.25', '10.25', '10.25'],
        sequences: [0, 1, 2],
        leverage: '2.00',
        margin_ratio: '0.50',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const result = await service.execute(request);
      const summary = await aggregator.aggregateEvents(result.events);

      // Verify all monetary values have proper precision
      const pnlParts = summary.total_pnl.split('.');
      if (pnlParts.length === 2) {
        expect(pnlParts[1].length).toBeLessThanOrEqual(8);
      }

      const roiParts = summary.roi_percent.split('.');
      if (roiParts.length === 2) {
        expect(roiParts[1].length).toBeLessThanOrEqual(2);
      }

      // Fee values should have 8 decimal places
      expect(summary.entry_fee).toMatch(/\.\d{8}$/);
    });

    it('should correctly count fills in safety_order_usage_counts', async () => {
      const request: BacktestRequest = {
        entry_price: '100.50',
        amounts: ['10.25', '10.25', '10.25'],
        sequences: [0, 1, 2],
        leverage: '2.00',
        margin_ratio: '0.50',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const result = await service.execute(request);
      const summary = await aggregator.aggregateEvents(result.events);

      // Mock binary generates 3 OrderFilled + 1 GapDownEvent
      // OrderFilled indices: 0, 1 (from mock)
      // GapDownEvent: 1 fill with index 2
      expect(summary.safety_order_usage_counts[0]).toBe(1);
      expect(summary.safety_order_usage_counts[1]).toBe(1);
      expect(summary.safety_order_usage_counts[2]).toBe(1);

      const totalFills = Object.values(summary.safety_order_usage_counts).reduce(
        (a, b) => a + b,
        0
      );
      expect(summary.total_fills).toBe(totalFills);
    });
  });

  describe('✅ Event structure validation', () => {
    it('should handle all 5 event types in canonical sequence', async () => {
      const request: BacktestRequest = {
        entry_price: '100.50',
        amounts: ['10.25', '10.25', '10.25'],
        sequences: [0, 1, 2],
        leverage: '2.00',
        margin_ratio: '0.50',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const result = await service.execute(request);

      // Verify we received the expected event sequence
      const eventTypes = result.events.map((e) => e.type);
      expect(eventTypes[0]).toBe('PositionOpened');
      expect(eventTypes).toContain('OrderFilled');
      expect(eventTypes).toContain('GapDownEvent');
      expect(eventTypes[eventTypes.length - 1]).toBe('PositionClosed');
    });

    it('should have valid PositionState in each event', async () => {
      const request: BacktestRequest = {
        entry_price: '100.50',
        amounts: ['10.25', '10.25', '10.25'],
        sequences: [0, 1, 2],
        leverage: '2.00',
        margin_ratio: '0.50',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const result = await service.execute(request);

      for (const event of result.events) {
        expect(event.position_state).toBeDefined();
        expect(event.position_state.quantity).toBeDefined();
        expect(event.position_state.average_cost).toBeDefined();
        expect(event.position_state.total_invested).toBeDefined();
        expect(event.position_state.leverage_level).toBeDefined();
        expect(event.position_state.status).toMatch(/OPEN|CLOSED|LIQUIDATED/);
        expect(event.position_state.last_update_timestamp).toBeGreaterThan(0);
      }
    });

    it('should maintain chronological timestamp ordering', async () => {
      const request: BacktestRequest = {
        entry_price: '100.50',
        amounts: ['10.25', '10.25', '10.25'],
        sequences: [0, 1, 2],
        leverage: '2.00',
        margin_ratio: '0.50',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const result = await service.execute(request);

      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i].timestamp).toBeGreaterThanOrEqual(
          result.events[i - 1].timestamp
        );
      }
    });
  });

  describe('✅ PnLSummary calculations', () => {
    it('should compute meaningful P&L and ROI from mock events', async () => {
      const request: BacktestRequest = {
        entry_price: '100.50',
        amounts: ['10.25', '10.25', '10.25'],
        sequences: [0, 1, 2],
        leverage: '2.00',
        margin_ratio: '0.50',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const result = await service.execute(request);
      const summary = await aggregator.aggregateEvents(result.events);

      // Verify calculations are present
      expect(summary.total_pnl).toBeDefined();
      expect(summary.roi_percent).toBeDefined();
      expect(summary.entry_fee).toBeDefined();
      expect(summary.trading_fees).toBeDefined();
      expect(summary.total_fees).toBeDefined();

      // Verify relationships
      const totalFees = new Decimal(summary.entry_fee).plus(summary.trading_fees);
      expect(summary.total_fees).toBe(PrecisionFormatter.formatPrice(totalFees));
    });

    it('should format all outputs with proper precision', async () => {
      const request: BacktestRequest = {
        entry_price: '100.50',
        amounts: ['10.25', '10.25', '10.25'],
        sequences: [0, 1, 2],
        leverage: '2.00',
        margin_ratio: '0.50',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const result = await service.execute(request);
      const summary = await aggregator.aggregateEvents(result.events);

      // Verify decimal precision in output
      // Monetary values should have 8 places
      const validatePrice = (value: string | undefined) => {
        if (!value) return;
        const parts = value.split('.');
        if (parts.length === 2) {
          expect(parts[1].length).toBeLessThanOrEqual(8);
        }
      };

      validatePrice(summary.total_pnl);
      validatePrice(summary.entry_fee);
      validatePrice(summary.trading_fees);
      validatePrice(summary.total_fees);

      // ROI should have 2 decimal places
      if (summary.roi_percent) {
        const roiParts = summary.roi_percent.split('.');
        if (roiParts.length === 2) {
          expect(roiParts[1].length).toBeLessThanOrEqual(2);
        }
      }
    });

    it('should match canonical test expectations', async () => {
      const request: BacktestRequest = {
        entry_price: '100.50',
        amounts: ['10.25', '10.25', '10.25'],
        sequences: [0, 1, 2],
        leverage: '2.00',
        margin_ratio: '0.50',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      const result = await service.execute(request);
      const summary = await aggregator.aggregateEvents(result.events);

      // From mock-core-engine.js canonical sequence:
      // Entry: price 100.50, qty 10.25, fee 1.00
      // Fill 0: price 95.00, qty 10.25, fee 0.10
      // Fill 1: price 90.00, qty 10.25, fee 0.10
      // Gap-down fill 2: price 85.00, qty 10.25, fee (included in position)
      // Close: price 102.00

      expect(summary.total_fills).toBe(3); // 2 OrderFilled + 1 GapDownFill
      expect(summary.entry_fee).toBe('1.00000000');
      expect(summary.trading_fees).toBe('0.20000000'); // 0.10 + 0.10
      expect(summary.safety_order_usage_counts[0]).toBe(1);
      expect(summary.safety_order_usage_counts[1]).toBe(1);
      expect(summary.safety_order_usage_counts[2]).toBe(1);
    });
  });

  describe('✅ Timeout and error scenarios', () => {
    it('should handle timeout gracefully', async () => {
      const fastTimeoutService = new BacktestService(MOCK_BINARY_PATH, {
        timeoutMs: 100,
      });

      const request: BacktestRequest = {
        entry_price: '100.50',
        amounts: ['10.25', '10.25', '10.25'],
        sequences: [0, 1, 2],
        leverage: '2.00',
        margin_ratio: '0.50',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      try {
        await fastTimeoutService.executeWithStderr(request, ['--timeout']);
        fail('Should have thrown timeout error');
      } catch (error: any) {
        expect(error.signal).toMatch(/SIGTERM|SIGKILL/);
      }
    });

    it('should handle binary crash gracefully', async () => {
      const request: BacktestRequest = {
        entry_price: '100.50',
        amounts: ['10.25', '10.25', '10.25'],
        sequences: [0, 1, 2],
        leverage: '2.00',
        margin_ratio: '0.50',
        market_data_csv_path: '/data/BTCUSDT_1m.csv',
      };

      try {
        await service.executeWithStderr(request, ['--fail']);
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
        expect(error.stderr).toBeDefined();
      }
    });
  });
});
