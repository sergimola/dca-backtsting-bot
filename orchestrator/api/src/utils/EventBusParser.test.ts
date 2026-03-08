/**
 * EventBusParser Tests
 *
 * Tests parsing and validation of ndjson Event Bus output from Core Engine.
 * Covers all event types, nested structures, and precision guarantees.
 */

import { parseEventLine, parseNdjsonOutput } from './EventBusParser';

import { ParseError } from '../types/errors';

describe('EventBusParser', () => {
  describe('✅ Valid event parsing', () => {
    it('should parse PositionOpenedEvent with all required fields', () => {
      const line = JSON.stringify({
        type: 'PositionOpened',
        timestamp: 1000,
        position_id: '550e8400-e29b-41d4-a716-446655440001',
        entry_price: '100.50000000',
        initial_quantity: '10.25000000',
        entry_fee: '1.00000000',
        position_state: {
          quantity: '10.25000000',
          average_cost: '100.50000000',
          total_invested: '1031.62500000',
          leverage_level: '2.00000000',
          status: 'OPEN',
          last_update_timestamp: 1000,
        },
      });

      const event = parseEventLine(line, 1);

      expect(event.type).toBe('PositionOpened');
      expect(event.timestamp).toBe(1000);
      if (event.type === 'PositionOpened') {
        expect(event.entry_price).toBe('100.50000000');
        expect(event.position_state.status).toBe('OPEN');
      }
    });

    it('should parse OrderFilledEvent with safety_order_index', () => {
      const line = JSON.stringify({
        type: 'OrderFilled',
        timestamp: 1100,
        order_id: '550e8400-e29b-41d4-a716-446655440002',
        price: '95.00000000',
        quantity: '10.25000000',
        fee: '0.10000000',
        safety_order_index: 0,
        position_state: {
          quantity: '20.50000000',
          average_cost: '97.75000000',
          total_invested: '2042.50000000',
          leverage_level: '2.00000000',
          status: 'OPEN',
          last_update_timestamp: 1100,
        },
      });

      const event = parseEventLine(line, 1);

      expect(event.type).toBe('OrderFilled');
      if (event.type === 'OrderFilled') {
        expect(event.safety_order_index).toBe(0);
        expect(typeof event.safety_order_index).toBe('number');
      }
    });

    it('should parse PositionClosedEvent', () => {
      const line = JSON.stringify({
        type: 'PositionClosed',
        timestamp: 2000,
        close_price: '102.00000000',
        position_state: {
          quantity: '41.00000000',
          average_cost: '92.80487805',
          total_invested: '3773.80000000',
          leverage_level: '2.00000000',
          status: 'CLOSED',
          last_update_timestamp: 2000,
        },
      });

      const event = parseEventLine(line, 1);

      expect(event.type).toBe('PositionClosed');
      if (event.type === 'PositionClosed') {
        expect(event.position_state.status).toBe('CLOSED');
      }
    });

    it('should parse GapDownEvent with filled_orders array', () => {
      const line = JSON.stringify({
        type: 'GapDownEvent',
        timestamp: 1300,
        gap_from_price: '90.00000000',
        gap_to_price: '85.00000000',
        filled_orders: [
          {
            price: '85.00000000',
            quantity: '10.25000000',
            safety_order_index: 2,
          },
          {
            price: '85.00000000',
            quantity: '5.00000000',
            safety_order_index: 3,
          },
        ],
        position_state: {
          quantity: '41.00000000',
          average_cost: '92.80487805',
          total_invested: '3773.80000000',
          leverage_level: '2.00000000',
          status: 'OPEN',
          last_update_timestamp: 1300,
        },
      });

      const event = parseEventLine(line, 1);

      expect(event.type).toBe('GapDownEvent');
      if (event.type === 'GapDownEvent') {
        expect(event.filled_orders.length).toBe(2);
        expect(event.filled_orders[0].safety_order_index).toBe(2);
        expect(event.filled_orders[1].safety_order_index).toBe(3);
      }
    });

    it('should parse LiquidationEvent', () => {
      const line = JSON.stringify({
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
      });

      const event = parseEventLine(line, 1);

      expect(event.type).toBe('LiquidationEvent');
      if (event.type === 'LiquidationEvent') {
        expect(event.position_state.status).toBe('LIQUIDATED');
      }
    });
  });

  describe('✅ Precision preservation', () => {
    it('should preserve 8 decimal places in prices', () => {
      const line = JSON.stringify({
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
      });

      const event = parseEventLine(line, 1);

      if (event.type === 'PositionOpened') {
        expect(event.entry_price).toBe('100.12345678');
        expect(event.initial_quantity).toBe('10.87654321');
      }
    });

    it('should handle position_state precision correctly', () => {
      const line = JSON.stringify({
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
      });

      const event = parseEventLine(line, 1);

      if (event.type === 'OrderFilled') {
        expect(event.position_state.quantity).toBe('16.43209876');
        expect(event.position_state.average_cost).toBe('99.88888889');
      }
    });
  });

  describe('❌ Malformed JSON handling', () => {
    it('should throw ParseError on invalid JSON', () => {
      const line = '{"incomplete": json';

      expect(() => parseEventLine(line, 1)).toThrow(ParseError);
    });

    it('should throw ParseError if missing type field', () => {
      const line = JSON.stringify({
        timestamp: 1000,
        position_id: 'pos-1',
      });

      expect(() => parseEventLine(line, 5)).toThrow(ParseError);
    });

    it('should throw ParseError if missing timestamp field', () => {
      const line = JSON.stringify({
        type: 'PositionOpened',
        position_id: 'pos-1',
        entry_price: '100.00000000',
      });

      expect(() => parseEventLine(line, 10)).toThrow(ParseError);
    });

    it('should throw ParseError if missing position_state', () => {
      const line = JSON.stringify({
        type: 'PositionOpened',
        timestamp: 1000,
        position_id: 'pos-1',
        entry_price: '100.00000000',
      });

      expect(() => parseEventLine(line, 15)).toThrow(ParseError);
    });

    it('should throw ParseError on unknown event type', () => {
      const line = JSON.stringify({
        type: 'UnknownEventType',
        timestamp: 1000,
        position_state: {
          quantity: '1.00000000',
          average_cost: '100.00000000',
          total_invested: '100.00000000',
          leverage_level: '1.00000000',
          status: 'OPEN',
          last_update_timestamp: 1000,
        },
      });

      expect(() => parseEventLine(line, 20)).toThrow(ParseError);
    });
  });

  describe('❌ Invalid event-specific fields', () => {
    it('should throw ParseError on OrderFilled missing safety_order_index', () => {
      const line = JSON.stringify({
        type: 'OrderFilled',
        timestamp: 1100,
        order_id: 'ord-1',
        price: '95.00000000',
        quantity: '10.00000000',
        fee: '0.10000000',
        // Missing safety_order_index
        position_state: {
          quantity: '20.00000000',
          average_cost: '97.50000000',
          total_invested: '2042.50000000',
          leverage_level: '2.00000000',
          status: 'OPEN',
          last_update_timestamp: 1100,
        },
      });

      expect(() => parseEventLine(line, 1)).toThrow(ParseError);
    });

    it('should throw ParseError on GapDownEvent with invalid filled_orders', () => {
      const line = JSON.stringify({
        type: 'GapDownEvent',
        timestamp: 1300,
        gap_from_price: '90.00000000',
        gap_to_price: '85.00000000',
        filled_orders: 'not_an_array', // Invalid
        position_state: {
          quantity: '41.00000000',
          average_cost: '92.80487805',
          total_invested: '3773.80000000',
          leverage_level: '2.00000000',
          status: 'OPEN',
          last_update_timestamp: 1300,
        },
      });

      expect(() => parseEventLine(line, 1)).toThrow(ParseError);
    });

    it('should throw ParseError on GapDownEvent with missing fill field', () => {
      const line = JSON.stringify({
        type: 'GapDownEvent',
        timestamp: 1300,
        gap_from_price: '90.00000000',
        gap_to_price: '85.00000000',
        filled_orders: [
          {
            price: '85.00000000',
            quantity: '10.25000000',
            // Missing safety_order_index
          },
        ],
        position_state: {
          quantity: '41.00000000',
          average_cost: '92.80487805',
          total_invested: '3773.80000000',
          leverage_level: '2.00000000',
          status: 'OPEN',
          last_update_timestamp: 1300,
        },
      });

      expect(() => parseEventLine(line, 1)).toThrow(ParseError);
    });
  });

  describe('✅ Batch parsing (ndjson)', () => {
    it('should parse complete multi-event sequence', () => {
      const ndjson = [
        {
          type: 'PositionOpened',
          timestamp: 1000,
          position_id: 'pos-1',
          entry_price: '100.50000000',
          initial_quantity: '10.25000000',
          entry_fee: '1.00000000',
          position_state: {
            quantity: '10.25000000',
            average_cost: '100.50000000',
            total_invested: '1031.62500000',
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
          quantity: '10.25000000',
          fee: '0.10000000',
          safety_order_index: 0,
          position_state: {
            quantity: '20.50000000',
            average_cost: '97.75000000',
            total_invested: '2042.50000000',
            leverage_level: '2.00000000',
            status: 'OPEN',
            last_update_timestamp: 1100,
          },
        },
        {
          type: 'PositionClosed',
          timestamp: 2000,
          close_price: '102.00000000',
          position_state: {
            quantity: '20.50000000',
            average_cost: '97.75000000',
            total_invested: '2042.50000000',
            leverage_level: '2.00000000',
            status: 'CLOSED',
            last_update_timestamp: 2000,
          },
        },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n');

      const events = parseNdjsonOutput(ndjson);

      expect(events.length).toBe(3);
      expect(events[0].type).toBe('PositionOpened');
      expect(events[1].type).toBe('OrderFilled');
      expect(events[2].type).toBe('PositionClosed');
    });

    it('should skip empty lines in ndjson', () => {
      const ndjson =
        JSON.stringify({
          type: 'PositionOpened',
          timestamp: 1000,
          position_id: 'pos-1',
          entry_price: '100.50000000',
          initial_quantity: '10.25000000',
          entry_fee: '1.00000000',
          position_state: {
            quantity: '10.25000000',
            average_cost: '100.50000000',
            total_invested: '1031.62500000',
            leverage_level: '2.00000000',
            status: 'OPEN',
            last_update_timestamp: 1000,
          },
        }) +
        '\n\n' +
        JSON.stringify({
          type: 'PositionClosed',
          timestamp: 2000,
          close_price: '102.00000000',
          position_state: {
            quantity: '10.25000000',
            average_cost: '100.50000000',
            total_invested: '1031.62500000',
            leverage_level: '2.00000000',
            status: 'CLOSED',
            last_update_timestamp: 2000,
          },
        });

      const events = parseNdjsonOutput(ndjson);

      expect(events.length).toBe(2);
    });

    it('should throw error if no valid events found', () => {
      const ndjson = '\n\n'; // Only empty lines

      expect(() => parseNdjsonOutput(ndjson)).toThrow('No valid events found');
    });
  });

  describe('✅ Position state validation', () => {
    it('should validate all required position_state fields', () => {
      const line = JSON.stringify({
        type: 'PositionOpened',
        timestamp: 1000,
        position_id: 'pos-1',
        entry_price: '100.00000000',
        initial_quantity: '10.00000000',
        entry_fee: '1.00000000',
        position_state: {
          quantity: '10.00000000',
          average_cost: '100.00000000',
          total_invested: '101.00000000',
          leverage_level: '1.00000000',
          status: 'OPEN',
          last_update_timestamp: 1000,
        },
      });

      const event = parseEventLine(line, 1);
      expect(event.position_state.status).toBe('OPEN');
    });

    it('should reject invalid position_state status', () => {
      const line = JSON.stringify({
        type: 'PositionOpened',
        timestamp: 1000,
        position_id: 'pos-1',
        entry_price: '100.00000000',
        initial_quantity: '10.00000000',
        entry_fee: '1.00000000',
        position_state: {
          quantity: '10.00000000',
          average_cost: '100.00000000',
          total_invested: '101.00000000',
          leverage_level: '1.00000000',
          status: 'INVALID_STATUS',
          last_update_timestamp: 1000,
        },
      });

      expect(() => parseEventLine(line, 1)).toThrow(ParseError);
    });
  });

  describe('✅ Line number tracking', () => {
    it('should include line number in ParseError', () => {
      const line = '{"incomplete": json';

      try {
        parseEventLine(line, 42);
        fail('Should have thrown');
      } catch (error) {
        if (error instanceof ParseError) {
          expect(error.lineNumber).toBe(42);
        }
      }
    });
  });
});
