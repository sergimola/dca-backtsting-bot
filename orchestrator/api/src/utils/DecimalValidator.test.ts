import { validateDecimal, validateDecimalArray } from './DecimalValidator';

describe('DecimalValidator', () => {
  describe('validateDecimal', () => {
    describe('✅ Valid decimal strings', () => {
      it('should accept valid 2-place decimal', () => {
        const result = validateDecimal('100.50');
        expect(result).toBe('100.50');
      });

      it('should accept valid 8-place decimal', () => {
        const result = validateDecimal('100.50000000');
        expect(result).toBe('100.50000000');
      });

      it('should accept zero', () => {
        const result = validateDecimal('0');
        expect(result).toBe('0');
      });

      it('should accept zero with places', () => {
        const result = validateDecimal('0.00000000');
        expect(result).toBe('0.00000000');
      });

      it('should accept smallest valid increment', () => {
        const result = validateDecimal('0.00000001');
        expect(result).toBe('0.00000001');
      });

      it('should accept large numbers', () => {
        const result = validateDecimal('999999.99999999');
        expect(result).toBe('999999.99999999');
      });

      it('should accept single digit', () => {
        const result = validateDecimal('5');
        expect(result).toBe('5');
      });

      it('should accept string with leading zeros in decimal part', () => {
        const result = validateDecimal('1.00100000');
        expect(result).toBe('1.00100000');
      });
    });

    describe('❌ Reject floats (IEEE 754)', () => {
      it('should reject JavaScript float type', () => {
        expect(() => validateDecimal(100.5)).toThrow('must be a string');
      });

      it('should reject number type zero', () => {
        expect(() => validateDecimal(0)).toThrow('must be a string');
      });

      it('should reject infinity', () => {
        expect(() => validateDecimal(Infinity)).toThrow('must be a string');
      });

      it('should reject NaN', () => {
        expect(() => validateDecimal(NaN)).toThrow('must be a string');
      });
    });

    describe('❌ Reject out-of-bounds values', () => {
      it('should reject negative price', () => {
        expect(() => validateDecimal('-100.00')).toThrow('must be >= 0');
      });

      it('should reject value with >8 decimal places', () => {
        expect(() => validateDecimal('100.500000001')).toThrow('max 8 decimal places');
      });

      it('should reject extremely large number', () => {
        expect(() => validateDecimal('999999999999999.99999999')).toThrow('out of bounds');
      });
    });

    describe('❌ Reject invalid format', () => {
      it('should reject empty string', () => {
        expect(() => validateDecimal('')).toThrow();
      });

      it('should reject non-numeric string', () => {
        expect(() => validateDecimal('abc')).toThrow('invalid decimal format');
      });

      it('should reject string with spaces', () => {
        expect(() => validateDecimal('100 50')).toThrow('invalid decimal format');
      });

      it('should reject multiple decimal points', () => {
        expect(() => validateDecimal('100.50.25')).toThrow('invalid decimal format');
      });

      it('should reject string with currency symbol', () => {
        expect(() => validateDecimal('$100.50')).toThrow('invalid decimal format');
      });

      it('should reject scientific notation', () => {
        expect(() => validateDecimal('1e2')).toThrow('invalid decimal format');
      });

      it('should reject null', () => {
        expect(() => validateDecimal(null as any)).toThrow();
      });

      it('should reject undefined', () => {
        expect(() => validateDecimal(undefined as any)).toThrow();
      });

      it('should reject object', () => {
        expect(() => validateDecimal({} as any)).toThrow();
      });

      it('should reject array', () => {
        expect(() => validateDecimal([] as any)).toThrow();
      });
    });
  });

  describe('validateDecimalArray', () => {
    it('should validate array of valid decimals', () => {
      const result = validateDecimalArray(['100.50', '10.25', '5.00']);
      expect(result).toEqual(['100.50', '10.25', '5.00']);
    });

    it('should reject array with one invalid element', () => {
      expect(() => validateDecimalArray(['100.50', 100.5, '5.00'])).toThrow();
    });

    it('should reject empty array', () => {
      expect(() => validateDecimalArray([])).toThrow('array must not be empty');
    });

    it('should reject non-array input', () => {
      expect(() => validateDecimalArray('not-an-array' as any)).toThrow();
    });

    it('should reject null', () => {
      expect(() => validateDecimalArray(null as any)).toThrow();
    });

    it('should validate mixed valid decimals with different lengths', () => {
      const result = validateDecimalArray(['0.00000001', '999999.99999999', '100']);
      expect(result).toEqual(['0.00000001', '999999.99999999', '100']);
    });
  });
});
