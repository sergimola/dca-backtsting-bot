/**
 * PrecisionFormatter - Strict decimal formatting for all output values
 *
 * Ensures all monetary values, amounts, and percentages are formatted
 * with exactly the required decimal places using Decimal.js for precision.
 */

import Decimal from 'decimal.js';

/**
 * Formats a price value to 8 decimal places
 *
 * @param value - Decimal price value
 * @returns String with exactly 8 decimal places (e.g., "100.50000000")
 *
 * @example
 * formatPrice(new Decimal('100.5')) // "100.50000000"
 * formatPrice(new Decimal('100.123456789')) // "100.12345679" (rounded)
 */
export function formatPrice(value: Decimal | string | number): string {
  if (typeof value !== 'object' || !(value instanceof Decimal)) {
    value = new Decimal(value);
  }
  return (value as Decimal).toFixed(8);
}

/**
 * Formats an amount (quantity) to 8 decimal places
 *
 * @param value - Decimal amount value
 * @returns String with exactly 8 decimal places (e.g., "10.25000000")
 *
 * @example
 * formatAmount(new Decimal('10.25')) // "10.25000000"
 * formatAmount(new Decimal('10.123456789')) // "10.12345679" (rounded)
 */
export function formatAmount(value: Decimal | string | number): string {
  if (typeof value !== 'object' || !(value instanceof Decimal)) {
    value = new Decimal(value);
  }
  return (value as Decimal).toFixed(8);
}

/**
 * Formats a percentage to 2 decimal places
 *
 * @param value - Decimal percentage value (e.g., 5.50 for 5.50%)
 * @returns String with exactly 2 decimal places (e.g., "5.50")
 *
 * @example
 * formatPercentage(new Decimal('5.50')) // "5.50"
 * formatPercentage(new Decimal('5.123456')) // "5.12" (rounded)
 * formatPercentage(new Decimal('-2.999')) // "-3.00" (rounded)
 */
export function formatPercentage(value: Decimal | string | number): string {
  if (typeof value !== 'object' || !(value instanceof Decimal)) {
    value = new Decimal(value);
  }
  return (value as Decimal).toFixed(2);
}

/**
 * Formats a timestamp to ISO 8601 format with milliseconds and Z suffix
 *
 * @param ms - Milliseconds since Unix epoch
 * @returns ISO 8601 formatted string (e.g., "2026-03-08T12:00:00.000Z")
 *
 * @example
 * formatTimestamp(1741254000000) // "2026-03-08T12:00:00.000Z"
 * formatTimestamp(Date.now()) // Current timestamp in ISO format
 */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Formats a fee value to 8 decimal places (same as prices/amounts)
 *
 * @param value - Decimal fee value
 * @returns String with exactly 8 decimal places
 *
 * @example
 * formatFee(new Decimal('0.1')) // "0.10000000"
 */
export function formatFee(value: Decimal | string | number): string {
  return formatPrice(value);
}

/**
 * Formats multiple decimal values as formatted object
 * Useful for formatting entire event or summary objects
 *
 * @param obj - Object with Decimal values
 * @param schema - Map of field names to formatter functions
 * @returns New object with all values formatted
 *
 * @example
 * formatObject(
 *   { price: new Decimal('100.5'), roi: new Decimal('5.123'), timestamp: Date.now() },
 *   { price: formatPrice, roi: formatPercentage, timestamp: formatTimestamp }
 * )
 * // Returns: { price: "100.50000000", roi: "5.12", timestamp: "2026-03-08T12:00:00.000Z" }
 */
export function formatObject(
  obj: Record<string, any>,
  schema: Record<string, (v: any) => string>,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, formatter] of Object.entries(schema)) {
    if (key in obj) {
      result[key] = formatter(obj[key]);
    }
  }

  return result;
}
