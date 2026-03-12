/**
 * Error Handler Middleware (T026)
 *
 * Catches all error types (ValidationError, ProcessError, StorageError, etc.)
 * Maps error codes to structured HTTP responses.
 * Logs errors with context for debugging.
 *
 * Response structure: { error: { code, http_status, message, field?, details? } }
 */

import { Request, Response, NextFunction } from 'express';
import {
  ValidationError,
  StorageError,
  ProcessError,
  ParseError,
  ERROR_CODE_MAP,
  ErrorCode,
} from '../types/errors.js';

/**
 * Error response structure
 */
interface ErrorResponse {
  error: {
    code: string;
    http_status: number;
    message: string;
    request_id?: string;
    field?: string;
    details?: { [key: string]: any };
    timestamp: string;
  };
}

/**
 * Express error handler middleware
 * Must be registered LAST in middleware stack
 *
 * @param err Error instance
 * @param req Express Request
 * @param res Express Response
 * @param next Express NextFunction
 */
export function errorHandlerMiddleware(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as any).requestId || 'unknown';
  const timestamp = new Date().toISOString();

  let code: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR;
  let httpStatus = 500;
  let message = 'An unexpected error occurred';
  let field: string | undefined;
  let details: any = {};

  // Handle ValidationError
  if (err instanceof ValidationError) {
    code = err.code;
    message = err.message;
    field = err.details?.field;
    details = err.details;
    const info = ERROR_CODE_MAP[code];
    httpStatus = info?.http_status || 400;
  }

  // Handle StorageError
  else if (err instanceof StorageError) {
    code = err.code;
    message = err.message;
    details = {
      operation: err.operation,
      ...err.details,
    };
    const info = ERROR_CODE_MAP[code];
    httpStatus = info?.http_status || 500;
  }

  // Handle ProcessError (from Core Engine subprocess)
  else if (err instanceof ProcessError) {
    // Map subprocess error to error code based on exit code/signal
    if (err.signal === 'SIGKILL' || err.signal === 'SIGTERM') {
      code = ErrorCode.EXECUTION_TIMEOUT;
      httpStatus = 504;
      message = 'Backtest process was terminated due to timeout';
    } else if (err.exitCode && err.exitCode !== 0) {
      code = ErrorCode.EXECUTION_BINARY_CRASH;
      httpStatus = 500;
      message = `Backtest process exited with code ${err.exitCode}`;
    } else {
      code = ErrorCode.EXECUTION_BINARY_CRASH;
      httpStatus = 500;
      message = err.message || 'Backtest process failed';
    }
    details = {
      exit_code: err.exitCode,
      signal: err.signal,
      stderr_snippet: err.stderr?.substring(0, 200),
    };
  }

  // Handle ParseError (from ndjson parsing)
  else if (err instanceof ParseError) {
    code = ErrorCode.CSV_PARSE_ERROR;
    message = `Failed to parse event at line ${err.lineNumber}: ${err.message}`;
    details = {
      line_number: err.lineNumber,
      line_content: err.lineContent.substring(0, 100), // Truncate for safety
    };
    httpStatus = 422;
  }

  // Handle generic Error
  else if (err instanceof Error) {
    code = ErrorCode.INTERNAL_SERVER_ERROR;
    message = err.message || 'Unknown error';
    httpStatus = 500;
  }

  // Log error
  console.error(`[ERROR] [${requestId}] ${code}: ${message}`, {
    code,
    http_status: httpStatus,
    message,
    field,
    details,
    stack: err?.stack,
  });

  // Build and send error response
  const response: ErrorResponse = {
    error: {
      code,
      http_status: httpStatus,
      message,
      request_id: requestId === 'unknown' ? undefined : requestId,
      field,
      details: Object.keys(details).length > 0 ? details : undefined,
      timestamp,
    },
  };

  res.status(httpStatus).json(response);
}
