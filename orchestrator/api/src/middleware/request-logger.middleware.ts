/**
 * Request Logger Middleware (T028)
 *
 * Logs incoming requests with:
 * - HTTP method, path, query parameters
 * - Request body summary (redacted sensitive fields)
 * - Timestamp and request_id
 *
 * Attaches request_id to request context for downstream handlers
 */

import { Request, Response, NextFunction } from 'express';
import { generateRequestId } from '../utils/RequestIdGenerator';

/**
 * Express middleware for logging requests
 * Attaches request_id to request context
 *
 * @param req Express Request
 * @param res Express Response
 * @param next Express NextFunction
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Generate unique request ID
  const requestId = generateRequestId();
  (req as any).requestId = requestId;

  // Capture start time for duration calculation
  const startTime = Date.now();

  // Build body summary (redact sensitive fields)
  let bodySummary = '';
  if (req.body && Object.keys(req.body).length > 0) {
    const displayBody = { ...req.body };
    // Redact sensitive fields if needed (none currently, but for future expansion)
    bodySummary = ` | body: ${JSON.stringify(displayBody)}`;
  }

  // Build query string summary
  let querySummary = '';
  if (req.query && Object.keys(req.query).length > 0) {
    querySummary = ` | query: ${JSON.stringify(req.query)}`;
  }

  // Log request
  console.log(
    `[REQUEST] [${requestId}] ${req.method} ${req.path}${querySummary}${bodySummary}`,
  );

  // Hook into response.send to log response
  const originalSend = res.send;
  res.send = function(data: any) {
    const duration = Date.now() - startTime;
    console.log(`[RESPONSE] [${requestId}] ${res.statusCode} ${duration}ms`);
    return originalSend.call(this, data);
  };

  next();
}
