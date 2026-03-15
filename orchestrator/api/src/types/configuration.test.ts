import { validateBacktestRequest, ValidationError } from './configuration';

describe('BacktestRequest Validation', () => {
  const validRequest = {
    trading_pair: 'BTC/USDT',
    start_date: '2025-01-01T00:00:00Z',
    end_date: '2025-01-31T23:59:59Z',
    price_entry: '50000.00',
    price_scale: '1.05',
    amount_scale: '1.10',
    number_of_orders: 5,
    amount_per_trade: '100.00',
    margin_type: 'cross' as const,
    multiplier: 1,
    take_profit_distance_percent: '2.5',
    account_balance: '5000.00',
    exit_on_last_order: false,
  };

  describe('✅ Valid configurations', () => {
    it('should accept a fully valid request', () => {
      const result = validateBacktestRequest(validRequest);
      expect(result.trading_pair).toBe('BTC/USDT');
      expect(result.price_entry).toBe('50000.00');
    });

    it('should accept "isolated" as margin_type', () => {
      const result = validateBacktestRequest({ ...validRequest, margin_type: 'isolated' });
      expect(result.margin_type).toBe('isolated');
    });

    it('should accept multiplier > 1 (margin trading)', () => {
      const result = validateBacktestRequest({ ...validRequest, multiplier: 5 });
      expect(result.multiplier).toBe(5);
    });

    it('should accept multi-year date range (no same-month restriction)', () => {
      const result = validateBacktestRequest({
        ...validRequest,
        start_date: '2021-01-01T00:00:00Z',
        end_date: '2024-12-31T23:59:59Z',
      });
      expect(result.start_date).toBe('2021-01-01T00:00:00Z');
    });

    it('should accept optional idempotency_key UUID', () => {
      const result = validateBacktestRequest({
        ...validRequest,
        idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.idempotency_key).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should accept request without idempotency_key', () => {
      const result = validateBacktestRequest(validRequest);
      expect(result.idempotency_key).toBeUndefined();
    });
  });

  describe('❌ Missing required fields', () => {
    const requiredFields = [
      'trading_pair', 'start_date', 'end_date', 'price_entry', 'price_scale',
      'amount_scale', 'number_of_orders', 'amount_per_trade', 'margin_type',
      'multiplier', 'take_profit_distance_percent', 'account_balance', 'exit_on_last_order',
    ];

    for (const field of requiredFields) {
      it(`should reject missing ${field}`, () => {
        const req = { ...validRequest };
        delete (req as any)[field];
        expect(() => validateBacktestRequest(req)).toThrow(ValidationError);
      });
    }
  });

  describe('❌ Type mismatches', () => {
    it('should reject price_entry as number (must be decimal string)', () => {
      expect(() => validateBacktestRequest({ ...validRequest, price_entry: 50000 as any }))
        .toThrow(ValidationError);
    });

    it('should reject number_of_orders as string', () => {
      expect(() => validateBacktestRequest({ ...validRequest, number_of_orders: '5' as any }))
        .toThrow(ValidationError);
    });

    it('should reject number_of_orders as float', () => {
      expect(() => validateBacktestRequest({ ...validRequest, number_of_orders: 1.5 as any }))
        .toThrow(ValidationError);
    });

    it('should reject multiplier as float', () => {
      expect(() => validateBacktestRequest({ ...validRequest, multiplier: 1.5 as any }))
        .toThrow(ValidationError);
    });

    it('should reject exit_on_last_order as string', () => {
      expect(() => validateBacktestRequest({ ...validRequest, exit_on_last_order: 'true' as any }))
        .toThrow(ValidationError);
    });

    it('should reject margin_type with invalid value', () => {
      expect(() => validateBacktestRequest({ ...validRequest, margin_type: 'futures' as any }))
        .toThrow(ValidationError);
    });
  });

  describe('❌ Out-of-bounds values', () => {
    it('should reject end_date before start_date', () => {
      expect(() => validateBacktestRequest({
        ...validRequest,
        start_date: '2025-02-01T00:00:00Z',
        end_date: '2025-01-01T00:00:00Z',
      })).toThrow(ValidationError);
    });

    it('should reject price_entry of 0', () => {
      expect(() => validateBacktestRequest({ ...validRequest, price_entry: '0' }))
        .toThrow(ValidationError);
    });

    it('should reject negative price_entry', () => {
      expect(() => validateBacktestRequest({ ...validRequest, price_entry: '-100.00' }))
        .toThrow(ValidationError);
    });

    it('should reject number_of_orders < 1', () => {
      expect(() => validateBacktestRequest({ ...validRequest, number_of_orders: 0 }))
        .toThrow(ValidationError);
    });

    it('should reject multiplier < 1', () => {
      expect(() => validateBacktestRequest({ ...validRequest, multiplier: 0 }))
        .toThrow(ValidationError);
    });

    it('should reject amount_per_trade of 0', () => {
      expect(() => validateBacktestRequest({ ...validRequest, amount_per_trade: '0' }))
        .toThrow(ValidationError);
    });

    it('should reject take_profit_distance_percent of 0', () => {
      expect(() => validateBacktestRequest({ ...validRequest, take_profit_distance_percent: '0' }))
        .toThrow(ValidationError);
    });

    it('should reject account_balance of 0', () => {
      expect(() => validateBacktestRequest({ ...validRequest, account_balance: '0' }))
        .toThrow(ValidationError);
    });
  });

  describe('❌ Invalid date formats', () => {
    it('should reject start_date not in RFC 3339 format', () => {
      expect(() => validateBacktestRequest({ ...validRequest, start_date: '2025-01-01' }))
        .toThrow(ValidationError);
    });

    it('should reject end_date not in RFC 3339 format', () => {
      expect(() => validateBacktestRequest({ ...validRequest, end_date: 'January 31' as any }))
        .toThrow(ValidationError);
    });
  });

  describe('❌ Invalid idempotency_key format', () => {
    it('should reject non-UUID idempotency_key', () => {
      expect(() => validateBacktestRequest({ ...validRequest, idempotency_key: 'not-a-uuid' }))
        .toThrow(ValidationError);
    });

    it('should reject empty idempotency_key', () => {
      expect(() => validateBacktestRequest({ ...validRequest, idempotency_key: '' }))
        .toThrow(ValidationError);
    });
  });
});
