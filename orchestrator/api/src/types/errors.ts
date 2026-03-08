/**
 * Error Types and Codes
 *
 * Defines all error codes that can be returned by the API.
 * Maps Core Engine errors to HTTP status codes and user-friendly messages.
 */

/**
 * ProcessError - Error from subprocess execution
 * Includes exit code, signal, and stderr for debugging
 */
export class ProcessError extends Error {
  constructor(
    public exitCode: number | null,
    public signal: string | null,
    public stderr: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

/**
 * ParseError - Error from event parsing
 * Includes line number and context for debugging
 */
export class ParseError extends Error {
  constructor(
    public lineNumber: number,
    public lineContent: string,
    message: string,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * ErrorCode - Machine-readable error classification
 * Used by ErrorMapper to determine HTTP status code and message
 */
export enum ErrorCode {
  // Validation errors (HTTP 400/422)
  VALIDATION_MISSING_FIELD = 'VALIDATION_MISSING_FIELD',
  VALIDATION_FLOAT_PRECISION = 'VALIDATION_FLOAT_PRECISION',
  VALIDATION_OUT_OF_BOUNDS = 'VALIDATION_OUT_OF_BOUNDS',
  VALIDATION_TYPE_ERROR = 'VALIDATION_TYPE_ERROR',

  // Execution errors (HTTP 5xx)
  EXECUTION_BINARY_CRASH = 'EXECUTION_BINARY_CRASH',
  EXECUTION_TIMEOUT = 'EXECUTION_TIMEOUT',
  EXECUTION_OUT_OF_MEMORY = 'EXECUTION_OUT_OF_MEMORY',
  EXECUTION_SIGNAL_KILLED = 'EXECUTION_SIGNAL_KILLED',

  // Binary/infrastructure errors (HTTP 5xx)
  BINARY_FILE_NOT_FOUND = 'BINARY_FILE_NOT_FOUND',
  BINARY_PERMISSION_DENIED = 'BINARY_PERMISSION_DENIED',

  // Input data errors (HTTP 422/400)
  CSV_FILE_NOT_FOUND = 'CSV_FILE_NOT_FOUND',
  CSV_PARSE_ERROR = 'CSV_PARSE_ERROR',

  // Storage errors (HTTP 5xx)
  STORAGE_WRITE_ERROR = 'STORAGE_WRITE_ERROR',
  STORAGE_RETRIEVE_ERROR = 'STORAGE_RETRIEVE_ERROR',

  // API-specific errors (HTTP 4xx)
  REQUEST_VALIDATION_FAILED = 'REQUEST_VALIDATION_FAILED',
  IDEMPOTENCY_KEY_INVALID = 'IDEMPOTENCY_KEY_INVALID',

  // Generic errors
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
}

/**
 * ErrorCodeInfo - Metadata for an error code
 * Includes HTTP status and message template
 */
export interface ErrorCodeInfo {
  http_status: number;
  message_template: string;
}

/**
 * Mapping of error codes to HTTP status codes and messages
 */
export const ERROR_CODE_MAP: Record<ErrorCode, ErrorCodeInfo> = {
  [ErrorCode.VALIDATION_MISSING_FIELD]: {
    http_status: 400,
    message_template: 'Missing required field: {field}. Expected type: {type}',
  },
  [ErrorCode.VALIDATION_FLOAT_PRECISION]: {
    http_status: 400,
    message_template: 'Field "{field}" must be a decimal string, not a float. Example: "{example}"',
  },
  [ErrorCode.VALIDATION_OUT_OF_BOUNDS]: {
    http_status: 422,
    message_template: 'Field "{field}" is out of bounds. Expected range: {range}. Got: {value}',
  },
  [ErrorCode.VALIDATION_TYPE_ERROR]: {
    http_status: 400,
    message_template: 'Field "{field}" has wrong type. Expected: {type}, got: {actual_type}',
  },

  [ErrorCode.EXECUTION_BINARY_CRASH]: {
    http_status: 500,
    message_template: 'Core Engine binary crashed: {reason}. Please retry or contact support.',
  },
  [ErrorCode.EXECUTION_TIMEOUT]: {
    http_status: 504,
    message_template: 'Backtest execution exceeded 30-second timeout. Backtest too complex or data too large.',
  },
  [ErrorCode.EXECUTION_OUT_OF_MEMORY]: {
    http_status: 503,
    message_template: 'Core Engine ran out of memory. Try smaller backtest or add more resources.',
  },
  [ErrorCode.EXECUTION_SIGNAL_KILLED]: {
    http_status: 502,
    message_template: 'Core Engine was terminated (signal: {signal}). System may be under heavy load.',
  },

  [ErrorCode.BINARY_FILE_NOT_FOUND]: {
    http_status: 500,
    message_template: 'Core Engine binary not found at {path}. Server misconfigured.',
  },
  [ErrorCode.BINARY_PERMISSION_DENIED]: {
    http_status: 500,
    message_template: 'Permission denied executing Core Engine binary. Server misconfigured.',
  },

  [ErrorCode.CSV_FILE_NOT_FOUND]: {
    http_status: 422,
    message_template: 'Market data CSV file not found: {path}',
  },
  [ErrorCode.CSV_PARSE_ERROR]: {
    http_status: 422,
    message_template: 'Failed to parse CSV file: {reason}',
  },

  [ErrorCode.STORAGE_WRITE_ERROR]: {
    http_status: 500,
    message_template: 'Failed to store backtest result. Please retry or contact support.',
  },
  [ErrorCode.STORAGE_RETRIEVE_ERROR]: {
    http_status: 500,
    message_template: 'Failed to retrieve stored result. Please retry or contact support.',
  },

  [ErrorCode.REQUEST_VALIDATION_FAILED]: {
    http_status: 400,
    message_template: 'Request validation failed. Errors: {errors}',
  },
  [ErrorCode.IDEMPOTENCY_KEY_INVALID]: {
    http_status: 400,
    message_template:
      'idempotency_key must be a valid UUID (RFC 4122). Example: 550e8400-e29b-41d4-a716-446655440000',
  },

  [ErrorCode.INTERNAL_SERVER_ERROR]: {
    http_status: 500,
    message_template: 'An unexpected error occurred. Please retry or contact support.',
  },
};
