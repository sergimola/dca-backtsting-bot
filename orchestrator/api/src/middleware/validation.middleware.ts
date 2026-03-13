/**
 * Validation Middleware (T003)
 *
 * Validates incoming ApiBacktestRequest against schema:
 * - All 13 SDD §4.1 required fields present
 * - Decimal.js precision (no floats, 8 decimal max) for monetary values
 * - Integer validation for price_scale, amount_scale, number_of_orders, multiplier
 * - Bounds validation (price_entry > 0, amount_per_trade ∈ (0,1], multiplier >= 1, etc.)
 * - Date range validation (end_date >= start_date, same month MVP guard)
 *
 * On validation error: passes ValidationError to next(err)
 */

import { Request, Response, NextFunction } from 'express';
import { validateBacktestRequest } from '../types/configuration.js';
import { ValidationError, ErrorCode } from '../types/errors.js';

/**
 * Express middleware for validating ApiBacktestRequest
 *
 * @param req Express Request with JSON body
 * @param res Express Response
 * @param next Express NextFunction
 */
export function validationMiddleware(req: Request, _res: Response, next: NextFunction): void {
  try {
    // Validate body against ApiBacktestRequest schema
    const validatedRequest = validateBacktestRequest(req.body);

    // Attach validated request to Express request context
    (req as any).validatedBacktestRequest = validatedRequest;

    next();
  } catch (error: any) {
    // Map constraint name (from configuration.ValidationError) to the proper ErrorCode
    const CONSTRAINT_TO_CODE: Record<string, ErrorCode> = {
      out_of_bounds: ErrorCode.VALIDATION_OUT_OF_BOUNDS,
      type_error: ErrorCode.VALIDATION_TYPE_ERROR,
      required_field: ErrorCode.VALIDATION_MISSING_FIELD,
      decimal_error: ErrorCode.VALIDATION_FLOAT_PRECISION,
      empty_value: ErrorCode.VALIDATION_MISSING_FIELD,
      invalid_format: ErrorCode.VALIDATION_TYPE_ERROR,
      invalid_value: ErrorCode.VALIDATION_OUT_OF_BOUNDS,
      same_month_guard: ErrorCode.VALIDATION_OUT_OF_BOUNDS,
      length_mismatch: ErrorCode.VALIDATION_TYPE_ERROR,
    };
    // Preserve an explicit code if already set (e.g. errors.ValidationError),
    // otherwise derive from the constraint string, falling back to REQUEST_VALIDATION_FAILED
    const finalCode: ErrorCode =
      error.code || CONSTRAINT_TO_CODE[error.constraint] || ErrorCode.REQUEST_VALIDATION_FAILED;

    const validationError = new ValidationError(
      error.message || 'Invalid backtest configuration',
      finalCode,
      {
        field: error.field,
        details: error.details,
      }
    );

    next(validationError);
  }
}

/**
 * Helper to extract validated request from Express context
 *
 * @param req Express Request
 * @returns Validated ApiBacktestRequest
 * @throws Error if validation middleware not called or validation failed
 */
export function getValidatedBacktestRequest(req: any) {
  const validated = req.validatedBacktestRequest;
  if (!validated) {
    throw new Error('Validation middleware must be called first');
  }
  return validated;
}
