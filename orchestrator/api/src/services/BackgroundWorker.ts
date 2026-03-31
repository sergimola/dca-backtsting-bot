/**
 * BackgroundWorker (T016)
 *
 * Polls the `backtests` table every 2 seconds and executes pending jobs.
 *
 * Constitution requirements enforced here:
 * - spawn() NEVER exec(): actual process spawning is delegated to BacktestService
 *   which already uses child_process.spawn() internally.
 * - isProcessing mutex: ensures only one job runs at a time per worker instance.
 * - FOR UPDATE SKIP LOCKED: implemented in BacktestJobRepository.claimNext()
 * - HTTP 202 Detachment: the worker runs independently of the HTTP request lifecycle.
 *
 * Internal flow per tick:
 *   1. Guard: if isProcessing → return (no overlap)
 *   2. Claim: UPDATE backtests SET status='running' WHERE status='pending' FOR UPDATE SKIP LOCKED
 *   3. Prepare: GapResolver.check() → BinanceDownloader.downloadAndStore() if needed
 *   4. Execute: BacktestService.execute() (uses spawn() internally)
 *   5. Aggregate: ResultAggregator.aggregateGoEvents()
 *   6. Persist: markCompleted() or markFailed()
 *   7. Release: isProcessing = false
 */

import { BacktestJobRepository, type BacktestRow } from './BacktestJobRepository.js';
import { BacktestService } from './BacktestService.js';
import { GapResolver } from './GapResolver.js';
import { BinanceDownloader } from './BinanceDownloader.js';
import { WideEventIngester } from './WideEventIngester.js';
import type { ProgressLine, SafetyOrderUsageEntry } from '../types/index.js';
import * as path from 'path';

export interface BackgroundWorkerOptions {
  intervalMs?: number;
}

export class BackgroundWorker {
  private readonly repo:        BacktestJobRepository;
  private readonly service:     BacktestService;
  private readonly gapResolver: GapResolver;
  private readonly downloader:  BinanceDownloader;
  private readonly ingester?:   WideEventIngester;
  private readonly intervalMs:  number;

  private isProcessing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    repo:        BacktestJobRepository,
    service:     BacktestService,
    gapResolver: GapResolver,
    downloader:  BinanceDownloader,
    options:     BackgroundWorkerOptions = {},
    ingester?:   WideEventIngester,
  ) {
    this.repo        = repo;
    this.service     = service;
    this.gapResolver = gapResolver;
    this.downloader  = downloader;
    this.ingester    = ingester;
    this.intervalMs  = options.intervalMs ?? 2000;
  }

  /** Start polling. Idempotent — safe to call multiple times. */
  start(): void {
    if (this.timer) return;
    console.log(`[BackgroundWorker] Started (interval: ${this.intervalMs}ms)`);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // Run first tick immediately without waiting for the first interval
    this.tick();
  }

  /** Stop polling gracefully. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[BackgroundWorker] Stopped');
    }
  }

  /** Single tick — returns immediately if already processing. */
  private async tick(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      const job = await this.repo.claimNext();
      if (!job) return; // nothing pending

      await this.processJob(job);
    } catch (err) {
      console.error('[BackgroundWorker] Unhandled tick error:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  /** Execute one job end-to-end, updating DB on success or failure. */
  private async processJob(job: BacktestRow): Promise<void> {
    const { id, config } = job;
    const claimStartTime = Date.now();
    console.log(`[BackgroundWorker] Processing job ${id} (${config.trading_pair} ${config.start_date}→${config.end_date})`);

    try {
      // Step 1: Gap detection — check if ClickHouse already has the required candles
      const symbol         = config.trading_pair.replace('/', '').toUpperCase();
      const start          = new Date(config.start_date);
      const end            = new Date(config.end_date);
      const gapResult      = await this.gapResolver.check(symbol, start, end);

      if (gapResult.hasGap) {
        const downloadStart = gapResult.gapStart ?? start;
        console.log(`[BackgroundWorker] Gap detected for job ${id}. Downloading from Binance (${downloadStart.toISOString()} → ${end.toISOString()})...`);
        await this.downloader.downloadAndStore(config.trading_pair, downloadStart, end);
      }

      // Step 2: Run the Go engine (BacktestService uses spawn() internally — never exec())
      const chAddr    = `${process.env.CLICKHOUSE_HOST ?? 'localhost'}:${process.env.CLICKHOUSE_NATIVE_PORT ?? '9000'}`;
      const chDb      = process.env.CLICKHOUSE_DATABASE ?? 'data';
      const chUser    = process.env.CLICKHOUSE_USER    ?? 'default';
      const chPassword = process.env.CLICKHOUSE_PASSWORD ?? '';

      // T031: progressHandler updates DB progress on each tick (fire-and-forget)
      const execResult = await this.service.execute(
        {
          ...config,
          clickhouse_addr:     chAddr,
          clickhouse_db:       chDb,
          clickhouse_user:     chUser,
          clickhouse_password: chPassword,
        },
        {
          progressHandler: async (line: ProgressLine) => {
            await this.repo.updateProgress(id, line.percent, line);
          },
        },
      );

      // T032: Use engine result directly — no aggregation pass needed (done in Go)
      const safetyOrders: SafetyOrderUsageEntry[] = execResult.safetyOrderUsage;

      // T031: Ingest wide event file into ClickHouse if the engine produced one
      if (this.ingester && execResult.wideEventFile) {
        try {
          const runId = path.basename(execResult.wideEventFile, '.jsonl');
          const ingestResult = await this.ingester.ingest(runId, execResult.wideEventFile);
          console.log(`[BackgroundWorker] Wide events ingested: ${ingestResult.rowsInserted} rows in ${ingestResult.durationMs}ms`);
        } catch (err) {
          console.error(`[BackgroundWorker] Wide event ingestion failed for job ${id}:`, err);
        }
      }

      await this.repo.markCompleted(
        id,
        execResult.pnlSummary,
        execResult.tradeEvents,
        safetyOrders,
        Date.now() - claimStartTime,
      );

      console.log(`[BackgroundWorker] Job ${id} completed in ${Date.now() - claimStartTime}ms`);
    } catch (err: any) {
      const errorMessage = err?.stderr ?? err?.message ?? String(err);
      console.error(`[BackgroundWorker] Job ${id} failed:`, errorMessage);
      await this.repo.markFailed(id, errorMessage);
    }
  }
}
