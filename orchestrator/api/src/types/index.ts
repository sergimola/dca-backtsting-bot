/**
 * Type Exports - Central point for all API type definitions
 * Mirrors contracts/ files: api-backtest-request, trade-event, backtest-result, error-mapping, health-metrics
 */

// ============== ApiBacktestRequest Types ==============

export interface ApiBacktestRequest {
  trading_pair: string;
  start_date: string;
  end_date: string;
  price_entry: string;
  price_scale: string;
  amount_scale: string;
  number_of_orders: number;
  amount_per_trade: string;
  margin_type: 'cross' | 'isolated';
  multiplier: number;
  take_profit_distance_percent: string;
  account_balance: string;
  exit_on_last_order: boolean;
  idempotency_key?: string;
}

// ============== TradeEvent Types ==============

export interface PositionState {
  quantity: string;
  average_cost: string;
  total_invested: string;
  leverage_level: string;
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';
  last_update_timestamp: number;
}

export interface PositionOpenedEvent {
  type: 'PositionOpened';
  timestamp: number;
  position_id: string;
  entry_price: string;
  initial_quantity: string;
  entry_fee: string;
  position_state: PositionState;
}

export interface OrderFilledEvent {
  type: 'OrderFilled';
  timestamp: number;
  order_id: string;
  price: string;
  quantity: string;
  fee: string;
  safety_order_index: number;
  position_state: PositionState;
}

export interface PositionClosedEvent {
  type: 'PositionClosed';
  timestamp: number;
  close_price: string;
  position_state: PositionState;
}

export interface LiquidationEvent {
  type: 'LiquidationEvent';
  timestamp: number;
  liquidation_price: string;
  liquidation_fee: string;
  position_state: PositionState;
}

export interface GapDownFill {
  price: string;
  quantity: string;
  safety_order_index: number;
}

export interface GapDownEvent {
  type: 'GapDownEvent';
  timestamp: number;
  gap_from_price: string;
  gap_to_price: string;
  filled_orders: GapDownFill[];
  position_state: PositionState;
}

export type TradeEvent =
  | PositionOpenedEvent
  | OrderFilledEvent
  | PositionClosedEvent
  | LiquidationEvent
  | GapDownEvent;

// ============== PnlSummary Types ==============

export interface PnlSummary {
  total_pnl: string;
  entry_fee: string;
  trading_fees: string;
  liquidation_fee?: string;
  total_fees: string;
  roi_percent: string;
  max_drawdown_percent?: string;
  total_fills: number;
  realized_pnl: string;
  unrealized_pnl?: string;
  safety_order_usage_counts: Record<number, number>;
}

// ============== BacktestResult Types ==============

export interface ErrorDetails {
  code: string;
  message: string;
  technical_message?: string;
  core_engine_stderr?: string;
}

export interface BacktestResult {
  request_id: string;
  status: 'success' | 'failed';
  events: TradeEvent[];
  final_position: PositionState;
  pnl_summary: PnlSummary;
  execution_time_ms: number;
  timestamp: string;
  error?: ErrorDetails;
}

export interface BacktestResultPage {
  results: BacktestResult[];
  pagination: {
    total_count: number;
    page_size: number;
    page_number: number;
    has_more: boolean;
  };
  filters: {
    from: string;
    to: string;
    status?: 'success' | 'failed' | 'all';
  };
}

// ============== Error Response Types ==============

export interface ValidationErrorDetail {
  field: string;
  constraint: string;
  value?: any;
  message: string;
}

export interface ErrorResponse {
  error: {
    code: string;
    http_status: number;
    message: string;
    field?: string;
    details?: ValidationErrorDetail[];
    technical_message?: string;
  };
}

// ============== Health Check Types ==============

export interface CoreEngineHealth {
  binary_available: boolean;
  status: 'ready' | 'unavailable' | 'failing';
  check_time_ms: number;
  consecutive_failures: number;
}

export interface QueueMetrics {
  depth: number;
  workers_busy: number;
  workers_total: number;
  estimated_wait_ms: number;
}

export interface OperationalMetrics {
  backtests_completed_today: number;
  average_execution_time_ms: number;
  error_rate_percent: number;
  timeout_rate_percent: number;
  response_time_median_ms: number;
  response_time_p95_ms: number;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime_seconds: number;
  core_engine: CoreEngineHealth;
  queue: QueueMetrics;
  metrics: OperationalMetrics;
}

// ============== Error Codes ==============

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
