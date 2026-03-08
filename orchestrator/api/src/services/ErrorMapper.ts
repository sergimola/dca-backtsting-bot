/**
 * ErrorMapper - Maps subprocess and parsing errors to standardized ErrorDetails
 *
 * Translates Core Engine stderr patterns, exit codes, and signals into
 * machine-readable ErrorCode values with user-friendly messages.
 */

import { ErrorCode, ERROR_CODE_MAP, ProcessError } from '../types/errors';

/**
 * ErrorDetails - Structured error information for API responses
 */
export interface ErrorDetails {
  error_code: ErrorCode;
  http_status: number;
  user_message: string;
  technical_message: string;
  stderr_snippet?: string;
}

/**
 * Maps subprocess errors (exit code, signal, stderr) to ErrorDetails
 *
 * @param exitCode - Process exit code (null if killed by signal)
 * @param signal - Signal name if process was killed (e.g., 'SIGTERM', 'SIGKILL')
 * @param stderr - Standard error output from process
 * @returns ErrorDetails with mapped error code and messages
 *
 * @example
 * // Timeout scenario
 * const error = mapSubprocessError(null, 'SIGTERM', '');
 * // Returns: { error_code: EXECUTION_TIMEOUT, http_status: 408, ... }
 *
 * @example
 * // Binary crash scenario
 * const error = mapSubprocessError(1, null, 'Core Engine: segmentation fault\nStack trace...');
 * // Returns: { error_code: EXECUTION_BINARY_CRASH, http_status: 500, ... }
 */
