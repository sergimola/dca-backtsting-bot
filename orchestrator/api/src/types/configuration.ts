/**
 * Configuration Types & Validation
 * 
 * ApiBacktestRequest is the user-submitted configuration for a single backtest execution.
 * Must validate decimal precision, bounds, and consistency before subprocess execution.
 * Matches the SDD §4.1 parameters defined in the feature specification.
 */

import { validateDecimal } from '../utils/DecimalValidator.js';

/**
 * ApiBacktestRequest - User-submitted configuration matching SDD §4.1 parameters
 * 
 * All monetary values MUST be stringified decimals (not floats) to preserve precision.
 * Integer fields (price_scale, amount_scale, number_of_orders, multiplier) are native JSON integers.
 * The market_data_csv_path is resolved and appended by the MarketDataResolver before engine dispatch.
 */
export interface ApiBacktestRequest {
  /** Trading pair (e.g., "BTC/USDT") */
  trading_pair: string;

  /** Start date in RFC 3339 format (YYYY-MM-DDTHH:MM:SSZ) */
  start_date: string;

  /** End date in RFC 3339 format (YYYY-MM-DDTHH:MM:SSZ, must be >= start_date, same month for MVP) */
  end_date: string;

  /** Entry price (decimal string, > 0) */
  price_entry: string;

  /** Price scale for recurrence (decimal string > 0, SDD §2.1 base, e.g., "1.1") */
  price_scale: string;

  /** Amount scale for recurrence (decimal string > 0, SDD §2.2 base, e.g., "2.0") */
  amount_scale: string;

  /** Number of orders (integer >= 1) */
  number_of_orders: number;

  /** Amount per trade (decimal string, in (0, 1] fraction of equity) */
  amount_per_trade: string;

  /** Margin type ("cross" or "isolated") */
  margin_type: 'cross' | 'isolated';

  /** Multiplier (integer >= 1, where 1 = spot, > 1 = margin) */
  multiplier: number;

  /** Take profit distance percent (decimal string, > 0) */
  take_profit_distance_percent: string;

  /** Account balance in USDT (decimal string, > 0) */
  account_balance: string;

