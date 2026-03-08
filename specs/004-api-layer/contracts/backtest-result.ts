/**
 * Backtest Result Contract
 *
 * Represents the complete result of a backtest execution.
 * Returned to user as JSON in HTTP 200 response.
 * Structure mirrors Event Bus events + aggregated summary.
 */

import type { TradeEvent, PositionState } from './trade-event';

/**
 * BacktestResult - Complete result of executing a single backtest
 *
 * This is the primary HTTP response body for POST /backtest requests.
 * It contains all Event Bus events from the Core Engine execution,
 * plus aggregated P&L and position summary.
 *
 * @example HTTP 200 Response
 * {
 *   "request_id": "550e8400-e29b-41d4-a716-446655440000",
 *   "status": "success",
 *   "events": [
 *     { "type": "PositionOpened", "timestamp": 1704067200000, ... },
 *     { "type": "OrderFilled", "timestamp": 1704067260000, ... },
 *     { "type": "PositionClosed", "timestamp": 1704067380000, ... }
 *   ],
 *   "final_position": { /* PositionState */ },
 *   "pnl_summary": { /* PnlSummary */ },
 *   "execution_time_ms": 250,
 *   "timestamp": "2024-01-01T12:00:00Z"
 * }
 */
export interface BacktestResult {
  /** Unique request identifier (UUID) for audit trail and retrieval */
  request_id: string;

  /** Result status: "success" or "failed" */
  status: 'success' | 'failed';

  /** Array of all events from Core Engine in execution order */
  events: TradeEvent[];

  /** Final position state snapshot (from last event) */
  final_position: PositionState;

  /** Aggregated profit/loss summary */
  pnl_summary: PnlSummary;

  /** How long backtest execution took (milliseconds) */
  execution_time_ms: number;

  /** ISO 8601 timestamp when result was generated */
  timestamp: string;

  /** Optional: error details (only if status: "failed") */
  error?: ErrorDetails;
}

/**
 * PnlSummary - Aggregated profit/loss metrics
 * Calculated from all TradeEvents in sequence
 */
export interface PnlSummary {
  /** Total profit/loss as decimal string (positive = gain, negative = loss) */
  total_pnl: string;

  /** Entry fee paid (fee for opening position) as decimal string */
  entry_fee: string;

  /** Sum of all fees paid during fills as decimal string */
  trading_fees: string;

  /** Liquidation fee if position was liquidated, otherwise "0" */
  liquidation_fee?: string;

  /** Total fees (entry_fee + trading_fees + liquidation_fee) */
  total_fees: string;

  /** Return on investment percentage (pnl / initial_investment * 100) */
  roi_percent: string;

  /** Maximum drawdown during backtest (percent) */
  max_drawdown_percent?: string;

  /** Number of successful fills */
  total_fills: number;

  /** Realized P&L (same as total_pnl for closed positions) */
  realized_pnl: string;

  /** Unrealized P&L if position still open */
  unrealized_pnl?: string;

  /** Number of times each safety order index was filled (e.g., { "1": 45, "2": 12, "3": 0 }) */
  safety_order_usage_counts: Record<number, number>;
}

/**
 * ErrorDetails - Error information if backtest failed
 */
export interface ErrorDetails {
  /** Machine-readable error code (see ERROR_CODES mapping) */
  code: string;

  /** User-friendly error message */
  message: string;

  /** Technical details for debugging */
  technical_message?: string;

  /** Core Engine stderr output (if available) */
  core_engine_stderr?: string;
}

/**
 * BacktestResultPage - Paginated backtest results (for GET /backtest?from=X&to=Y)
 * Used when querying historical results with date range filtering
 */
export interface BacktestResultPage {
  /** Array of backtest results matching filter criteria */
  results: BacktestResult[];

  /** Pagination metadata */
  pagination: {
    /** Total number of results matching filter */
    total_count: number;

    /** Number of results in this page */
    page_size: number;

    /** Current page number (0-indexed) */
    page_number: number;

    /** Has more pages after this one */
    has_more: boolean;
  };

  /** Filter criteria applied */
  filters: {
    /** Start of date range (ISO 8601) */
    from: string;

    /** End of date range (ISO 8601) */
    to: string;

    /** Status filter (optional) */
    status?: 'success' | 'failed' | 'all';
  };
}

/**
 * ERROR_CODES - Machine-readable error classification
 *
 * Maps Core Engine errors to HTTP status codes and user messages.
 * Used by ErrorMapper service to translate subprocess stderr.
 *
 * Format: ERROR_<CATEGORY>_<SPECIFIC>
 * Examples:
 * - VALIDATION_MISSING_FIELD
 * - VALIDATION_FLOAT_PRECISION
 * - VALIDATION_OUT_OF_BOUNDS
 * - EXECUTION_BINARY_CRASH
 * - EXECUTION_TIMEOUT
 * - EXECUTION_OUT_OF_MEMORY
 * - BINARY_FILE_NOT_FOUND
 * - CSV_PARSE_ERROR
 * - STORAGE_WRITE_ERROR
 */
