/**
 * Configuration Types & Validation
 * 
 * BacktestRequest is the user-submitted configuration for a single backtest execution.
 * Must validate decimal precision, bounds, and consistency before subprocess execution.
 */

import { validateDecimal, validateDecimalArray } from '../utils/DecimalValidator.js';

/**
 * BacktestRequest - User-submitted configuration for a single backtest
 * 
 * All monetary values MUST be stringified decimals (not floats) to preserve precision.
 */
export interface BacktestRequest {
  /** Entry price (decimal string, > 0, max 8 places) */
  entry_price: string;

  /** DCA amounts per sequence (decimal array, all > 0, max 8 places each) */
  amounts: string[];

  /** Safety order indices (0-99) corresponding to each amount */
  sequences: number[];

  /** Leverage multiplier (decimal string, >= 1.0 where 1.0 = spot, > 1.0 = margin) */
  leverage: string;

  /** Margin ratio (decimal string, 0 <= mmr < 1) */
  margin_ratio: string;

  /** Path to market data CSV file on Core Engine host */
  market_data_csv_path: string;

  /** Optional idempotency key (UUID RFC 4122) for duplicate suppression */
  idempotency_key?: string;
}

/**
 * ValidationError - Thrown when BacktestRequest validation fails
 */
export class ValidationError extends Error {
  constructor(
    public field: string,
    public constraint: string,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates BacktestRequest against requirements
 * 
 * Constraints:
 * - All monetary values must be decimals (not floats): "100.50" ✅, 100.5 ❌
 * - entry_price > 0, max 8 decimal places
 * - amounts all > 0, max 8 decimal places each
 * - leverage >= 1.0 (1.0 = spot trading, > 1.0 = margin trading)
 * - margin_ratio in [0, 1)
 * - sequences.length === amounts.length
 * - Each sequence in [0, 100)
 * 
 * @param request - Object to validate as BacktestRequest
 * @returns Validated BacktestRequest object
 * @throws ValidationError if constraints violated
 * 
 * @example
 * const valid = {
 *   entry_price: '100.50',
 *   amounts: ['10.25', '10.25'],
 *   sequences: [0, 1],
 *   leverage: '2.00',
 *   margin_ratio: '0.50',
 *   market_data_csv_path: '/data/BTCUSDT.csv'
 * };
 * validateBacktestRequest(valid); // ✅ returns the object
 * 
 * validateBacktestRequest({ ...valid, entry_price: 100.5 });
 * // ❌ throws ValidationError("entry_price", "type_error", "...")
 */
export function validateBacktestRequest(request: any): BacktestRequest {
  // Validate entry_price
  if (request.entry_price === undefined) {
    throw new ValidationError(
      'entry_price',
      'required_field',
      'Missing required field: entry_price'
    );
  }
  if (typeof request.entry_price !== 'string') {
    throw new ValidationError(
      'entry_price',
      'type_error',
      `entry_price must be a string decimal (e.g., "100.50"), got ${typeof request.entry_price}`
    );
  }
  let validatedEntry: string;
  try {
    validatedEntry = validateDecimal(request.entry_price);
  } catch (error) {
    throw new ValidationError(
      'entry_price',
      'decimal_error',
      `Invalid entry_price: ${String(error)}`
    );
  }

  // Validate entry_price > 0
  if (parseFloat(validatedEntry) <= 0) {
    throw new ValidationError(
      'entry_price',
      'out_of_bounds',
      `entry_price must be > 0, got ${validatedEntry}`
    );
  }

  // Validate amounts
  if (request.amounts === undefined) {
    throw new ValidationError(
      'amounts',
      'required_field',
      'Missing required field: amounts'
    );
  }
  if (!Array.isArray(request.amounts)) {
    throw new ValidationError(
      'amounts',
      'type_error',
      `amounts must be an array of decimal strings, got ${typeof request.amounts}`
    );
  }
  let validatedAmounts: string[];
  try {
    validatedAmounts = validateDecimalArray(request.amounts);
  } catch (error) {
    throw new ValidationError(
      'amounts',
      'decimal_error',
      `Invalid amounts: ${String(error)}`
    );
  }

  // Validate all amounts > 0
  for (let i = 0; i < validatedAmounts.length; i++) {
    if (parseFloat(validatedAmounts[i]) <= 0) {
      throw new ValidationError(
        'amounts',
        'out_of_bounds',
        `amounts[${i}] must be > 0, got ${validatedAmounts[i]}`
      );
    }
  }

  // Validate sequences
  if (request.sequences === undefined) {
    throw new ValidationError(
      'sequences',
      'required_field',
      'Missing required field: sequences'
    );
  }
  if (!Array.isArray(request.sequences)) {
    throw new ValidationError(
      'sequences',
      'type_error',
      `sequences must be an array of integers, got ${typeof request.sequences}`
    );
  }

  // Validate sequences length matches amounts length
  if (request.sequences.length !== validatedAmounts.length) {
    throw new ValidationError(
      'sequences',
      'length_mismatch',
      `sequences length (${request.sequences.length}) must match amounts length (${validatedAmounts.length})`
    );
  }

  // Validate each sequence value
  for (let i = 0; i < request.sequences.length; i++) {
    const seq = request.sequences[i];
    if (typeof seq !== 'number' || !Number.isInteger(seq)) {
      throw new ValidationError(
        'sequences',
        'type_error',
        `sequences[${i}] must be an integer, got ${typeof seq}`
      );
    }
    if (seq < 0 || seq >= 100) {
      throw new ValidationError(
        'sequences',
        'out_of_bounds',
        `sequences[${i}] must be in range [0, 100), got ${seq}`
      );
    }
  }

  // Validate leverage
  if (request.leverage === undefined) {
    throw new ValidationError(
      'leverage',
      'required_field',
      'Missing required field: leverage'
    );
  }
  if (typeof request.leverage !== 'string') {
    throw new ValidationError(
      'leverage',
      'type_error',
      `leverage must be a string decimal (e.g., "2.00"), got ${typeof request.leverage}`
    );
  }
  let validatedLeverage: string;
  try {
    validatedLeverage = validateDecimal(request.leverage);
  } catch (error) {
    throw new ValidationError(
      'leverage',
      'decimal_error',
      `Invalid leverage: ${String(error)}`
    );
  }

  // Validate leverage >= 1.0
  if (parseFloat(validatedLeverage) < 1.0) {
    throw new ValidationError(
      'leverage',
      'out_of_bounds',
      `leverage must be >= 1.0, got ${validatedLeverage}`
    );
  }

  // Validate margin_ratio
  if (request.margin_ratio === undefined) {
    throw new ValidationError(
      'margin_ratio',
      'required_field',
      'Missing required field: margin_ratio'
    );
  }
  if (typeof request.margin_ratio !== 'string') {
    throw new ValidationError(
      'margin_ratio',
      'type_error',
      `margin_ratio must be a string decimal (e.g., "0.50"), got ${typeof request.margin_ratio}`
    );
  }
  let validatedMarginRatio: string;
  try {
    validatedMarginRatio = validateDecimal(request.margin_ratio);
  } catch (error) {
    throw new ValidationError(
      'margin_ratio',
      'decimal_error',
      `Invalid margin_ratio: ${String(error)}`
    );
  }

  // Validate margin_ratio in range [0, 1)
  const marginRatioNum = parseFloat(validatedMarginRatio);
  if (marginRatioNum < 0 || marginRatioNum >= 1) {
    throw new ValidationError(
      'margin_ratio',
      'out_of_bounds',
      `margin_ratio must be in range [0, 1), got ${validatedMarginRatio}`
    );
  }

  // Validate market_data_csv_path
  if (request.market_data_csv_path === undefined) {
    throw new ValidationError(
      'market_data_csv_path',
      'required_field',
      'Missing required field: market_data_csv_path'
    );
  }
  if (typeof request.market_data_csv_path !== 'string') {
    throw new ValidationError(
      'market_data_csv_path',
      'type_error',
      `market_data_csv_path must be a string, got ${typeof request.market_data_csv_path}`
    );
  }
  if (request.market_data_csv_path === '') {
    throw new ValidationError(
      'market_data_csv_path',
      'empty_value',
      'market_data_csv_path cannot be empty'
    );
  }

  // Validate optional idempotency_key
  let validatedIdempotencyKey: string | undefined;
  if (request.idempotency_key !== undefined) {
    if (typeof request.idempotency_key !== 'string') {
      throw new ValidationError(
        'idempotency_key',
        'type_error',
        `idempotency_key must be a string UUID, got ${typeof request.idempotency_key}`
      );
    }

    // Validate UUID format RFC 4122 (8-4-4-4-12 hex pattern, lowercase)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (!uuidRegex.test(request.idempotency_key)) {
      throw new ValidationError(
        'idempotency_key',
        'invalid_format',
        `idempotency_key must be a valid UUID v4 (e.g., 550e8400-e29b-41d4-a716-446655440000), got "${request.idempotency_key}"`
      );
    }
    validatedIdempotencyKey = request.idempotency_key;
  }

  // Return validated request
  return {
    entry_price: validatedEntry,
    amounts: validatedAmounts,
    sequences: request.sequences, // Already validated as integers
    leverage: validatedLeverage,
    margin_ratio: validatedMarginRatio,
    market_data_csv_path: request.market_data_csv_path,
    idempotency_key: validatedIdempotencyKey,
  };
}
