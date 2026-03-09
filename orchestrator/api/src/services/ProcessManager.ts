/**
 * ProcessManager - Worker pool for concurrent backtest execution
 *
 * Manages queue of pending backtests and spawns worker threads
 * to execute them concurrently up to maxWorkers limit.
 */



/**
 * Status of a pending or executing backtest
 */
export type BacktestStatus = 'pending' | 'running' | 'complete' | 'failed';

/**
 * Pending backtest work item
 */
interface PendingBacktest {
  requestId: string;
  executeFn: () => Promise<void>;
  status: BacktestStatus;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  error?: Error;
}

/**
 * Execution metrics
 */
export interface ProcessMetrics {
  active_count: number;
  queue_depth: number;
  total_completed: number;
  total_failed: number;
  average_execution_ms: number;
}

/**
 * ProcessManager - Manages concurrent backtest execution
 *
 * Currently a stub implementation that tracks work items.
 * Full worker thread implementation deferred to Phase 3.
 *
 * Responsibilities:
 * - Maintain queue of pending backtests (FIFO order)
 * - Track status of submitted work
 * - Provide metrics on queue depth and execution
 *
 * Architecture notes:
 * - Queue implemented as array (FIFO append/shift)
 * - Status tracking via Map<requestId, PendingBacktest>
 * - Metrics computed on-demand (no background aggregation yet)
 * - Worker thread spawning deferred (simplified for TDD)
 */
export class ProcessManager {
  private queue: PendingBacktest[] = [];
  private work: Map<string, PendingBacktest> = new Map();
  private _isRunning = false;
  private metrics = {
    total_completed: 0,
    total_failed: 0,
    execution_times: [] as number[],
  };

  /**
   * @param _maxWorkers - Max concurrent worker threads (default: CPU core count)
   *                      Stored for future use when implementing worker pool
   */
  constructor(_maxWorkers?: number) {
    // Worker pool implementation deferred - currently using simple queue
  }

  /**
   * Enqueue a backtest for execution
   *
   * @param jobId - Unique identifier for this backtest
   * @param executeFn - Async callback that performs the actual execution
   * @returns jobId (for tracking)
   *
   * @example
   * const jobId = await manager.enqueue('req-123', () => service.execute(req));
   */
  async enqueue(jobId: string, executeFn: () => Promise<void>): Promise<string> {
    const pending: PendingBacktest = {
      requestId: jobId,
      executeFn,
      status: 'pending',
      createdAtMs: Date.now(),
    };

    this.queue.push(pending);
    this.work.set(jobId, pending);

    // Fire-and-forget: start processing if idle
    this._processNext();

    return jobId;
  }

  /**
   * Internal FIFO processor — runs one job at a time.
   * If a job is already running, returns immediately.
   * After a job finishes (success or failure), calls itself again.
   */
  private async _processNext(): Promise<void> {
    if (this._isRunning) return;

    const job = this.queue.shift();
    if (!job) return;

    this._isRunning = true;
    job.status = 'running';
    job.startedAtMs = Date.now();

    try {
      await job.executeFn();
      job.status = 'complete';
      job.completedAtMs = Date.now();
      const executionMs = job.completedAtMs - job.startedAtMs!;
      this.metrics.execution_times.push(executionMs);
      this.metrics.total_completed++;
    } catch (err) {
      job.status = 'failed';
      job.completedAtMs = Date.now();
      job.error = err as Error;
      this.metrics.total_failed++;
    } finally {
      this._isRunning = false;
      this._processNext();
    }
  }

  /**
   * Get current status of a backtest
   *
   * @param requestId - Unique identifier for backtest
   * @returns BacktestStatus or undefined if not found
   *
   * @example
   * const status = await manager.getStatus('req-123');
   * // Returns: 'pending' | 'running' | 'complete' | 'failed'
   */
  async getStatus(requestId: string): Promise<BacktestStatus | undefined> {
    const item = this.work.get(requestId);
    return item?.status;
  }

  /**
   * Mark a backtest as running
   * (Internal use by worker threads)
   */
  markRunning(requestId: string): void {
    const item = this.work.get(requestId);
    if (item) {
      item.status = 'running';
      item.startedAtMs = Date.now();
    }
  }

  /**
   * Mark a backtest as completed successfully
   * (Internal use by worker threads)
   */
  markComplete(requestId: string): void {
    const item = this.work.get(requestId);
    if (item && item.startedAtMs) {
      item.status = 'complete';
      item.completedAtMs = Date.now();
      const executionMs = item.completedAtMs - item.startedAtMs;
      this.metrics.execution_times.push(executionMs);
      this.metrics.total_completed++;
    }
  }

  /**
   * Mark a backtest as failed
   * (Internal use by worker threads)
   */
  markFailed(requestId: string, error: Error): void {
    const item = this.work.get(requestId);
    if (item) {
      item.status = 'failed';
      item.completedAtMs = Date.now();
      item.error = error;
      this.metrics.total_failed++;
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): ProcessMetrics {
    const activeCount = Array.from(this.work.values()).filter(
      (w) => w.status === 'running'
    ).length;

    const avgExecution =
      this.metrics.execution_times.length > 0
        ? this.metrics.execution_times.reduce((a, b) => a + b, 0) /
          this.metrics.execution_times.length
        : 0;

    return {
      active_count: activeCount,
      queue_depth: this.queue.length,
      total_completed: this.metrics.total_completed,
      total_failed: this.metrics.total_failed,
      average_execution_ms: Math.round(avgExecution),
    };
  }

  /**
   * Get next pending work item
   * (For worker threads to dequeue)
   */
  dequeue(): PendingBacktest | undefined {
    return this.queue.shift();
  }


}
