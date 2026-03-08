/**
 * Health Routes (T040)
 *
 * HTTP endpoint:
 * - GET /health - System health status
 */

import { Router, Request, Response } from 'express';
import { HealthMonitor } from '../services/HealthMonitor';

/**
 * Create health router
 */
export function createHealthRouter(healthMonitor: HealthMonitor): Router {
  const router = Router();

  /**
   * GET /health
   * Returns current system health status
   *
   * Status codes:
   * - 200: healthy or degraded
   * - 503: unhealthy
   */
  router.get('/health', async (_req: Request, res: Response) => {
    const health = await healthMonitor.getStatus();

    // Use 503 Service Unavailable for unhealthy status
    const statusCode = health.status === 'unhealthy' ? 503 : 200;

    res.status(statusCode).json(health);
  });

  return router;
}
