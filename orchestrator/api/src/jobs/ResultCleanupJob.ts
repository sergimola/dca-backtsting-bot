/**
 * Result Cleanup Job (T031)
 *
 * Scheduled job that runs daily at 00:00 UTC (configurable).
 * Deletes expired results (age > TTL days) from ResultStore.
 *
 * Usage:
 * const job = new ResultCleanupJob(resultStore, '0 0 * * *'); // 00:00 UTC
 * job.start();
 * // ... later ...
 * job.stop();
 */

import { ResultStore } from '../services/ResultStore.js';

/**
 * ResultCleanupJob - Scheduled cleanup of expired results
 */
export class ResultCleanupJob {
  private intervalId: NodeJS.Timeout | null = null;
  private lastCleanup: Date | null = null;

  /**
   * Constructor
   *
   * @param resultStore ResultStore instance to clean
   * @param scheduleHourUtc Hour in UTC (0-23) to run cleanup, default 0 (00:00)
   */
  constructor(
    private resultStore: ResultStore,
    private scheduleHourUtc: number = 0,
  ) {}

  /**
   * Start the cleanup job
   * Runs cleanup at specified hour every day
   */
  start(): void {
    if (this.intervalId !== null) {
      console.warn('[ResultCleanupJob] Already running');
      return;
    }

    console.log(`[ResultCleanupJob] Starting cleanup scheduler at ${this.scheduleHourUtc}:00 UTC`);

    // Calculate milliseconds until next scheduled run
    const now = new Date();
    const scheduleTime = new Date();
    scheduleTime.setUTCHours(this.scheduleHourUtc, 0, 0, 0);

    // If scheduled time already passed today, schedule for tomorrow
    if (scheduleTime <= now) {
      scheduleTime.setUTCDate(scheduleTime.getUTCDate() + 1);
    }

    const msUntilNextRun = scheduleTime.getTime() - now.getTime();

    // Schedule first run
    setTimeout(() => {
      this.executeCleanup();

      // Then schedule recurring daily runs
      this.intervalId = setInterval(() => {
        this.executeCleanup();
      }, 24 * 60 * 60 * 1000);
    }, msUntilNextRun);
  }

  /**
   * Stop the cleanup job
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[ResultCleanupJob] Stopped');
    }
  }

  /**
   * Execute cleanup immediately
   * Can be called manually for testing or urgent cleanup
   */
  async executeCleanup(): Promise<void> {
    try {
      const now = new Date();
      console.log(`[ResultCleanupJob] Running cleanup at ${now.toISOString()}`);

      const deleteCount = await this.resultStore.cleanup();
      this.lastCleanup = now;

      console.log(`[ResultCleanupJob] Cleaned up ${deleteCount} expired result(s)`);
    } catch (error: any) {
      console.error(`[ResultCleanupJob] Error during cleanup: ${error.message}`, error);
    }
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      running: this.intervalId !== null,
      schedule_hour_utc: this.scheduleHourUtc,
      last_cleanup: this.lastCleanup?.toISOString() || null,
    };
  }
}