export const ERROR_CODES = {
  // Validation errors (HTTP 400/422)
  VALIDATION_MISSING_FIELD: {
    http_status: 400,
    message_template: 'Missing required field: {field}. Expected type: {type}',
  },
  VALIDATION_FLOAT_PRECISION: {
    http_status: 400,
    message_template: 'Field "{field}" must be a decimal string, not a float. Example: "{example}"',
  },
  VALIDATION_OUT_OF_BOUNDS: {
    http_status: 422,
    message_template: 'Field "{field}" is out of bounds. Expected range: {range}. Got: {value}',
  },
  VALIDATION_TYPE_ERROR: {
    http_status: 400,
    message_template: 'Field "{field}" has wrong type. Expected: {type}, got: {actual_type}',
  },

  // Execution errors (HTTP 5xx)
  EXECUTION_BINARY_CRASH: {
    http_status: 500,
    message_template: 'Core Engine binary crashed: {reason}. Please retry or contact support.',
  },
  EXECUTION_TIMEOUT: {
    http_status: 504,
    message_template: 'Backtest execution exceeded 30-second timeout. Backtest too complex or data too large.',
  },
  EXECUTION_OUT_OF_MEMORY: {
    http_status: 503,
    message_template: 'Core Engine ran out of memory. Try smaller backtest or add more resources.',
  },
  EXECUTION_SIGNAL_KILLED: {
    http_status: 502,
    message_template: 'Core Engine was terminated (signal: {signal}). System may be under heavy load.',
  },

  // Binary/infrastructure errors (HTTP 5xx)
  BINARY_FILE_NOT_FOUND: {
    http_status: 500,
    message_template: 'Core Engine binary not found at {path}. Server misconfigured.',
  },
  BINARY_PERMISSION_DENIED: {
    http_status: 500,
    message_template: 'Permission denied executing Core Engine binary. Server misconfigured.',
  },

  // Input data errors (HTTP 422/400)
  CSV_FILE_NOT_FOUND: {
    http_status: 422,
    message_template: 'Market data CSV file not found: {path}',
  },
  CSV_PARSE_ERROR: {
    http_status: 422,
    message_template: 'Failed to parse CSV file: {reason}',
  },

  // Storage errors (HTTP 5xx)
  STORAGE_WRITE_ERROR: {
    http_status: 500,
    message_template: 'Failed to store backtest result. Please retry or contact support.',
  },
  STORAGE_RETRIEVE_ERROR: {
    http_status: 500,
    message_template: 'Failed to retrieve stored result. Please retry or contact support.',
  },

  // API-specific errors (HTTP 4xx)
  REQUEST_VALIDATION_FAILED: {
    http_status: 400,
    message_template: 'Request validation failed. Errors: {errors}',
  },
  IDEMPOTENCY_KEY_INVALID: {
    http_status: 400,
    message_template: 'idempotency_key must be a valid UUID (RFC 4122). Example: 550e8400-e29b-41d4-a716-446655440000',
  },

  // Generic errors
  INTERNAL_SERVER_ERROR: {
    http_status: 500,
    message_template: 'An unexpected error occurred. Please retry or contact support.',
  },
} as const;

/**
 * RESPONSE SERIALIZATION RULES (MANDATORY)
 *
 * All monetary values in BacktestResult MUST serialize with consistent precision:
 *
 * 1. **Prices** (entry_price, fill prices, close prices, liquidation_price):
 *    - 8 decimal places
 *    - Example: "100.50000000"
 *    - Implemented with: value.toFixed(8) or Decimal(value).toString()
 *
 * 2. **Amounts** (quantity, total_pnl, fees, etc.):
 *    - 8 decimal places
 *    - Example: "10.25000000"
 *
 * 3. **Percentages** (roi_percent, max_drawdown_percent):
 *    - 2 decimal places
 *    - Example: "5.50" (means 5.50%)
 *
 * 4. **Timestamps** (execution_time_ms):
 *    - Integer milliseconds (no decimal places)
 *    - Example: 250
 *
 * 5. **ISO timestamps** (timestamp):
 *    - ISO 8601 format with Z suffix
 *    - Example: "2024-01-01T12:00:00.000Z"
 *
 * RATIONALE: These precision rules bind API responses to Core Engine Decimal output.
 * Any deviation indicates precision loss or serialization error.
 * Tests MUST verify all values serialize correctly without rounding artifacts.
 */

/**
 * EXAMPLE RESPONSES
 *
 * Success Response:
 * {
 *   "request_id": "550e8400-e29b-41d4-a716-446655440000",
 *   "status": "success",
 *   "events": [...],
 *   "final_position": {...},
 *   "pnl_summary": {
 *     "total_pnl": "15.50000000",
 *     "roi_percent": "5.50",
 *     "total_fees": "1.25000000"
 *   },
 *   "execution_time_ms": 250,
 *   "timestamp": "2024-01-01T12:00:00.000Z"
 * }
 *
 * Failure Response (HTTP 400):
 * {
 *   "error": {
 *     "code": "VALIDATION_FLOAT_PRECISION",
 *     "http_status": 400,
 *     "message": "Field \"entry_price\" must be a decimal string, not a float. Example: \"100.50\"",
 *     "field": "entry_price"
 *   }
 * }
 *
 * Failure Response (HTTP 504 - timeout):
 * {
 *   "error": {
 *     "code": "EXECUTION_TIMEOUT",
 *     "http_status": 504,
 *     "message": "Backtest execution exceeded 30-second timeout. Backtest too complex or data too large."
 *   }
 * }
 */
