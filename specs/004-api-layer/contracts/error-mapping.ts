/**
 * Error Mapping Contract
 *
 * Standardized error response structure for all API errors.
 * HTTP errors route through this contract regardless of error source.
 */

/**
 * ErrorResponse - Standard HTTP error response structure
 *
 * Used for:
 * - Validation errors (HTTP 400/422)
 * - Core Engine execution failures (HTTP 500/504)
 * - Infrastructure errors (HTTP 5xx)
 * - Client errors (HTTP 4xx)
 *
 * All error responses return this structure with status codes:
 * - 400 Bad Request: Malformed request or validation failure
 * - 422 Unprocessable Entity: Request validation passed but data invalid
 * - 500 Internal Server Error: API or Core Engine crash
 * - 503 Service Unavailable: Resource exhaustion (OOM, etc.)
 * - 504 Gateway Timeout: Backtest exceeded 30-second timeout
 *
 * @example HTTP 400 Response
 * {
 *   "error": {
 *     "code": "VALIDATION_MISSING_FIELD",
 *     "http_status": 400,
 *     "message": "Missing required field: entry_price. Expected type: string",
 *     "field": "entry_price",
 *     "details": {
 *       "expected_type": "string",
 *       "expected_format": "decimal"
 *     }
 *   }
 * }
 *
 * @example HTTP 504 Response
 * {
 *   "error": {
 *     "code": "EXECUTION_TIMEOUT",
 *     "http_status": 504,
 *     "message": "Backtest execution exceeded 30-second timeout. Backtest too complex or data too large."
 *   }
 * }
 */
export interface ErrorResponse {
  /** Error details object */
  error: {
    /** Machine-readable error code (see ERROR_CODES in backtest-result.ts) */
    code: string;

    /** HTTP status code that should be returned (e.g., 400, 422, 500, 504) */
    http_status: number;

    /** User-friendly error message */
    message: string;

    /** Optional: field name if error is field-specific (e.g., "entry_price") */
    field?: string;

    /** Optional: technical details for debugging (should not expose internal secrets) */
    details?: Record<string, unknown>;

    /** Optional: request ID for tracing (should be included if known) */
    request_id?: string;

    /** Optional: Core Engine stderr if available (for debugging) */
    core_engine_stderr?: string;
  };
}

/**
 * ValidationErrorResponse - Detailed validation error response
 *
 * Used when request body validation fails (HTTP 400).
 * Contains array of specific field violations.
 *
 * @example
 * {
 *   "error": {
 *     "code": "REQUEST_VALIDATION_FAILED",
 *     "http_status": 400,
 *     "message": "Request validation failed with 2 errors",
 *     "details": {
 *       "validation_errors": [
 *         {
 *           "field": "entry_price",
 *           "message": "entry_price must be a decimal string",
 *           "constraint": "format",
 *           "value": 100.50
 *         },
 *         {
 *           "field": "margin_ratio",
 *           "message": "margin_ratio must be between 0 and 1",
 *           "constraint": "range",
 *           "value": "1.5"
 *         }
 *       ]
 *     }
 *   }
 * }
 */
export interface ValidationErrorResponse extends ErrorResponse {
  error: ErrorResponse['error'] & {
    details?: {
      /** Array of individual field validation failures */
      validation_errors: Array<{
        /** Field name that failed validation */
        field: string;

        /** User-friendly error message */
        message: string;

        /** Validation constraint that was violated (e.g., "format", "range", "type") */
        constraint: string;

        /** The actual value that failed validation */
        value: unknown;
      }>;
    };
  };
}

/**
 * ErrorMapper Service Pattern
 *
 * Maps Core Engine stderr patterns and API errors to standardized ErrorResponse.
 * Implements error code to HTTP status mapping.
 *
 * export class ErrorMapper {
 *   /**
 *    * Map Core Engine subprocess stderr to ErrorResponse
 *    * Parses common Core Engine error patterns and maps to HTTP status
 *    * /
 *   static mapSubprocessError(stderr: string, timeout: boolean): ErrorResponse {
 *     if (timeout) {
 *       return {
 *         error: {
 *           code: 'EXECUTION_TIMEOUT',
 *           http_status: 504,
 *           message: 'Backtest execution exceeded 30-second timeout.',
 *           core_engine_stderr: stderr.slice(0, 500), // Truncate for security
 *         },
 *       };
 *     }
 *
 *     // Check for common error patterns in stderr
 *     if (stderr.includes('out of memory')) {
 *       return {
 *         error: {
 *           code: 'EXECUTION_OUT_OF_MEMORY',
 *           http_status: 503,
 *           message: 'Core Engine ran out of memory. Try smaller backtest or add more resources.',
 *           core_engine_stderr: stderr.slice(0, 500),
 *         },
 *       };
 *     }
 *
 *     if (stderr.includes('invalid configuration')) {
 *       return {
 *         error: {
 *           code: 'VALIDATION_OUT_OF_BOUNDS',
 *           http_status: 422,
 *           message: 'Configuration validation failed. Please check input values.',
 *           core_engine_stderr: stderr.slice(0, 500),
 *         },
 *       };
 *     }
 *
 *     // Generic subprocess crash
 *     return {
 *       error: {
 *         code: 'EXECUTION_BINARY_CRASH',
 *         http_status: 500,
 *         message: 'Core Engine binary crashed. Please retry or contact support.',
 *         core_engine_stderr: stderr.slice(0, 500),
 *       },
 *     };
 *   }
 *
 *   /**
 *    * Create validation error response with field-specific details
 *    * /
 *   static validationError(errors: Array<{field: string, message: string, constraint: string, value: unknown}>): ValidationErrorResponse {
 *     return {
 *       error: {
 *         code: 'REQUEST_VALIDATION_FAILED',
 *         http_status: 400,
 *         message: `Request validation failed with ${errors.length} error(s)`,
 *         details: {
 *           validation_errors: errors,
 *         },
 *       },
 *     };
 *   }
 *
 *   /**
 *    * Create a generic API error response
 *    * /
 *   static apiError(code: string, http_status: number, message: string, details?: Record<string, unknown>): ErrorResponse {
 *     return {
 *       error: {
 *         code,
 *         http_status,
 *         message,
 *         details,
 *       },
 *     };
 *   }
 * }
 */

/**
 * HTTP STATUS CODES - Used by API
 *
 * 200 OK - Backtest executed successfully
 * 400 Bad Request - Request syntax invalid or validation failed (field missing, type wrong)
 * 404 Not Found - Result with given request_id not found (for GET /backtest/:id)
 * 422 Unprocessable Entity - Request valid but data semantically invalid (e.g., negative price)
 * 500 Internal Server Error - API or Core Engine crash, temporary failure
 * 503 Service Unavailable - Resource exhaustion (OOM, too many concurrent requests)
 * 504 Gateway Timeout - Backtest execution exceeded 30-second timeout
 */
