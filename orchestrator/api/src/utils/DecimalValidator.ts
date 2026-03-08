/**
 * DecimalValidator - Fixed-point decimal validation using decimal.js
 * 
 * CRITICAL: This validator rejects IEEE 754 floats and only accepts
 * stringified decimals with max 8 decimal places. This prevents precision loss.
 */

import Decimal from 'decimal.js';

/**
 * Validates and returns a decimal value as a string
 * 
 * @param value - The value to validate (must be a string, not a number)
 * @returns Validated decimal string
 * @throws Error if value is not a valid decimal format
 * 
 * @example
 * validateDecimal('100.50')        // ✅ "100.50"
 * validateDecimal('0.00000001')    // ✅ "0.00000001"
 * validateDecimal(100.5)           // ❌ throws "must be a string"
 * validateDecimal('100.500000001') // ❌ throws "max 8 decimal places"
 */
export function validateDecimal(value: any): string {
  // Reject non-string types
  if (typeof value !== 'string') {
    throw new Error(`Decimal value must be a string, got ${typeof value}`);
  }

  // Reject empty string
  if (value === '') {
    throw new Error('Decimal value cannot be empty string');
  }

  // Validate format: allow optional minus sign, then digits with optional decimal part
  const decimalRegex = /^-?(0|[1-9]\d*)(\.\d+)?$/;
  if (!decimalRegex.test(value)) {
    throw new Error(`invalid decimal format: "${value}". Expected format: "123.45"`);
  }

  // Parse using decimal.js for arbitrary precision
  let decimal: Decimal;
  try {
    decimal = new Decimal(value);
  } catch (error) {
    throw new Error(`invalid decimal format: "${value}". ${String(error)}`);
  }

  // Check if value is negative
  if (decimal.isNegative()) {
    throw new Error(`must be >= 0, got ${value}`);
  }

  // Check decimal places (max 8)
  const places = value.includes('.') ? value.split('.')[1].length : 0;
  if (places > 8) {
    throw new Error(`max 8 decimal places, got ${places} in "${value}"`);
  }

  // Check if value is reasonable (not too large)
  // Max supported: 999999.99999999 (6 digits before decimal + 8 after)
  if (decimal.greaterThan(new Decimal('999999.99999999'))) {
    throw new Error(`out of bounds: max 999999.99999999, got ${value}`);
  }

  return value;
}

/**
 * Validates and returns an array of decimal values as strings
 * 
 * @param values - Array of decimal values to validate
 * @returns Validated array of decimal strings
 * @throws Error if array is empty, not an array, or contains invalid decimals
 * 
 * @example
 * validateDecimalArray(['100.50', '10.25'])  // ✅ ['100.50', '10.25']
 * validateDecimalArray([])                   // ❌ throws "array must not be empty"
 * validateDecimalArray('not-array')          // ❌ throws "must be an array"
 */
export function validateDecimalArray(values: any): string[] {
  // Check if it's an array
  if (!Array.isArray(values)) {
    throw new Error(`Expected array, got ${typeof values}`);
  }

  // Check if array is empty
  if (values.length === 0) {
    throw new Error('Decimal array must not be empty');
  }

  // Validate each element
  const validated: string[] = [];
  for (let i = 0; i < values.length; i++) {
    try {
      validated.push(validateDecimal(values[i]));
    } catch (error) {
      throw new Error(`Invalid decimal at index ${i}: ${String(error)}`);
    }
  }

  return validated;
}