  /** Exit on last order flag (boolean: end simulation when last order fills) */
  exit_on_last_order: boolean;

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
 * Validates ApiBacktestRequest against all SDD §4.1 field requirements
 * 
 * Constraints per research.md decisions:
 * - All monetary values must be decimals (not floats): "100.50" ✅, 100.5 ❌
 * - Integers (price_scale, amount_scale, number_of_orders, multiplier) must be native JSON integers
 * - price_entry > 0
 * - price_scale, amount_scale, number_of_orders, multiplier >= 1
 * - amount_per_trade > 0 (direct dollar amount)
 * - take_profit_distance_percent > 0
 * - account_balance > 0
 * - margin_type is "cross" or "isolated"
 * - exit_on_last_order is boolean (no coercion)
 * - start_date, end_date in RFC 3339 format (YYYY-MM-DDTHH:MM:SSZ)
 * - end_date >= start_date
 * - MVP: start_date and end_date must be same month (YYYY-MM guard)
 * - idempotency_key is optional UUID v4
 * 
 * @param request - Object to validate as ApiBacktestRequest
 * @returns Validated ApiBacktestRequest object with market_data_csv_path field appended
 * @throws ValidationError if constraints violated
 * 
 * @example
 * const valid = {
 *   trading_pair: 'BTC/USDT',
 *   start_date: '2024-01-01T00:00:00Z',
 *   end_date: '2024-01-31T23:59:59Z',
 *   price_entry: '100.50',
 *   price_scale: 2,
 *   amount_scale: 2,
 *   number_of_orders: 5,
 *   amount_per_trade: '1000.0',
 *   margin_type: 'cross',
 *   multiplier: 1,
 *   take_profit_distance_percent: '2.0',
 *   account_balance: '2000.0',
 *   exit_on_last_order: false
 * };
 * const validated = validateBacktestRequest(valid); // ✅ returns the object
 * 
 * validateBacktestRequest({ ...valid, multiplier: 1.5 });
 * // ❌ throws ValidationError("multiplier", "type_error", "...")
 */
export function validateBacktestRequest(request: any): ApiBacktestRequest & { market_data_csv_path?: string } {
  // Validate trading_pair
  if (request.trading_pair === undefined) {
    throw new ValidationError('trading_pair', 'required_field', 'Missing required field: trading_pair');
  }
  if (typeof request.trading_pair !== 'string' || request.trading_pair === '') {
    throw new ValidationError(
      'trading_pair',
      'type_error',
      `trading_pair must be a non-empty string, got ${typeof request.trading_pair}`
    );
  }

  // Validate start_date
  if (request.start_date === undefined) {
    throw new ValidationError('start_date', 'required_field', 'Missing required field: start_date');
  }
  if (typeof request.start_date !== 'string') {
    throw new ValidationError(
      'start_date',
      'type_error',
      `start_date must be a string, got ${typeof request.start_date}`
    );
  }
  const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  if (!dateRegex.test(request.start_date)) {
    throw new ValidationError(
      'start_date',
      'invalid_format',
      `start_date must be in RFC 3339 format YYYY-MM-DDTHH:MM:SSZ, got "${request.start_date}"`
    );
  }

  // Validate end_date
  if (request.end_date === undefined) {
    throw new ValidationError('end_date', 'required_field', 'Missing required field: end_date');
  }
  if (typeof request.end_date !== 'string') {
    throw new ValidationError(
      'end_date',
      'type_error',
      `end_date must be a string, got ${typeof request.end_date}`
    );
  }
  if (!dateRegex.test(request.end_date)) {
    throw new ValidationError(
      'end_date',
      'invalid_format',
      `end_date must be in RFC 3339 format YYYY-MM-DDTHH:MM:SSZ, got "${request.end_date}"`
    );
  }

  // Validate end_date >= start_date
  if (request.end_date < request.start_date) {
    throw new ValidationError(
      'end_date',
      'out_of_bounds',
      `end_date must be >= start_date, got ${request.end_date} < ${request.start_date}`
    );
  }

  // MVP: Validate start_date and end_date are same month (YYYY-MM)
  const startMonth = request.start_date.substring(0, 7); // YYYY-MM
  const endMonth = request.end_date.substring(0, 7);
  if (startMonth !== endMonth) {
    throw new ValidationError(
      'date_range',
      'same_month_guard',
      `start_date and end_date must be in the same month (MVP limitation). Got ${startMonth} and ${endMonth}`
    );
  }

  // Validate price_entry
  if (request.price_entry === undefined) {
    throw new ValidationError('price_entry', 'required_field', 'Missing required field: price_entry');
  }
  if (typeof request.price_entry !== 'string') {
    throw new ValidationError(
      'price_entry',
      'type_error',
      `price_entry must be a string decimal (e.g., "100.50"), got ${typeof request.price_entry}`
    );
  }
  let validatedPriceEntry: string;
  try {
    validatedPriceEntry = validateDecimal(request.price_entry);
  } catch (error) {
    throw new ValidationError('price_entry', 'decimal_error', `Invalid price_entry: ${String(error)}`);
  }
  if (parseFloat(validatedPriceEntry) <= 0) {
    throw new ValidationError('price_entry', 'out_of_bounds', `price_entry must be > 0, got ${validatedPriceEntry}`);
  }

  // Validate price_scale (decimal string > 0)
  if (request.price_scale === undefined) {
    throw new ValidationError('price_scale', 'required_field', 'Missing required field: price_scale');
  }
  if (typeof request.price_scale !== 'string') {
    throw new ValidationError(
      'price_scale',
      'type_error',
      `price_scale must be a string decimal, got ${typeof request.price_scale}`
    );
  }
  let validatedPriceScale: string;
  try {
    validatedPriceScale = validateDecimal(request.price_scale);
  } catch (error) {
    throw new ValidationError('price_scale', 'decimal_error', `Invalid price_scale: ${String(error)}`);
  }
  if (parseFloat(validatedPriceScale) <= 0) {
    throw new ValidationError('price_scale', 'out_of_bounds', `price_scale must be > 0, got ${validatedPriceScale}`);
  }

  // Validate amount_scale (decimal string > 0)
  if (request.amount_scale === undefined) {
    throw new ValidationError('amount_scale', 'required_field', 'Missing required field: amount_scale');
  }
  if (typeof request.amount_scale !== 'string') {
    throw new ValidationError(
      'amount_scale',
      'type_error',
      `amount_scale must be a string decimal, got ${typeof request.amount_scale}`
    );
  }
  let validatedAmountScale: string;
  try {
    validatedAmountScale = validateDecimal(request.amount_scale);
  } catch (error) {
    throw new ValidationError('amount_scale', 'decimal_error', `Invalid amount_scale: ${String(error)}`);
  }
  if (parseFloat(validatedAmountScale) <= 0) {
    throw new ValidationError('amount_scale', 'out_of_bounds', `amount_scale must be > 0, got ${validatedAmountScale}`);
  }

  // Validate number_of_orders (integer >= 1)
  if (request.number_of_orders === undefined) {
    throw new ValidationError('number_of_orders', 'required_field', 'Missing required field: number_of_orders');
  }
  if (typeof request.number_of_orders !== 'number' || !Number.isInteger(request.number_of_orders)) {
    throw new ValidationError(
      'number_of_orders',
      'type_error',
      `number_of_orders must be an integer, got ${typeof request.number_of_orders}`
    );
  }
  if (request.number_of_orders < 1) {
    throw new ValidationError(
      'number_of_orders',
      'out_of_bounds',
      `number_of_orders must be >= 1, got ${request.number_of_orders}`
    );
  }

  // Validate amount_per_trade (decimal string > 0, direct dollar amount)
  if (request.amount_per_trade === undefined) {
    throw new ValidationError('amount_per_trade', 'required_field', 'Missing required field: amount_per_trade');
  }
  if (typeof request.amount_per_trade !== 'string') {
    throw new ValidationError(
      'amount_per_trade',
      'type_error',
      `amount_per_trade must be a string decimal, got ${typeof request.amount_per_trade}`
    );
  }
  let validatedAmountPerTrade: string;
  try {
    validatedAmountPerTrade = validateDecimal(request.amount_per_trade);
  } catch (error) {
    throw new ValidationError('amount_per_trade', 'decimal_error', `Invalid amount_per_trade: ${String(error)}`);
  }
  const amountPerTradeNum = parseFloat(validatedAmountPerTrade);
  if (amountPerTradeNum <= 0) {
    throw new ValidationError(
      'amount_per_trade',
      'out_of_bounds',
      `amount_per_trade must be > 0, got ${validatedAmountPerTrade}`
    );
  }

  // Validate margin_type ("cross" or "isolated")
  if (request.margin_type === undefined) {
    throw new ValidationError('margin_type', 'required_field', 'Missing required field: margin_type');
  }
  if (request.margin_type !== 'cross' && request.margin_type !== 'isolated') {
    throw new ValidationError(
      'margin_type',
      'invalid_value',
      `margin_type must be "cross" or "isolated", got "${request.margin_type}"`
    );
  }

  // Validate multiplier (integer >= 1)
  if (request.multiplier === undefined) {
    throw new ValidationError('multiplier', 'required_field', 'Missing required field: multiplier');
  }
  if (typeof request.multiplier !== 'number' || !Number.isInteger(request.multiplier)) {
    throw new ValidationError(
      'multiplier',
      'type_error',
      `multiplier must be an integer, got ${typeof request.multiplier}`
    );
  }
  if (request.multiplier < 1) {
    throw new ValidationError('multiplier', 'out_of_bounds', `multiplier must be >= 1, got ${request.multiplier}`);
  }

  // Validate take_profit_distance_percent (decimal string > 0)
  if (request.take_profit_distance_percent === undefined) {
    throw new ValidationError(
      'take_profit_distance_percent',
      'required_field',
      'Missing required field: take_profit_distance_percent'
    );
  }
  if (typeof request.take_profit_distance_percent !== 'string') {
    throw new ValidationError(
      'take_profit_distance_percent',
      'type_error',
      `take_profit_distance_percent must be a string decimal, got ${typeof request.take_profit_distance_percent}`
    );
  }
  let validatedTakeProfitDistance: string;
  try {
    validatedTakeProfitDistance = validateDecimal(request.take_profit_distance_percent);
  } catch (error) {
    throw new ValidationError(
      'take_profit_distance_percent',
      'decimal_error',
      `Invalid take_profit_distance_percent: ${String(error)}`
    );
  }
  if (parseFloat(validatedTakeProfitDistance) <= 0) {
    throw new ValidationError(
      'take_profit_distance_percent',
      'out_of_bounds',
      `take_profit_distance_percent must be > 0, got ${validatedTakeProfitDistance}`
    );
  }

  // Validate account_balance (decimal string > 0)
  if (request.account_balance === undefined) {
    throw new ValidationError('account_balance', 'required_field', 'Missing required field: account_balance');
  }
  if (typeof request.account_balance !== 'string') {
    throw new ValidationError(
      'account_balance',
      'type_error',
      `account_balance must be a string decimal, got ${typeof request.account_balance}`
    );
  }
  let validatedAccountBalance: string;
  try {
    validatedAccountBalance = validateDecimal(request.account_balance);
  } catch (error) {
    throw new ValidationError('account_balance', 'decimal_error', `Invalid account_balance: ${String(error)}`);
  }
  if (parseFloat(validatedAccountBalance) <= 0) {
    throw new ValidationError(
      'account_balance',
      'out_of_bounds',
      `account_balance must be > 0, got ${validatedAccountBalance}`
    );
  }

  // Validate exit_on_last_order (boolean, no coercion)
  if (request.exit_on_last_order === undefined) {
    throw new ValidationError('exit_on_last_order', 'required_field', 'Missing required field: exit_on_last_order');
  }
  if (typeof request.exit_on_last_order !== 'boolean') {
    throw new ValidationError(
      'exit_on_last_order',
      'type_error',
      `exit_on_last_order must be a boolean, got ${typeof request.exit_on_last_order}`
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
    trading_pair: request.trading_pair,
    start_date: request.start_date,
    end_date: request.end_date,
    price_entry: validatedPriceEntry,
    price_scale: validatedPriceScale,
    amount_scale: validatedAmountScale,
    number_of_orders: request.number_of_orders,
    amount_per_trade: validatedAmountPerTrade,
    margin_type: request.margin_type,
    multiplier: request.multiplier,
    take_profit_distance_percent: validatedTakeProfitDistance,
    account_balance: validatedAccountBalance,
    exit_on_last_order: request.exit_on_last_order,
    idempotency_key: validatedIdempotencyKey,
  };
}
