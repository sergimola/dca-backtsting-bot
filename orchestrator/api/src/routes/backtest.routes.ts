/**
 * Backtest Routes (T033, T035, T037)
 *
 * HTTP endpoints:
 * - POST /backtest - Submit and execute backtest
 * - GET /backtest/:request_id - Retrieve result by ID
 * - GET /backtest - Query results by date range
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ResultStore } from '../services/ResultStore.js';
import { ProcessManager } from '../services/ProcessManager.js';
import { BacktestService, BacktestExecutionResult } from '../services/BacktestService.js';
import { ResultAggregator } from '../services/ResultAggregator.js';
import { IdempotencyCache } from '../services/IdempotencyCache.js';
import { getValidatedBacktestRequest, validationMiddleware } from '../middleware/validation.middleware.js';
import { MarketDataResolver, SameMonthGuardError, MarketDataNotFoundError } from '../services/MarketDataResolver.js';
import { validateIdempotencyKey, isValidUuid } from '../utils/RequestIdGenerator.js';
import { BacktestResult, TradeEvent, PnlSummary } from '../types/index.js';
import { StorageError } from '../types/errors.js';

/**
 * Maps Go engine position state strings to the PositionState status field.
 * Go states: Idle, Active, SafetyOrderActive, TakeProfitPending, Closed, Liquidated
 */
function mapGoStateToStatus(state: string | undefined): 'OPEN' | 'CLOSED' | 'LIQUIDATED' {
  if (!state) return 'CLOSED';
  if (state === 'Liquidated') return 'LIQUIDATED';
  if (state === 'Idle' || state === 'Closed') return 'CLOSED';
  return 'OPEN';
}

/**
 * Create backtest router with wired services
 */
