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
import { validateBacktestRequest } from '../types/configuration';
import { ValidationError, ErrorCode } from '../types/errors';

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
    // Convert validation errors to structured ValidationError
    const validationError = new ValidationError(
      error.message || 'Invalid backtest configuration',
      ErrorCode.REQUEST_VALIDATION_FAILED,
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
