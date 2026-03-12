/**
 * Validation Middleware (T025)
 *
 * Validates incoming BacktestRequest against schema:
 * - All required fields present
 * - Decimal.js precision (no floats, 8 decimal max)
 * - Bounds validation (entry_price > 0, margin_ratio ∈ [0,1), etc.)
 * - Sequences length matches amounts length
 *
 * On validation error: passes ValidationError to next(err)
 */

import { Request, Response, NextFunction } from 'express';
import { validateBacktestRequest } from '../types/configuration.js';
import { ValidationError, ErrorCode } from '../types/errors.js';

/**
 * Express middleware for validating BacktestRequest
 *
 * @param req Express Request with JSON body
 * @param res Express Response
 * @param next Express NextFunction
 */
export function validationMiddleware(req: Request, _res: Response, next: NextFunction): void {
  try {
    // Validate body against BacktestRequest schema
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
 * @returns Validated BacktestRequest
 * @throws Error if validation middleware not called or validation failed
 */
export function getValidatedBacktestRequest(req: any) {
  const validated = req.validatedBacktestRequest;
  if (!validated) {
    throw new Error('Validation middleware must be called first');
  }
  return validated;
}