export function createBacktestRouter(
  resultStore: ResultStore,
  processManager: ProcessManager,
  backtestService: BacktestService,
  resultAggregator: ResultAggregator,
  idempotencyCache: IdempotencyCache,
  resolver: MarketDataResolver,
): Router {
  const router = Router();

  /**
   * POST /backtest
   * Submit backtest configuration and receive results
   *
   * Flow:
   * 1. Validation middleware has already validated request
   * 2. Check idempotency_key cache (if provided)
   * 3. Queue in ProcessManager
   * 4. Poll for completion
   * 5. On completion: BacktestService executes, ResultAggregator computes PnL, ResultStore saves
   * 6. Return HTTP 200 with BacktestResult
   */
  router.post('/backtest', validationMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = (req as any).requestId;
      const backtestReq = getValidatedBacktestRequest(req);
      const idempotencyKey = validateIdempotencyKey(req.body.idempotency_key);

      // Check idempotency cache
      if (idempotencyKey) {
        const cached = idempotencyCache.get(idempotencyKey);
        if (cached) {
          console.log(`[${requestId}] Idempotency hit - returning cached result`);
          res.status(200).json(cached);
          return;
        }
      }

      // Resolve CSV path before enqueueing so missing/invalid data returns 400/404 synchronously
      let csvPath = '';
      try {
        csvPath = resolver.resolve(
          backtestReq.trading_pair,
          backtestReq.start_date,
          backtestReq.end_date,
        );
      } catch (resolveError: any) {
        if (resolveError instanceof SameMonthGuardError) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_OUT_OF_BOUNDS',
              http_status: 400,
              message: resolveError.message,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }
        if (resolveError instanceof MarketDataNotFoundError) {
          res.status(404).json({
            error: {
              code: 'CSV_FILE_NOT_FOUND',
              http_status: 404,
              message: resolveError.message,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }
        throw resolveError;
      }

      // Generate unique request ID for backtest
      const backtestRequestId = crypto.randomUUID();

      // Capture execution result via closure so the poll loop can access it
      let execResult: BacktestExecutionResult | null = null;

      // Queue backtest — the callback runs the Go binary
      console.log(`[${requestId}] Enqueuing backtest with ID ${backtestRequestId}`);
      await processManager.enqueue(backtestRequestId, async () => {
        execResult = await backtestService.execute({ ...backtestReq, market_data_csv_path: csvPath });
      });

      // Poll for completion (max 35 seconds)
      const maxPollTime = 35000;
      const startTime = Date.now();
      let result: BacktestResult | null = null;

      while (Date.now() - startTime < maxPollTime) {
        const statusResult = await processManager.getStatus(backtestRequestId);
        const statusValue = statusResult || 'pending';

        if (statusValue === 'complete') {
          const completedResult = execResult as unknown as BacktestExecutionResult;

          // Aggregate events into PnlSummary.
          // Use aggregateGoEvents when finalPosition is set (real Go engine, new format).
          // Fall back to aggregateEvents for old ndjson format (mock engine / tests).
          let pnlSummary: PnlSummary;
          if (completedResult.finalPosition !== null) {
            // Real Go engine: pass account_balance from final_position as the ROI denominator
            const accountBalance: string =
              completedResult.finalPosition?.account_balance ||
              completedResult.finalPosition?.total_invested ||
              '0';
            pnlSummary = await resultAggregator.aggregateGoEvents(completedResult.events, accountBalance);
          } else {
            pnlSummary = await resultAggregator.aggregateEvents(completedResult.events as TradeEvent[]);
          }

          // Build final_position.
          // If Go engine returned live position state, map it to the PositionState schema.
          // Otherwise fall back to the last event's position_state (old mock format).
          const fp = completedResult.finalPosition;
          const finalPosition = fp ? {
            quantity:              fp.position_quantity     ?? '0.00000000',
            average_cost:          fp.average_entry_price   ?? '0.00000000',
            total_invested:        fp.account_balance       ?? '0.00000000',
            leverage_level:        '1.00000000',
            status:                mapGoStateToStatus(fp.state),
            last_update_timestamp: 0,
          } : (completedResult.events[completedResult.events.length - 1] as any)?.position_state ?? {
            quantity: '0.00000000',
            average_cost: '0.00000000',
            total_invested: '0.00000000',
            leverage_level: '0.00000000',
            status: 'CLOSED',
            last_update_timestamp: 0,
          };

          // Build BacktestResult
          result = {
            request_id: backtestRequestId,
            status: 'success',
            events: completedResult.events,
            final_position: finalPosition,
            pnl_summary: pnlSummary,
            execution_time_ms: completedResult.executionTimeMs,
            timestamp: new Date().toISOString(),
          };

          // Save to ResultStore
          await resultStore.save(result);

          // Cache if idempotency_key provided
          if (idempotencyKey) {
            idempotencyCache.set(idempotencyKey, backtestRequestId, result);
          }

          res.status(200).json(result);
          return;
        } else if (statusValue === 'failed') {
          // Execution failed
          const errorMessage = 'Backtest execution failed';
          
          const errorResult: BacktestResult = {
            request_id: backtestRequestId,
            status: 'failed',
            events: [],
            final_position: {
              quantity: '0.00000000',
              average_cost: '0.00000000',
              total_invested: '0.00000000',
              leverage_level: '0.00000000',
              status: 'CLOSED',
              last_update_timestamp: 0,
            },
            pnl_summary: {
              total_pnl: '0.00000000',
              entry_fee: '0.00000000',
              trading_fees: '0.00000000',
              total_fees: '0.00000000',
              roi_percent: '0.00',
              total_fills: 0,
              realized_pnl: '0.00000000',
              safety_order_usage_counts: {},
            },
            execution_time_ms: 0,
            timestamp: new Date().toISOString(),
            error: {
              code: 'BACKTEST_FAILED',
              message: errorMessage,
            },
          };

          await resultStore.save(errorResult);
          res.status(500).json(errorResult);
          return;
        }

        // Still pending, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Timeout waiting for completion
      const timeoutError: BacktestResult = {
        request_id: backtestRequestId,
        status: 'failed',
        events: [],
        final_position: {
          quantity: '0.00000000',
          average_cost: '0.00000000',
          total_invested: '0.00000000',
          leverage_level: '0.00000000',
          status: 'CLOSED',
          last_update_timestamp: 0,
        },
        pnl_summary: {
          total_pnl: '0.00000000',
          entry_fee: '0.00000000',
          trading_fees: '0.00000000',
          total_fees: '0.00000000',
          roi_percent: '0.00',
          total_fills: 0,
          realized_pnl: '0.00000000',
          safety_order_usage_counts: {},
        },
        execution_time_ms: maxPollTime,
        timestamp: new Date().toISOString(),
        error: {
          code: 'EXECUTION_TIMEOUT',
          message: 'Backtest execution exceeded 35-second polling timeout',
        },
      };

      return res.status(504).json(timeoutError);
    } catch (error: any) {
      return next(error);
    }
  });

  /**
   * GET /backtest/:request_id
   * Retrieve backtest result by ID
   */
  router.get('/backtest/:request_id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { request_id } = req.params;

      // request_id from params is always a string (not an array)
      const requestIdStr = Array.isArray(request_id) ? request_id[0] : request_id;

      // Validate request_id is UUID
      if (!isValidUuid(requestIdStr)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_TYPE_ERROR',
            http_status: 400,
            message: 'request_id must be a valid UUID',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      // Retrieve from ResultStore
      const result = await resultStore.retrieve(requestIdStr);
      res.status(200).json(result);
    } catch (error: any) {
      // Return 404 for not-found / expired results instead of generic 500
      if (error instanceof StorageError && (error.message.includes('not found') || error.message.includes('expired'))) {
        return res.status(404).json({
          error: {
            code: 'RESULT_NOT_FOUND',
            http_status: 404,
            message: 'Backtest result not found',
            timestamp: new Date().toISOString(),
          },
        });
      }
      return next(error);
    }
  });

  /**
   * GET /backtest
   * Query results by date range with pagination
   *
   * Query params:
   * - from: ISO date string (required)
   * - to: ISO date string (required)
   * - status: 'success' | 'failed' | 'all' (optional, default 'all')
   * - page: page number 0-indexed (optional, default 0)
   * - limit: results per page (optional, default 50)
   */
  router.get('/backtest', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from, to, status = 'all', page = '0', limit = '50' } = req.query;

      // Validate required params
      if (!from || !to) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_MISSING_FIELD',
            http_status: 400,
            message: 'Missing required query parameters: from, to',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Validate date format (new Date("invalid") does not throw — use isNaN)
      if (isNaN(new Date(from as string).getTime()) || isNaN(new Date(to as string).getTime())) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_TYPE_ERROR',
            http_status: 400,
            message: 'Date parameters must be valid ISO 8601 strings',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Validate from <= to
      if (new Date(from as string) > new Date(to as string)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_OUT_OF_BOUNDS',
            http_status: 400,
            message: 'from date must be <= to date',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Validate page and limit
      const pageNum = Math.max(0, parseInt(page as string) || 0);
      const pageSize = Math.min(200, Math.max(1, parseInt(limit as string) || 50));

      // Query
      const queryResult = await resultStore.queryByDateRange(
        from as string,
        to as string,
        (status === 'all' || status === 'success' || status === 'failed' ? status : 'all') as any,
        pageNum,
        pageSize,
      );

      // Transform pagination to match API contract
      const pageCount = Math.ceil(queryResult.pagination.total_count / pageSize);
      return res.status(200).json({
        results: queryResult.results,
        pagination: {
          page: pageNum,
          limit: pageSize,
          total: queryResult.pagination.total_count,
          page_count: pageCount,
        },
      });
    } catch (error: any) {
      return next(error);
    }
  });

  return router;
}
