/**
 * ResultAggregator Tests
 *
 * Comprehensive test coverage for PnlSummary aggregation from event streams.
 * Tests all calculation paths: simple positions, DCA scenarios, liquidations, gap-downs.
 */

import { ResultAggregator } from './ResultAggregator';
import { TradeEvent } from '../types';
import Decimal from 'decimal.js';
import * as PrecisionFormatter from '../utils/PrecisionFormatter';

describe('ResultAggregator', () => {
  let aggregator: ResultAggregator;

  beforeEach(() => {
    aggregator = new ResultAggregator();
  });

  describe('✅ Simple position scenarios', () => {
    it('should aggregate single entry then close with no fills', async () => {
      const events: TradeEvent[] = [
        {
          type: 'PositionOpened',
          timestamp: 1000,
          position_id: 'pos-1',
          entry_price: '100.00000000',
          initial_quantity: '1.00000000',
          entry_fee: '1.00000000',
          position_state: {
            quantity: '1.00000000',
            average_cost: '100.00000000',
            total_invested: '101.00000000',
            leverage_level: '1.00000000',
            status: 'OPEN',
            last_update_timestamp: 1000,
          },
        },
        {
          type: 'PositionClosed',
          timestamp: 2000,
          close_price: '100.00000000',
          position_state: {
            quantity: '1.00000000',
            average_cost: '100.00000000',
            total_invested: '101.00000000',
            leverage_level: '1.00000000',
            status: 'CLOSED',
            last_update_timestamp: 2000,
          },
        },
      ];

      const summary = await aggregator.aggregateEvents(events);

      expect(summary.total_fills).toBe(0);
      expect(summary.total_pnl).toBe('-1.00000000');
      expect(summary.entry_fee).toBe('1.00000000');
      expect(summary.trading_fees).toBe('0.00000000');
    });

    it('should calculate correct ROI for simple profitable position', async () => {
      const events: TradeEvent[] = [
        {
          type: 'PositionOpened',
          timestamp: 1000,
          position_id: 'pos-1',
          entry_price: '100.00000000',
          initial_quantity: '10.00000000',
          entry_fee: '10.00000000',
          position_state: {
            quantity: '10.00000000',
            average_cost: '100.00000000',
            total_invested: '1010.00000000',
            leverage_level: '1.00000000',
            status: 'OPEN',
            last_update_timestamp: 1000,
          },
        },
        {
          type: 'PositionClosed',
          timestamp: 2000,
          close_price: '110.00000000',
          position_state: {
            quantity: '10.00000000',
            average_cost: '100.00000000',
            total_invested: '1010.00000000',
            leverage_level: '1.00000000',
            status: 'CLOSED',
            last_update_timestamp: 2000,
          },
        },
      ];

      const summary = await aggregator.aggregateEvents(events);

      const expectedPnl = new Decimal('10').times('110').minus('1010');
      expect(summary.total_pnl).toBe(PrecisionFormatter.formatPrice(expectedPnl));
      expect(parseFloat(summary.roi_percent)).toBeCloseTo(
        expectedPnl.dividedBy('1010').times('100').toNumber(),
        2
      );
    });
  });

  describe('✅ Multi-fill DCA scenarios', () => {
    it('should count fills and track safety order indices correctly', async () => {
      const events: TradeEvent[] = [
        {
          type: 'PositionOpened',
          timestamp: 1000,
          position_id: 'pos-1',
          entry_price: '100.00000000',
          initial_quantity: '10.00000000',
          entry_fee: '1.00000000',
          position_state: {
            quantity: '10.00000000',
            average_cost: '100.00000000',
            total_invested: '1001.00000000',
            leverage_level: '2.00000000',
            status: 'OPEN',
            last_update_timestamp: 1000,
          },
        },
        {
          type: 'OrderFilled',
          timestamp: 1100,
          order_id: 'ord-1',
          price: '95.00000000',
          quantity: '10.00000000',
          fee: '0.10000000',
          safety_order_index: 0,
          position_state: {
            quantity: '20.00000000',
            average_cost: '97.50000000',
            total_invested: '2001.00000000',
            leverage_level: '2.00000000',
            status: 'OPEN',
            last_update_timestamp: 1100,
          },
        },
        {
          type: 'OrderFilled',
          timestamp: 1200,
          order_id: 'ord-2',
          price: '90.00000000',
          quantity: '10.00000000',
          fee: '0.10000000',
          safety_order_index: 1,
          position_state: {
            quantity: '30.00000000',
            average_cost: '95.00000000',
            total_invested: '3001.00000000',
            leverage_level: '2.00000000',
            status: 'OPEN',
            last_update_timestamp: 1200,
          },
        },
        {
          type: 'PositionClosed',
          timestamp: 2000,
          close_price: '100.00000000',
          position_state: {
            quantity: '30.00000000',
            average_cost: '95.00000000',
            total_invested: '3001.00000000',
            leverage_level: '2.00000000',
            status: 'CLOSED',
            last_update_timestamp: 2000,
          },
        },
      ];

      const summary = await aggregator.aggregateEvents(events);

      expect(summary.total_fills).toBe(2);
      expect(summary.safety_order_usage_counts[0]).toBe(1);
      expect(summary.safety_order_usage_counts[1]).toBe(1);
      expect(summary.entry_fee).toBe('1.00000000');
      expect(summary.trading_fees).toBe('0.20000000');
    });

    it('should track multiple fills at same safety order index', async () => {
      const events: TradeEvent[] = [
        {
          type: 'PositionOpened',
          timestamp: 1000,
          position_id: 'pos-1',
          entry_price: '100.00000000',
          initial_quantity: '10.00000000',
          entry_fee: '0.50000000',
          position_state: {
            quantity: '10.00000000',
            average_cost: '100.00000000',
            total_invested: '1000.50000000',
            leverage_level: '1.00000000',
            status: 'OPEN',
            last_update_timestamp: 1000,
          },
        },
        {
          type: 'OrderFilled',
          timestamp: 1100,
          order_id: 'ord-1',
          price: '95.00000000',
          quantity: '5.00000000',
          fee: '0.05000000',
          safety_order_index: 0,
          position_state: {
            quantity: '15.00000000',
            average_cost: '97.50000000',
            total_invested: '1500.55000000',
            leverage_level: '1.00000000',
            status: 'OPEN',
            last_update_timestamp: 1100,
          },
        },
        {
          type: 'OrderFilled',
          timestamp: 1150,
          order_id: 'ord-2',
          price: '92.00000000',
          quantity: '5.00000000',
          fee: '0.05000000',
          safety_order_index: 0,
          position_state: {
            quantity: '20.00000000',
            average_cost: '95.25000000',
            total_invested: '2000.60000000',
            leverage_level: '1.00000000',
            status: 'OPEN',
            last_update_timestamp: 1150,
          },
        },
        {
          type: 'PositionClosed',
          timestamp: 2000,
          close_price: '100.00000000',
          position_state: {
            quantity: '20.00000000',
            average_cost: '95.25000000',
            total_invested: '2000.60000000',
            leverage_level: '1.00000000',
            status: 'CLOSED',
            last_update_timestamp: 2000,
          },
        },
      ];

      const summary = await aggregator.aggregateEvents(events);

      expect(summary.total_fills).toBe(2);
      expect(summary.safety_order_usage_counts[0]).toBe(2);
    });
  });

  describe('✅ Gap-down event scenarios', () => {
    it('should count gap-down fills in safety order usage', async () => {
      const events: TradeEvent[] = [
        {
          type: 'PositionOpened',
          timestamp: 1000,
          position_id: 'pos-1',
          entry_price: '100.00000000',
          initial_quantity: '10.00000000',
          entry_fee: '0.50000000',
          position_state: {
            quantity: '10.00000000',
            average_cost: '100.00000000',
            total_invested: '1000.50000000',
            leverage_level: '2.00000000',
            status: 'OPEN',
            last_update_timestamp: 1000,
          },
        },
        {
          type: 'GapDownEvent',
          timestamp: 1100,
          gap_from_price: '100.00000000',
          gap_to_price: '85.00000000',
          filled_orders: [
            {
              price: '85.00000000',
              quantity: '5.00000000',
              safety_order_index: 0,
            },
            {
              price: '85.00000000',
              quantity: '5.00000000',
              safety_order_index: 1,
            },
          ],
          position_state: {
            quantity: '20.00000000',
            average_cost: '92.50000000',
            total_invested: '2000.50000000',
            leverage_level: '2.00000000',
            status: 'OPEN',
            last_update_timestamp: 1100,
          },
        },
        {
          type: 'PositionClosed',
          timestamp: 2000,
          close_price: '90.00000000',
          position_state: {
            quantity: '20.00000000',
            average_cost: '92.50000000',
            total_invested: '2000.50000000',
            leverage_level: '2.00000000',
            status: 'CLOSED',
            last_update_timestamp: 2000,
          },
        },
      ];

      const summary = await aggregator.aggregateEvents(events);

      expect(summary.total_fills).toBe(2);
      expect(summary.safety_order_usage_counts[0]).toBe(1);
      expect(summary.safety_order_usage_counts[1]).toBe(1);
    });
  });

  describe('✅ Liquidation scenarios', () => {
    it('should track liquidation fee and mark status as liquidated', async () => {
      const events: TradeEvent[] = [
        {
          type: 'PositionOpened',
          timestamp: 1000,
          position_id: 'pos-1',
          entry_price: '100.00000000',
          initial_quantity: '10.00000000',
          entry_fee: '1.00000000',
          position_state: {
            quantity: '10.00000000',
            average_cost: '100.00000000',
            total_invested: '1001.00000000',
            leverage_level: '3.00000000',
            status: 'OPEN',
            last_update_timestamp: 1000,
          },
        },
        {
          type: 'OrderFilled',
          timestamp: 1100,
          order_id: 'ord-1',
          price: '90.00000000',
          quantity: '10.00000000',
          fee: '0.10000000',
          safety_order_index: 0,
          position_state: {
            quantity: '20.00000000',
            average_cost: '95.00000000',
            total_invested: '2001.00000000',
            leverage_level: '3.00000000',
            status: 'OPEN',
            last_update_timestamp: 1100,
          },
        },
        {
          type: 'LiquidationEvent',
          timestamp: 1500,
          liquidation_price: '80.00000000',
          liquidation_fee: '50.00000000',
          position_state: {
            quantity: '20.00000000',
            average_cost: '95.00000000',
            total_invested: '2001.00000000',
            leverage_level: '3.00000000',
            status: 'LIQUIDATED',
            last_update_timestamp: 1500,
          },
        },
      ];

      const summary = await aggregator.aggregateEvents(events);

      expect(summary.liquidation_fee).toBe('50.00000000');
      expect(summary.total_fills).toBe(1);
      expect(parseFloat(summary.total_pnl)).toBeLessThan(0);
    });
  });

  describe('❌ Error handling', () => {
    it('should throw error on empty event list', async () => {
      await expect(aggregator.aggregateEvents([])).rejects.toThrow(
        'Cannot aggregate empty event list'
      );
    });

    it('should throw error when events not in chronological order', async () => {
      const events: TradeEvent[] = [
        {
          type: 'PositionOpened',
          timestamp: 2000,
          position_id: 'pos-1',
          entry_price: '100.00000000',
          initial_quantity: '10.00000000',
          entry_fee: '1.00000000',
          position_state: {
            quantity: '10.00000000',
            average_cost: '100.00000000',
            total_invested: '1001.00000000',
            leverage_level: '1.00000000',
            status: 'OPEN',
            last_update_timestamp: 2000,
          },
        },
        {
          type: 'PositionClosed',
          timestamp: 1000, // Earlier timestamp!
          close_price: '100.00000000',
          position_state: {
            quantity: '10.00000000',
            average_cost: '100.00000000',
            total_invested: '1001.00000000',
            leverage_level: '1.00000000',
            status: 'CLOSED',
            last_update_timestamp: 1000,
          },
        },
      ];

      await expect(aggregator.aggregateEvents(events)).rejects.toThrow(
        'not in chronological order'
      );
    });

    it('should throw error when missing PositionOpenedEvent', async () => {
      const events: TradeEvent[] = [
        {
          type: 'PositionClosed',
          timestamp: 2000,
          close_price: '100.00000000',
          position_state: {
            quantity: '10.00000000',
            average_cost: '100.00000000',
            total_invested: '1001.00000000',
            leverage_level: '1.00000000',
            status: 'CLOSED',
            last_update_timestamp: 2000,
          },
        },
      ];

      await expect(aggregator.aggregateEvents(events)).rejects.toThrow(
        'Missing PositionOpenedEvent'
      );
    });
  });

  describe('✅ Precision guarantees', () => {
    it('should maintain 8 decimal place precision in fee calculations', async () => {
      const events: TradeEvent[] = [
        {
          type: 'PositionOpened',
          timestamp: 1000,
          position_id: 'pos-1',
          entry_price: '100.12345678',
          initial_quantity: '10.87654321',
          entry_fee: '1.23456789',
          position_state: {
            quantity: '10.87654321',
            average_cost: '100.12345678',
            total_invested: '1190.39802467',
            leverage_level: '1.00000000',
            status: 'OPEN',
            last_update_timestamp: 1000,
          },
        },
        {
          type: 'OrderFilled',
          timestamp: 1100,
          order_id: 'ord-1',
          price: '99.11111111',
          quantity: '5.55555555',
          fee: '0.12345678',
          safety_order_index: 0,
          position_state: {
            quantity: '16.43209876',
            average_cost: '99.88888889',
            total_invested: '1640.52688145',
            leverage_level: '1.00000000',
            status: 'OPEN',
            last_update_timestamp: 1100,
          },
        },
        {
          type: 'PositionClosed',
          timestamp: 2000,
          close_price: '101.11111111',
          position_state: {
            quantity: '16.43209876',
            average_cost: '99.88888889',
            total_invested: '1640.52688145',
            leverage_level: '1.00000000',
            status: 'CLOSED',
            last_update_timestamp: 2000,
          },
        },
      ];

      const summary = await aggregator.aggregateEvents(events);

      // Verify total_fees is properly summed
      expect(summary.entry_fee).toBe('1.23456789');
      expect(summary.trading_fees).toBe('0.12345678');
      const totalFees = new Decimal(summary.entry_fee).plus(summary.trading_fees);
      expect(summary.total_fees).toBe(totalFees.toString());
    });
  });

  describe('✅ Edge cases', () => {
    it('should handle zero fees correctly', async () => {
      const events: TradeEvent[] = [
        {
          type: 'PositionOpened',
          timestamp: 1000,
          position_id: 'pos-1',
          entry_price: '100.00000000',
          initial_quantity: '1.00000000',
          entry_fee: '0.00000000',
          position_state: {
            quantity: '1.00000000',
            average_cost: '100.00000000',
            total_invested: '100.00000000',
            leverage_level: '1.00000000',
            status: 'OPEN',
            last_update_timestamp: 1000,
          },
        },
        {
          type: 'PositionClosed',
          timestamp: 2000,
          close_price: '110.00000000',
          position_state: {
            quantity: '1.00000000',
            average_cost: '100.00000000',
            total_invested: '100.00000000',
            leverage_level: '1.00000000',
            status: 'CLOSED',
            last_update_timestamp: 2000,
          },
        },
      ];

      const summary = await aggregator.aggregateEvents(events);

      expect(summary.total_pnl).toBe('10.00000000');
      expect(summary.total_fees).toBe('0.00000000');
    });

    it('should compute ROI as zero when investment is zero (edge case)', async () => {
      // This shouldn't happen in practice due to entry_fee, but test defensive coding
      const events: TradeEvent[] = [
        {
          type: 'PositionOpened',
          timestamp: 1000,
          position_id: 'pos-1',
          entry_price: '0.00000000',
          initial_quantity: '0.00000000',
          entry_fee: '0.00000000',
          position_state: {
            quantity: '0.00000000',
            average_cost: '0.00000000',
            total_invested: '0.00000000',
            leverage_level: '1.00000000',
            status: 'OPEN',
            last_update_timestamp: 1000,
          },
        },
        {
          type: 'PositionClosed',
          timestamp: 2000,
          close_price: '100.00000000',
          position_state: {
            quantity: '0.00000000',
            average_cost: '0.00000000',
            total_invested: '0.00000000',
            leverage_level: '1.00000000',
            status: 'CLOSED',
            last_update_timestamp: 2000,
          },
        },
      ];

      const summary = await aggregator.aggregateEvents(events);
      expect(summary.roi_percent).toBe('0.00');
    });
  });
});
