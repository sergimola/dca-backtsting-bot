/**
 * Backtest Routes (T014, T017, T018, T021)
 *
 * HTTP endpoints:
 * - POST /backtests          - Submit async backtest job → 202 Accepted
 * - GET /backtests/:id/status - Lightweight status poll
 * - GET /backtests/:id      - Full result (including trades + safety_orders)
 * - GET /backtests          - List all jobs (trades/safety_orders excluded)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { BacktestJobRepository, type BacktestRow } from '../services/BacktestJobRepository.js';
import { getValidatedBacktestRequest, validationMiddleware } from '../middleware/validation.middleware.js';
import { isValidUuid } from '../utils/RequestIdGenerator.js';

/**
 * Transform a database row into the UI BacktestResults interface.
 * For list rows (no trades/safetyOrders), those fields default to [].
 */
function mapJobToResponse(job: BacktestRow | Omit<BacktestRow, 'trades' | 'safetyOrders'>) {
  const full = job as BacktestRow;
  return {
    backtestId:       job.id,
    status:           job.status,
    config:           job.config,
    createdAt:        job.createdAt,
    pnlSummary: {
      roi:         job.summary?.roi         ?? 0,
      maxDrawdown: job.summary?.maxDrawdown  ?? 0,
      totalFees:   job.summary?.totalFees    ?? 0,
    },
    tradeEvents:      full.trades      ?? [],
    safetyOrderUsage: full.safetyOrders ?? [],
    executionTimeMs:  job.executionTimeMs  ?? 0,
  };
}

/**
 * Create backtest router.
 */
export function createBacktestRouter(repo: BacktestJobRepository): Router {
  const router = Router();

  // ---------------------------------------------------------------------------
  // POST /backtests — submit async job, return 202 immediately
  // ---------------------------------------------------------------------------
  router.post('/backtests', validationMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = getValidatedBacktestRequest(req);
      const job = await repo.create(config);

      res.status(202).json({
        backtestId: job.id, // Change job_id to backtestId
        status:     'pending',
        message:    `Backtest job accepted. Poll GET /backtests/${job.id}/status for progress.`,
      });
    } catch (error: any) {
      return next(error);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /backtests/:id/status — lightweight polling (no JSONB blobs)
  // ---------------------------------------------------------------------------
  router.get('/backtests/:id/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] as string;

      if (!isValidUuid(id)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_TYPE_ERROR',
            http_status: 400,
            message: 'id must be a valid UUID',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const job = await repo.findById(id);
      if (!job) {
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            http_status: 404,
            message: `Backtest job not found: ${id}`,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      res.status(200).json({
        id:            job.id,
        status:        job.status,
        error_message: job.errorMessage ?? null,
      });
    } catch (error: any) {
      return next(error);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /backtests/:id — full result row (includes trades + safety_orders)
  // ---------------------------------------------------------------------------
  router.get(['/backtests/:id', '/backtests/:id/results'], async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] as string;

      if (!isValidUuid(id)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_TYPE_ERROR',
            http_status: 400,
            message: 'id must be a valid UUID',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const job = await repo.findById(id);
      if (!job) {
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            http_status: 404,
            message: `Backtest job not found: ${id}`,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      res.status(200).json(mapJobToResponse(job));
    } catch (error: any) {
      return next(error);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /backtests — list (trades/safety_orders omitted, constitution § select omission)
  // ---------------------------------------------------------------------------
  router.get('/backtests', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit  = Math.min(200, Math.max(1, parseInt(req.query['limit']  as string) || 50));
      const offset = Math.max(0,                parseInt(req.query['offset'] as string) || 0);

      const jobs = await repo.listWithoutBlobs({ limit, offset });

      const response = jobs.map(job => mapJobToResponse(job));

      res.status(200).json(response);
    } catch (error: any) {
      return next(error);
    }
  });

  return router;
}
