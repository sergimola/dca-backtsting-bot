/**
 * BacktestRequest Contract
 *
 * Represents a user-submitted backtest configuration.
 * All monetary values MUST be stringified decimals to prevent float precision loss.
 * This contract is the boundary between the HTTP API and Core Engine binary.
 */

/**
 * BacktestRequest - User-submitted backtest configuration
 *
 * All price and amount fields are stringified decimals (e.g., "100.50", "0.1").
 * The API MUST reject IEEE 754 floats (e.g., entry_price: 100.50 will fail validation).
 *
 * @example
 * {
 *   entry_price: "100.50",
 *   amounts: ["10.25", "10.25", "10.25"],
 *   sequences: [0, 1, 2],
 *   leverage: "2.0",
 *   margin_ratio: "0.50",
 *   market_data_csv_path: "data/BTCUSDT_1m.csv",
 *   idempotency_key: "550e8400-e29b-41d4-a716-446655440000" // optional
 * }
 */
export interface BacktestRequest {
  /** Entry price as stringified decimal (8 decimal places, e.g., "100.50000000") */
  entry_price: string;

  /** DCA order amounts as array of stringified decimals */
  amounts: string[];

  /** Sequence indices for DCA (0-indexed, e.g., [0, 1, 2] for first 3 orders) */
  sequences: number[];

  /** Leverage multiplier as stringified decimal (e.g., "2.0") */
  leverage: string;

  /** Maintenance margin ratio as stringified decimal (0 ≤ mmr < 1, e.g., "0.50") */
  margin_ratio: string;

  /** Relative or absolute path to market data CSV file (OHLCV format) */
  market_data_csv_path: string;

  /** Optional: UUID for idempotent request handling (RFC 4122) */
  idempotency_key?: string;
}

/**
 * RequestValidationResult - Output of backend request validation
 * Used internally to communicate validation errors before Core Engine invocation
 */
export interface RequestValidationResult {
  /** true if request passed all validation checks */
  valid: boolean;

  /** Array of validation errors (empty if valid: true) */
  errors: ValidationError[];
}

/**
 * ValidationError - Represents a single validation failure
 */
export interface ValidationError {
  /** Field name that failed validation (e.g., "entry_price", "margin_ratio") */
  field: string;

  /** User-friendly error message */
  message: string;

  /** Specific validation rule that was violated */
  constraint: string;

  /** The actual value that failed */
  value?: unknown;
}

/**
 * VALIDATION RULES (MANDATORY - non-negotiable per Constitution)
 *
 * 1. entry_price
 *    - MUST be a string (not a number)
 *    - MUST be a valid decimal representation (regex: /^\d+(\.\d{1,8})?$/)
 *    - MUST NOT be negative or zero
 *    - PRECISION: 8 decimal places max
 *    - REJECT: 100.5 (number), "100.50000000001" (>8 places), "-100" (negative)
 *    - ACCEPT: "100.50", "100", "0.00000001"
 *
 * 2. amounts[]
 *    - MUST be array of strings (not numbers)
 *    - Each amount MUST be a valid decimal representation
 *    - Each amount MUST be positive (> 0)
 *    - PRECISION: 8 decimal places max
 *    - Length MUST match sequences array length
 *    - REJECT: [10.5, 20] (numbers), ["-10", "20"] (negative)
 *    - ACCEPT: ["10.25", "20.75", "5"]
 *
 * 3. sequences[]
 *    - MUST be array of integers (0-indexed)
 *    - All values MUST be >= 0
 *    - All values MUST be < some platform maximum (e.g., 100)
 *    - Length MUST match amounts array length
 *    - REJECT: [0.5, 1] (floats), [-1, 0] (negative)
 *    - ACCEPT: [0, 1, 2], [1, 3, 5]
 *
 * 4. leverage
 *    - MUST be a string
 *    - MUST be a valid decimal representation
 *    - MUST be > 1.0 (leverage requires >1)
 *    - PRECISION: 2 decimal places typical (e.g., "2.00", "1.50")
 *    - REJECT: 2 (number), "0.5" (<=1)
 *    - ACCEPT: "2.0", "1.50", "3"
 *
 * 5. margin_ratio
 *    - MUST be a string
 *    - MUST be a valid decimal representation
 *    - CONSTRAINT: 0 ≤ margin_ratio < 1 (liquidation formula constraint)
 *    - PRECISION: 2-4 decimal places typical
 *    - REJECT: 0.50 (number), "-0.1" (negative), "1.0" (>=1)
 *    - ACCEPT: "0.50", "0.25", "0.001"
 *
 * 6. market_data_csv_path
 *    - MUST be non-empty string
 *    - MUST reference existing file on Core Engine host
 *    - MUST be readable (validated by Core Engine stderr)
 *    - Path can be relative (relative to Core Engine working directory) or absolute
 *    - REJECT: "", "/dev/null" (likely to error in Core Engine)
 *    - ACCEPT: "data/BTCUSDT_1m.csv", "/mnt/data/ETHUSDT.csv"
 *
 * 7. idempotency_key (optional)
 *    - If provided, MUST be valid UUID (RFC 4122)
 *    - Regex: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
 *    - Used for request deduplication (optional feature for MVP)
 *    - REJECT: "not-a-uuid", "550e8400-e29b-41d4-a716"
 *    - ACCEPT: "550e8400-e29b-41d4-a716-446655440000"
 */

/**
 * VALIDATION CODE PATTERN (implementation guide)
 *
 * export class BacktestRequestValidator {
 *   static validate(request: unknown): RequestValidationResult {
 *     const errors: ValidationError[] = [];
 *
 *     // Type guard
 *     if (typeof request !== 'object' || request === null) {
 *       return { valid: false, errors: [{ field: 'root', message: 'Request must be an object', constraint: 'type' }] };
 *     }
 *
 *     const req = request as Record<string, unknown>;
 *
 *     // entry_price validation
 *     if (typeof req.entry_price !== 'string') {
 *       errors.push({ field: 'entry_price', message: 'entry_price must be a string', constraint: 'type' });
 *     } else if (!this.isValidDecimal(req.entry_price, 8)) {
 *       errors.push({ field: 'entry_price', message: 'entry_price must be a decimal with max 8 places', constraint: 'format' });
 *     } else if (this.toDecimal(req.entry_price).lte(0)) {
 *       errors.push({ field: 'entry_price', message: 'entry_price must be positive', constraint: 'range' });
 *     }
 *
 *     // amounts validation (similar pattern for each element)
 *     // sequences validation (similar pattern for each element)
 *     // leverage/margin_ratio validation (similar pattern)
 *     // idempotency_key validation (optional)
 *
 *     return { valid: errors.length === 0, errors };
 *   }
 *
 *   private static isValidDecimal(str: string, maxPlaces: number): boolean {
 *     const regex = new RegExp(`^\\d+(\\.\\d{1,${maxPlaces}})?$`);
 *     return regex.test(str);
 *   }
 *
 *   private static toDecimal(str: string): Decimal {
 *     return new Decimal(str);
 *   }
 * }
 */
