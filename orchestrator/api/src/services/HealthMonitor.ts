/**
 * HealthMonitor (T039)
 *
 * Monitors system health:
 * - Core Engine binary availability
 * - Queue depth and utilization
 * - Error rates and performance metrics
 *
 * Returns HealthResponse with status and detailed metrics
 */

import fs from 'fs';
import { ProcessManager } from './ProcessManager';

/**
 * Health status levels
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Health response structure
 */
export interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptime_seconds: number;
  core_engine: {
    availability: 'ready' | 'unavailable';
    binary_path?: string;
    binary_accessible?: boolean;
  };
  queue: {
    depth: number;
    active_count: number;
    max_workers: number;
  };
  performance: {
    error_rate_percent: number;
    timeout_rate_percent: number;
    avg_execution_ms: number;
  };
}

/**
 * HealthMonitor - System health tracking
 */
export class HealthMonitor {
  private startTime: number = Date.now();
  private errors: number = 0;
  private timeouts: number = 0;
  private successCount: number = 0;
  private totalExecutionMs: number = 0;

  constructor(
    private processManager: ProcessManager,
    private coreEngineBinaryPath: string,
  ) {}

  /**
   * Get current system health status
   *
   * @returns HealthResponse with all metrics
   */
  async getStatus(): Promise<HealthResponse> {
    // Check Core Engine binary availability
    const binaryAccessible = this.checkBinaryAccess();

    // Get queue metrics
    const queueMetrics = this.processManager.getMetrics();

    // Calculate error rates
    const total = this.errors + this.timeouts + this.successCount;
    const errorRatePercent = total > 0 ? (this.errors / total) * 100 : 0;
    const timeoutRatePercent = total > 0 ? (this.timeouts / total) * 100 : 0;
    const avgExecutionMs = this.successCount > 0 ? this.totalExecutionMs / this.successCount : 0;

    // Determine overall health status
    let status: HealthStatus = 'healthy';
    if (!binaryAccessible || errorRatePercent > 20) {
      status = 'unhealthy';
    } else if (queueMetrics.queue_depth > 20 || errorRatePercent > 10) {
      status = 'degraded';
    }

    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime_seconds: uptime,
      core_engine: {
        availability: binaryAccessible ? 'ready' : 'unavailable',
        binary_path: this.coreEngineBinaryPath,
        binary_accessible: binaryAccessible,
      },
      queue: {
        depth: queueMetrics.queue_depth,
        active_count: queueMetrics.active_count,
        max_workers: queueMetrics.queue_depth + queueMetrics.active_count, // Simplified for MVP
      },
      performance: {
        error_rate_percent: Math.round(errorRatePercent * 100) / 100,
        timeout_rate_percent: Math.round(timeoutRatePercent * 100) / 100,
        avg_execution_ms: Math.round(avgExecutionMs),
      },
    };
  }

  /**
   * Record execution metrics
   *
   * @param executionMs Execution time in milliseconds
   * @param success Whether execution was successful
   * @param isTimeout Whether execution timed out
   * @param isError Whether execution errored
   */
  recordExecution(executionMs: number, success: boolean, isTimeout: boolean, isError: boolean): void {
    this.totalExecutionMs += executionMs;

    if (success) {
      this.successCount++;
    } else if (isTimeout) {
      this.timeouts++;
    } else if (isError) {
      this.errors++;
    }
  }

  /**
   * Check if Core Engine binary is accessible
   *
   * @returns true if binary exists and is executable
   */
  private checkBinaryAccess(): boolean {
    try {
      // Check if binary exists
      if (!fs.existsSync(this.coreEngineBinaryPath)) {
        return false;
      }

      // Check if it's executable (on unix systems)
      if (process.platform !== 'win32') {
        const stats = fs.statSync(this.coreEngineBinaryPath);
        const isExecutable = (stats.mode & 0o111) !== 0;
        return isExecutable;
      }

      // On Windows, just check existence
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get performance statistics
   */
  getStats() {
    const total = this.errors + this.timeouts + this.successCount;
    return {
      total_executions: total,
      successes: this.successCount,
      errors: this.errors,
      timeouts: this.timeouts,
      avg_execution_ms: this.successCount > 0 ? this.totalExecutionMs / this.successCount : 0,
    };
  }

  /**
   * Reset statistics (useful for testing)
   */
  reset(): void {
    this.errors = 0;
    this.timeouts = 0;
    this.successCount = 0;
    this.totalExecutionMs = 0;
  }
}
