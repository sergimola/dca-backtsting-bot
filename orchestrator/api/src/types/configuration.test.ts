import { validateBacktestRequest, ValidationError } from './configuration';

describe('BacktestRequest Validation', () => {
  const validRequest = {
    entry_price: '100.50',
    amounts: ['10.25', '10.25', '10.25'],
    sequences: [0, 1, 2],
    leverage: '2.00',
    margin_ratio: '0.50',
    market_data_csv_path: '/data/BTCUSDT_1m.csv',
  };

  describe('✅ Valid configurations', () => {
    it('should accept valid backtest request', () => {
      const result = validateBacktestRequest(validRequest);
      expect(result).toEqual(validRequest);
    });

    it('should accept request without optional idempotency_key', () => {
      const result = validateBacktestRequest(validRequest);
      expect(result.idempotency_key).toBeUndefined();
    });

    it('should accept request with valid idempotency_key', () => {
      const req = {
        ...validRequest,
        idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
      };
      const result = validateBacktestRequest(req);
      expect(result.idempotency_key).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should accept minimal leverage (just above 1.0)', () => {
      const result = validateBacktestRequest({
        ...validRequest,
        leverage: '1.01',
      });
      expect(result.leverage).toBe('1.01');
    });

    it('should accept minimum margin_ratio', () => {
      const result = validateBacktestRequest({
        ...validRequest,
        margin_ratio: '0.00',
      });
      expect(result.margin_ratio).toBe('0.00');
    });

    it('should accept maximum margin_ratio close to 1', () => {
      const result = validateBacktestRequest({
        ...validRequest,
        margin_ratio: '0.99999999',
      });
      expect(result.margin_ratio).toBe('0.99999999');
    });

    it('should accept single amount', () => {
      const result = validateBacktestRequest({
        ...validRequest,
        amounts: ['100.00'],
        sequences: [0],
      });
      expect(result.amounts).toEqual(['100.00']);
    });

    it('should accept many amounts', () => {
      const amounts = Array(20).fill('10.00');
      const sequences = Array(20).fill(0).map((_, i) => i);
      const result = validateBacktestRequest({
        ...validRequest,
        amounts,
        sequences,
      });
      expect(result.amounts.length).toBe(20);
    });
  });

  describe('❌ Missing required fields', () => {
    it('should reject missing entry_price', () => {
      const req = { ...validRequest };
      delete (req as any).entry_price;
      expect(() => validateBacktestRequest(req)).toThrow(ValidationError);
    });

    it('should reject missing amounts', () => {
      const req = { ...validRequest };
      delete (req as any).amounts;
      expect(() => validateBacktestRequest(req)).toThrow(ValidationError);
    });

    it('should reject missing sequences', () => {
      const req = { ...validRequest };
      delete (req as any).sequences;
      expect(() => validateBacktestRequest(req)).toThrow(ValidationError);
    });

    it('should reject missing leverage', () => {
      const req = { ...validRequest };
      delete (req as any).leverage;
      expect(() => validateBacktestRequest(req)).toThrow(ValidationError);
    });

    it('should reject missing margin_ratio', () => {
      const req = { ...validRequest };
      delete (req as any).margin_ratio;
      expect(() => validateBacktestRequest(req)).toThrow(ValidationError);
    });

    it('should reject missing market_data_csv_path', () => {
      const req = { ...validRequest };
      delete (req as any).market_data_csv_path;
      expect(() => validateBacktestRequest(req)).toThrow(ValidationError);
    });
  });

  describe('❌ Type mismatches', () => {
    it('should reject entry_price as number instead of string', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          entry_price: 100.5 as any,
        })
      ).toThrow(ValidationError);
    });

    it('should reject amounts as object', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          amounts: { 0: '10.25' } as any,
        })
      ).toThrow(ValidationError);
    });

    it('should reject sequences as string', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          sequences: 'not-array' as any,
        })
      ).toThrow(ValidationError);
    });

    it('should reject leverage as object', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          leverage: { value: 2.0 } as any,
        })
      ).toThrow(ValidationError);
    });

    it('should reject margin_ratio as number', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          margin_ratio: 0.5 as any,
        })
      ).toThrow(ValidationError);
    });

    it('should reject market_data_csv_path as number', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          market_data_csv_path: 123 as any,
        })
      ).toThrow(ValidationError);
    });
  });

  describe('❌ Out-of-bounds values', () => {
    it('should reject sequences length != amounts length', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          amounts: ['10', '20'],
          sequences: [0, 1, 2],
        })
      ).toThrow(ValidationError);
    });

    it('should reject negative sequence index', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          sequences: [-1, 0, 1],
        })
      ).toThrow(ValidationError);
    });

    it('should reject sequence index >= 100', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          sequences: [0, 100],
          amounts: ['10', '20'],
        })
      ).toThrow(ValidationError);
    });

    it('should reject margin_ratio < 0', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          margin_ratio: '-0.1',
        })
      ).toThrow(ValidationError);
    });

    it('should reject margin_ratio >= 1', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          margin_ratio: '1.00',
        })
      ).toThrow(ValidationError);
    });

    it('should reject leverage <= 1.0', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          leverage: '1.00',
        })
      ).toThrow(ValidationError);
    });

    it('should reject entry_price with 0 value', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          entry_price: '0',
        })
      ).toThrow(ValidationError);
    });

    it('should reject negative entry_price', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          entry_price: '-100.50',
        })
      ).toThrow(ValidationError);
    });

    it('should reject amount with 0 value', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          amounts: ['0.00', '10.25', '10.25'],
        })
      ).toThrow(ValidationError);
    });

    it('should reject negative amount', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          amounts: ['-10.25', '10.25', '10.25'],
        })
      ).toThrow(ValidationError);
    });
  });

  describe('❌ Invalid decimal precision in fields', () => {
    it('should reject entry_price with float', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          entry_price: 100.5 as any,
        })
      ).toThrow(ValidationError);
    });

    it('should reject amount as float in array', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          amounts: ['10.25', 20.5 as any, '10.25'],
        })
      ).toThrow(ValidationError);
    });

    it('should reject leverage with float input', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          leverage: 2.0 as any,
        })
      ).toThrow(ValidationError);
    });

    it('should reject entry_price with >8 decimal places', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          entry_price: '100.500000001',
        })
      ).toThrow(ValidationError);
    });

    it('should reject amount with >8 decimal places', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          amounts: ['10.250000001', '10.25', '10.25'],
        })
      ).toThrow(ValidationError);
    });
  });

  describe('❌ Invalid idempotency_key format', () => {
    it('should reject invalid UUID format', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          idempotency_key: 'not-a-uuid',
        })
      ).toThrow(ValidationError);
    });

    it('should reject UUID with wrong case', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          idempotency_key: '550E8400-E29B-41D4-A716-446655440000',
        })
      ).toThrow(ValidationError);
    });

    it('should reject empty idempotency_key', () => {
      expect(() =>
        validateBacktestRequest({
          ...validRequest,
          idempotency_key: '',
        })
      ).toThrow(ValidationError);
    });
  });
});
