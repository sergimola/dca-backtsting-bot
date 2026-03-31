/**
 * Server Entry Point
 *
 * Initializes all services, runs DB migrations, starts Background Worker, and starts HTTP server.
 * Implements graceful shutdown on SIGTERM/SIGINT.
 *
 * Environment variables:
 * - PORT: HTTP server port (default 4000)
 * - CORE_ENGINE_BINARY_PATH: Path to Core Engine binary
 * - DATABASE_URL: Postgres connection string
 */

import 'dotenv/config';
import http from 'http';
import { createApp } from './app.js';
import { BacktestService } from './services/BacktestService.js';
import { HealthMonitor } from './services/HealthMonitor.js';
import { GapResolver } from './services/GapResolver.js';
import { BinanceDownloader } from './services/BinanceDownloader.js';
import { ClickHouseWriter } from './services/ClickHouseWriter.js';
import { chClient, database, pingClickHouse, initClickHouseSchema } from './services/ClickHouseClient.js';
import { runMigrations } from './db/migrate.js';
import { BacktestJobRepository } from './services/BacktestJobRepository.js';
import { SyncLedgerRepository } from './services/SyncLedgerRepository.js';
import { BackgroundWorker } from './services/BackgroundWorker.js';
import { WideEventIngester } from './services/WideEventIngester.js';

/**
 * Main server initialization and startup
 */
async function main(): Promise<void> {
  try {
    const port                 = parseInt(process.env.PORT || '4000', 10);
    const coreEngineBinaryPath = process.env.CORE_ENGINE_BINARY_PATH || './core-engine';

    console.log('[main] Initializing API server...');
    console.log(`  - Port: ${port}`);
    console.log(`  - Core Engine: ${coreEngineBinaryPath}`);
    console.log(`  - ClickHouse: ${process.env.CLICKHOUSE_HOST ?? 'localhost'}:${process.env.CLICKHOUSE_PORT ?? '8123'}`);
    console.log(`  - Postgres: ${process.env.DATABASE_URL ?? '(not set)'}`);

    // 1. Run Drizzle migrations (creates tables if they don't exist)
    await runMigrations();
    console.log('[main] ✓ Postgres migrations complete');

    // 2. Verify ClickHouse connectivity & Schema
    await pingClickHouse();
    await initClickHouseSchema(); // <--- Add this line
    console.log('[main] ✓ ClickHouse connection and schema verified');

    // 3. Build repositories
    const backtestJobRepository = new BacktestJobRepository();
    const syncLedgerRepository  = new SyncLedgerRepository();
    console.log('[main] ✓ Repositories initialized');

    // 4. Build background services
    const backtestService = new BacktestService(coreEngineBinaryPath);
    const chWriter    = new ClickHouseWriter();
    const gapResolver = new GapResolver();
    const downloader  = new BinanceDownloader(chWriter);
    console.log('[main] ✓ BacktestService + GapResolver + BinanceDownloader initialized');

    // 5. Health monitor
    const healthMonitor  = new HealthMonitor(coreEngineBinaryPath);
    console.log('[main] ✓ HealthMonitor initialized');

    // 6. Create Express app (routes only need repositories + healthMonitor)
    const app = createApp({
      backtestJobRepository,
      syncLedgerRepository,
      healthMonitor,
    });

    // 7. Start background worker (BEFORE server.listen so worker is ready)
    const wideEventIngester = new WideEventIngester(chClient, database);
    const worker = new BackgroundWorker(
      backtestJobRepository,
      backtestService,
      gapResolver,
      downloader,
      {},
      wideEventIngester,
    );
    worker.start();
    console.log('[main] ✓ BackgroundWorker started');

    // 8. Start HTTP server
    const server = http.createServer(app);
    server.listen(port, () => {
      console.log(`[main] 🚀 Server listening on http://localhost:${port}`);
    });

    // Graceful shutdown
    let isShuttingDown = false;

    const gracefulShutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log(`[main] Received ${signal}, shutting down...`);

      worker.stop();
      server.close(() => {
        console.log('[main] HTTP server closed');
        process.exit(0);
      });

      // Force exit after 30 seconds
      setTimeout(() => process.exit(1), 30_000).unref();
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

    process.on('uncaughtException',   (err) => { console.error('[main] Uncaught exception:', err);   process.exit(1); });
    process.on('unhandledRejection', (reason) => { console.error('[main] Unhandled rejection:', reason); process.exit(1); });
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
