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
import { ResultAggregator } from './ResultAggregator.js';
import { GapResolver } from './GapResolver.js';
import { BinanceDownloader } from './BinanceDownloader.js';
import type { StoredTradeEvent, StoredPnlSummary } from '../types/index.js';

// ---------------------------------------------------------------------------
// Event processing: raw Go engine events → frontend-compatible TradeEvent shape
// ---------------------------------------------------------------------------
const FILL_EVENT_TYPES = new Set(['PositionOpened', 'BuyOrderExecuted', 'PositionClosed']);
const EVENT_TYPE_LABEL: Record<string, string> = {
  PositionOpened:   'ENTRY',
  BuyOrderExecuted: 'SAFETY_ORDER',
  PositionClosed:   'EXIT',
};

/**
 * Convert raw Go engine events into the shape the frontend expects.
 * Assigns sequential trade IDs ("1", "2", "3", ...) per PositionOpened.
 * Patches PositionClosed.fee from the immediately following SellOrderExecuted.
 */
export function processGoEventsForFrontend(rawEvents: any[]): StoredTradeEvent[] {
  const result: StoredTradeEvent[] = [];
  let tradeCounter = 0;
  let currentTradeId = '0';
  let lastExitEvent: StoredTradeEvent | null = null;

  for (const e of rawEvents) {
    if (e.type === 'PositionOpened') {
      tradeCounter++;
      currentTradeId = String(tradeCounter);
    }

    if (e.type === 'SellOrderExecuted' && lastExitEvent !== null) {
      lastExitEvent.fee = parseFloat(e.data?.fee ?? '0');
      lastExitEvent = null;
      continue;
    }

    if (!FILL_EVENT_TYPES.has(e.type)) continue;

    const d: any   = e.data ?? {};
    const rawTs: string = e.timestamp ?? '';
    let price = 0, quantity = 0, balance = 0, fee = 0;

    switch (e.type as string) {
      case 'PositionOpened': {
        const entry = d.configured_orders?.[0] ?? {};
        const cost  = parseFloat(entry.amount ?? '0');
        price    = parseFloat(entry.price  ?? '0');
        quantity = cost / price || 0;
        balance  = cost;
        fee      = parseFloat(d.entry_fee ?? '0');
        break;
      }
      case 'BuyOrderExecuted': {
        const qty = parseFloat(d.base_size ?? '0');
        price    = parseFloat(d.price ?? '0');
        quantity = qty;
        balance  = price * quantity;
        fee      = parseFloat(d.fee   ?? '0');
        break;
      }
      case 'PositionClosed': {
        price    = parseFloat(d.closing_price ?? '0');
        quantity = parseFloat(d.size          ?? '0');
        balance  = parseFloat(d.profit        ?? '0');
        fee      = 0;
        break;
      }
    }

    const event: StoredTradeEvent = {
      timestamp:    rawTs ? new Date(rawTs).toLocaleString() : rawTs,
      rawTimestamp: rawTs,
      eventType:    EVENT_TYPE_LABEL[e.type as string] ?? e.type,
      price, quantity, balance,
      trade_id: currentTradeId,
      fee,
    };
    result.push(event);

    if (e.type === 'PositionClosed') lastExitEvent = event;
  }

  return result;
}

export interface BackgroundWorkerOptions {
  intervalMs?: number;
}

export class BackgroundWorker {
  private readonly repo:        BacktestJobRepository;
  private readonly service:     BacktestService;
  private readonly aggregator:  ResultAggregator;
  private readonly gapResolver: GapResolver;
  private readonly downloader:  BinanceDownloader;
  private readonly intervalMs:  number;

  private isProcessing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    repo:        BacktestJobRepository,
    service:     BacktestService,
    aggregator:  ResultAggregator,
    gapResolver: GapResolver,
    downloader:  BinanceDownloader,
    options:     BackgroundWorkerOptions = {},
  ) {
    this.repo        = repo;
    this.service     = service;
    this.aggregator  = aggregator;
    this.gapResolver = gapResolver;
    this.downloader  = downloader;
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
    console.log(`[BackgroundWorker] Processing job ${id} (${config.trading_pair} ${config.start_date}→${config.end_date})`);

    try {
      // Step 1: Gap detection — check if ClickHouse already has the required candles
      const symbol         = config.trading_pair.replace('/', '').toUpperCase();
      const start          = new Date(config.start_date);
      const end            = new Date(config.end_date);
      const gapResult      = await this.gapResolver.check(symbol, start, end);

      if (gapResult.hasGap) {
        console.log(`[BackgroundWorker] Gap detected for job ${id}. Downloading from Binance...`);
        await this.downloader.downloadAndStore(config.trading_pair, start, end);
      }

      // Step 2: Run the Go engine (BacktestService uses spawn() internally — never exec())
      const startTime    = Date.now();
      const chAddr    = `${process.env.CLICKHOUSE_HOST ?? 'localhost'}:${process.env.CLICKHOUSE_NATIVE_PORT ?? '9000'}`;
      const chDb      = process.env.CLICKHOUSE_DATABASE ?? 'data';
      const chUser    = process.env.CLICKHOUSE_USER    ?? 'default';
      const chPassword = process.env.CLICKHOUSE_PASSWORD ?? '';

      const execResult = await this.service.execute({
        ...config,
        clickhouse_addr:     chAddr,
        clickhouse_db:       chDb,
        clickhouse_user:     chUser,
        clickhouse_password: chPassword,
      });

      // Step 3: Aggregate events into PnlSummary
      const accountBalance =
        execResult.finalPosition?.account_balance ??
        execResult.finalPosition?.total_invested  ??
        config.account_balance;

      const summary = execResult.finalPosition
        ? await this.aggregator.aggregateGoEvents(execResult.events, accountBalance)
        : await this.aggregator.aggregateEvents(execResult.events);

      // Step 4: Persist result
      const storedSummary: StoredPnlSummary = {
        roi:         Number(summary.roi_percent),
        maxDrawdown: Number(summary.max_drawdown_percent ?? 0),
        totalFees:   Number(summary.total_fees),
      };

      const safetyOrderUsage = summary.safety_order_usage_counts
        ? Object.entries(summary.safety_order_usage_counts).map(([level, count]) => ({
            level: String(level),
            count: count as number,
          }))
        : [];

      const processedTrades = processGoEventsForFrontend(execResult.events);

      await this.repo.markCompleted(
        id,
        storedSummary,
        processedTrades,
        safetyOrderUsage,
        Date.now() - startTime,
      );

      console.log(`[BackgroundWorker] Job ${id} completed in ${Date.now() - startTime}ms`);
    } catch (err: any) {
      const errorMessage = err?.stderr ?? err?.message ?? String(err);
      console.error(`[BackgroundWorker] Job ${id} failed:`, errorMessage);
      await this.repo.markFailed(id, errorMessage);
    }
  }
}
