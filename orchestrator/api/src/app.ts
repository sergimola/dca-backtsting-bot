/**
 * Express App Factory (T041)
 *
 * Creates and configures Express application with:
 * - Middleware stack: request logger -> validation -> routes -> error handler
 * - Routes: /backtest (backtest operations), /health (system health)
 */

import express, { Express } from 'express';
import { ResultStore } from './services/ResultStore';
import { ProcessManager } from './services/ProcessManager';
import { BacktestService } from './services/BacktestService';
import { ResultAggregator } from './services/ResultAggregator';
import { IdempotencyCache } from './services/IdempotencyCache';
import { HealthMonitor } from './services/HealthMonitor';
import { requestLoggerMiddleware } from './middleware/request-logger.middleware';
import { errorHandlerMiddleware } from './middleware/error-handler.middleware';
import { createBacktestRouter } from './routes/backtest.routes';
import { createHealthRouter } from './routes/health.routes';

/**
 * Create and configure Express app
 *
 * @param services Configured service instances
 * @returns Configured Express application
 */
export interface AppServices {
  resultStore: ResultStore;
  processManager: ProcessManager;
  backtestService: BacktestService;
  resultAggregator: ResultAggregator;
  idempotencyCache: IdempotencyCache;
  healthMonitor: HealthMonitor;
  coreEngineBinaryPath: string;
}

export function createApp(services: AppServices): Express {
  const app = express();

  // Middleware stack (in order)

  // 1. Body parser
  app.use(express.json({ limit: '10mb' }));

  // 2. Request logger (attaches request_id)
  app.use(requestLoggerMiddleware);

  // Note: validationMiddleware is applied per-route in backtest.routes.ts

  // 4. Mount routes
  app.use('/', createBacktestRouter(
    services.resultStore,
    services.processManager,
    services.backtestService,
    services.resultAggregator,
    services.idempotencyCache,
  ));

  app.use('/', createHealthRouter(services.healthMonitor));

  // 5. 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        http_status: 404,
        message: `Endpoint not found: ${req.method} ${req.path}`,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 6. Error handler (MUST be last)
  app.use(errorHandlerMiddleware);

  return app;
}
