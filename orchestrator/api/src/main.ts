/**
 * Server Entry Point (T042)
 *
 * Initializes all services and starts HTTP server
 * Implements graceful shutdown on SIGTERM/SIGINT
 *
 * Environment variables:
 * - PORT: HTTP server port (default 3000)
 * - CORE_ENGINE_BINARY_PATH: Path to Core Engine binary
 * - STORAGE_PATH: Directory for result storage (default ./storage)
 * - RESULTS_TTL_DAYS: Result time-to-live in days (default 7)
 * - MAX_WORKERS: Max concurrent backtest workers (default cpu count)
 */

import http from 'http';
import { createApp } from './app.js';
import { ResultStore } from './services/ResultStore.js';
import { ProcessManager } from './services/ProcessManager.js';
import { BacktestService } from './services/BacktestService.js';
import { ResultAggregator } from './services/ResultAggregator.js';
import { IdempotencyCache } from './services/IdempotencyCache.js';
import { HealthMonitor } from './services/HealthMonitor.js';
import { ResultCleanupJob } from './jobs/ResultCleanupJob.js';
import { MarketDataResolver } from './services/MarketDataResolver.js';

/**
 * Main server initialization and startup
 */
async function main(): Promise<void> {
  try {
    // Read configuration from environment
    const port = parseInt(process.env.PORT || '4000', 10);
    const coreEngineBinaryPath = process.env.CORE_ENGINE_BINARY_PATH || './core-engine';
    const storagePath = process.env.STORAGE_PATH || './storage';
    const resultsTtlDays = parseInt(process.env.RESULTS_TTL_DAYS || '7', 10);
    const maxWorkers = parseInt(process.env.MAX_WORKERS || '0', 10); // 0 = auto-detect
    const marketDataDir = process.env.MARKET_DATA_DIR || './data/market';

    console.log('[main] Initializing API server...');
    console.log(`  - Port: ${port}`);
    console.log(`  - Core Engine: ${coreEngineBinaryPath}`);
    console.log(`  - Storage: ${storagePath}`);
    console.log(`  - TTL: ${resultsTtlDays} days`);

    // Initialize services in order

    // 1. Result storage
    const resultStore = new ResultStore(storagePath, resultsTtlDays);
    await resultStore.initialize();
    console.log('[main] ✓ ResultStore initialized');

    // 2. Process manager (worker pool)
    const processManager = new ProcessManager(maxWorkers);
    console.log('[main] ✓ ProcessManager initialized');

    // 3. Backtest service
    const backtestService = new BacktestService(coreEngineBinaryPath);
    console.log('[main] ✓ BacktestService initialized');

    // 4. Result aggregator
    const resultAggregator = new ResultAggregator();
    console.log('[main] ✓ ResultAggregator initialized');

    // 5. Idempotency cache
    const idempotencyCache = new IdempotencyCache(resultsTtlDays);
    console.log('[main] ✓ IdempotencyCache initialized');

    // 6. Health monitor
    const healthMonitor = new HealthMonitor(processManager, coreEngineBinaryPath);
    console.log('[main] ✓ HealthMonitor initialized');

    // 7. Market data resolver
    const marketDataResolver = new MarketDataResolver(marketDataDir);
    console.log(`[main] ✓ MarketDataResolver initialized (dir: ${marketDataDir})`);

    // 7. Cleanup job (runs daily at midnight UTC)
    const cleanupJob = new ResultCleanupJob(resultStore, 0);
    cleanupJob.start();
    console.log('[main] ✓ ResultCleanupJob scheduled');

    // Create Express app with all services
    const app = createApp({
      resultStore,
      processManager,
      backtestService,
      resultAggregator,
      idempotencyCache,
      healthMonitor,
      coreEngineBinaryPath,
      marketDataResolver,
    });

    // Create HTTP server
    const server = http.createServer(app);

    // Start listening
    server.listen(port, () => {
      console.log(`[main] 🚀 Server listening on http://localhost:${port}`);
      console.log('[main] Ready to receive backtest requests');
    });

    // Graceful shutdown handler
    let isShuttingDown = false;

    const gracefulShutdown = async (signal: string) => {
      if (isShuttingDown) {
        console.log(`[main] Shutdown already in progress`);
        return;
      }

      isShuttingDown = true;
      console.log(`[main] Received ${signal}, starting graceful shutdown...`);

      // 1. Stop listening for new requests (but allow in-flight requests to complete)
      server.close(() => {
        console.log('[main] HTTP server closed');
      });

      // 2. Stop accepting new work
      console.log('[main] Draining worker queue...');
      const maxWaitTime = 30000; // 30 second max wait
      const startTime = Date.now();
      while (processManager.getMetrics().queue_depth > 0) {
        if (Date.now() - startTime > maxWaitTime) {
          console.warn('[main] Queue drain timeout, forcing exit');
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // 3. Stop background jobs
      cleanupJob.stop();

      console.log('[main] Graceful shutdown complete');
      process.exit(0);
    };

    // Register shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      console.error('[main] Uncaught exception:', error);
      process.exit(1);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (reason: any) => {
      console.error('[main] Unhandled rejection:', reason);
      process.exit(1);
    });
  } catch (error: any) {
    console.error('[main] Fatal error during initialization:', error);
    process.exit(1);
  }
}

// Start server
main().catch((error) => {
  console.error('[main] Failed to start:', error);
  process.exit(1);
});