export function mapSubprocessError(
  exitCode: number | null,
  signal: string | null,
  stderr: string,
): ErrorDetails {
  const stderrLower = stderr.toLowerCase();
  const codeInfo = ERROR_CODE_MAP[ErrorCode.INTERNAL_SERVER_ERROR];

  // Timeout detection - we killed the process ourselves
  if (signal === 'SIGTERM') {
    const info = ERROR_CODE_MAP[ErrorCode.EXECUTION_TIMEOUT];
    return {
      error_code: ErrorCode.EXECUTION_TIMEOUT,
      http_status: info.http_status,
      user_message:
        'Backtest execution exceeded 30-second timeout. Please optimize your configuration or contact support.',
      technical_message: 'Process killed by SIGTERM due to timeout (30s threshold)',
      stderr_snippet: stderr.slice(0, 500),
    };
  }

  // Timeout in stderr
  if (stderrLower.includes('timeout')) {
    const info = ERROR_CODE_MAP[ErrorCode.EXECUTION_TIMEOUT];
    return {
      error_code: ErrorCode.EXECUTION_TIMEOUT,
      http_status: info.http_status,
      user_message:
        'Backtest execution timed out. The CSV data or configuration may be too complex.',
      technical_message: 'Timeout detected in Core Engine stderr',
      stderr_snippet: stderr.slice(0, 500),
    };
  }

  // Out of memory
  if (stderrLower.includes('out of memory') || stderrLower.includes('oom')) {
    const info = ERROR_CODE_MAP[ErrorCode.EXECUTION_OUT_OF_MEMORY];
    return {
      error_code: ErrorCode.EXECUTION_OUT_OF_MEMORY,
      http_status: info.http_status,
      user_message: 'Backtest execution ran out of memory. CSV may be too large.',
      technical_message: 'Core Engine exhausted available memory',
      stderr_snippet: stderr.slice(0, 500),
    };
  }

  // Binary not found
  if (
    stderrLower.includes('no such file') ||
    stderrLower.includes('cannot find') ||
    stderrLower.includes('not found')
  ) {
    const info = ERROR_CODE_MAP[ErrorCode.BINARY_FILE_NOT_FOUND];
    return {
      error_code: ErrorCode.BINARY_FILE_NOT_FOUND,
      http_status: info.http_status,
      user_message: 'Core Engine binary not found. Server misconfiguration.',
      technical_message: `File not found error: ${stderr}`,
      stderr_snippet: stderr.slice(0, 500),
    };
  }

  // Permission denied
  if (stderrLower.includes('permission denied') || stderrLower.includes('access denied')) {
    const info = ERROR_CODE_MAP[ErrorCode.BINARY_PERMISSION_DENIED];
    return {
      error_code: ErrorCode.BINARY_PERMISSION_DENIED,
      http_status: info.http_status,
      user_message: 'Core Engine binary is not executable. Server misconfiguration.',
      technical_message: 'Permission denied executing Core Engine',
      stderr_snippet: stderr.slice(0, 500),
    };
  }

  // CSV parsing errors
  if (
    stderrLower.includes('csv') ||
    stderrLower.includes('parse error') ||
    stderrLower.includes('invalid csv')
  ) {
    const info = ERROR_CODE_MAP[ErrorCode.CSV_PARSE_ERROR];
    return {
      error_code: ErrorCode.CSV_PARSE_ERROR,
      http_status: info.http_status,
      user_message: 'CSV data file contains errors or unexpected format.',
      technical_message: `CSV parsing failed: ${stderr}`,
      stderr_snippet: stderr.slice(0, 500),
    };
  }

  // CSV file not found
  if (stderrLower.includes('csv') && stderrLower.includes('not found')) {
    const info = ERROR_CODE_MAP[ErrorCode.CSV_FILE_NOT_FOUND];
    return {
      error_code: ErrorCode.CSV_FILE_NOT_FOUND,
      http_status: info.http_status,
      user_message: 'CSV data file not found at specified path.',
      technical_message: `CSV file not found: ${stderr}`,
      stderr_snippet: stderr.slice(0, 500),
    };
  }

  // Configuration/validation errors
  if (
    stderrLower.includes('invalid') ||
    stderrLower.includes('configuration') ||
    stderrLower.includes('validate')
  ) {
    const info = ERROR_CODE_MAP[ErrorCode.VALIDATION_TYPE_ERROR];
    return {
      error_code: ErrorCode.VALIDATION_TYPE_ERROR,
      http_status: info.http_status,
      user_message: 'Configuration validation failed. Please review your parameters.',
      technical_message: `Configuration error: ${stderr}`,
      stderr_snippet: stderr.slice(0, 500),
    };
  }

  // Handle signals (kills)
  if (signal === 'SIGKILL' || signal === 'SIGABRT') {
    const info = ERROR_CODE_MAP[ErrorCode.EXECUTION_SIGNAL_KILLED];
    return {
      error_code: ErrorCode.EXECUTION_SIGNAL_KILLED,
      http_status: info.http_status,
      user_message: 'Core Engine process was forcibly terminated.',
      technical_message: `Process killed by signal: ${signal}`,
      stderr_snippet: stderr.slice(0, 500),
    };
  }

  // Generic crash for non-zero exit
  if (exitCode !== 0 && exitCode !== null) {
    const info = ERROR_CODE_MAP[ErrorCode.EXECUTION_BINARY_CRASH];
    return {
      error_code: ErrorCode.EXECUTION_BINARY_CRASH,
      http_status: info.http_status,
      user_message: 'Core Engine execution failed. Please check your configuration.',
      technical_message: `Core Engine exited with code ${exitCode}`,
      stderr_snippet: stderr.slice(0, 500),
    };
  }

  // Default internal error
  return {
    error_code: ErrorCode.INTERNAL_SERVER_ERROR,
    http_status: codeInfo.http_status,
    user_message: 'An unexpected error occurred during backtest execution.',
    technical_message: `Unknown error: exitCode=${exitCode}, signal=${signal}, stderr=${stderr}`,
    stderr_snippet: stderr.slice(0, 500),
  };
}

/**
 * Converts a ProcessError into ErrorDetails
 *
 * @param error - ProcessError from subprocess execution
 * @returns ErrorDetails for API response
 */
export function processErrorToDetails(error: ProcessError): ErrorDetails {
  return mapSubprocessError(error.exitCode, error.signal, error.stderr);
}
