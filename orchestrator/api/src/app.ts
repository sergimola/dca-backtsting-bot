/**
 * Express App Factory (T041)
 *
 * Creates and configures Express application with:
 * - Middleware stack: request logger -> validation -> routes -> error handler
 * - Routes: /backtest (backtest operations), /health (system health)
 */

import express, { Express } from 'express';
import cors from 'cors';
import { HealthMonitor } from './services/HealthMonitor.js';
import { BacktestJobRepository } from './services/BacktestJobRepository.js';
import { SyncLedgerRepository } from './services/SyncLedgerRepository.js';
import { requestLoggerMiddleware } from './middleware/request-logger.middleware.js';
import { errorHandlerMiddleware } from './middleware/error-handler.middleware.js';
import { createBacktestRouter } from './routes/backtest.routes.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createOptimizerRouter } from './routes/optimizer.routes.js';
import { SweepService } from './services/SweepService.js';
import { OptimizerSessionStore } from './services/OptimizerSessionStore.js';
import { SweepPersistenceService } from './services/SweepPersistenceService.js';

/**
 * Create and configure Express app
 *
 * @param services Configured service instances
 * @returns Configured Express application
 */
export interface AppServices {
  backtestJobRepository: BacktestJobRepository;
  syncLedgerRepository: SyncLedgerRepository;
  healthMonitor: HealthMonitor;
}

export function createApp(services: AppServices): Express {
  const app = express();

  // Middleware stack (in order)

  // 1. CORS
  app.use(cors());

  // 2. Body parser
  app.use(express.json({ limit: '10mb' }));

  // 2. Request logger (attaches request_id)
  app.use(requestLoggerMiddleware);

  // Note: validationMiddleware is applied per-route in backtest.routes.ts

  // 4. Mount routes
  app.use('/', createBacktestRouter(services.backtestJobRepository));

  app.use('/', createHealthRouter(services.healthMonitor));

  // Optimizer routes (no DB; in-memory session store)
  const enginePath =
    process.env.ENGINE_PATH ||
    process.env.ENGINE_BINARY_PATH ||
    process.env.CORE_ENGINE_BINARY_PATH ||
    './core-engine';
  const sweepService = new SweepService(enginePath);
  const sessionStore = new OptimizerSessionStore();
  const sweepPersistence = new SweepPersistenceService();
  app.use('/optimizer', createOptimizerRouter(sweepService, sessionStore, sweepPersistence));

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
