/**
 * Health Metrics Contract
 *
 * Endpoint: GET /health
 * Returns current API and Core Engine health status
 */

/**
 * HealthResponse - Health check response
 *
 * Used by monitoring systems and load balancers to determine API availability.
 * Returns HTTP 200 regardless of status (status field indicates actual condition).
 *
 * @example Healthy
 * {
 *   "status": "healthy",
 *   "timestamp": "2024-01-01T12:00:00.000Z",
 *   "uptime_seconds": 3600,
 *   "core_engine": {
 *     "status": "ready",
 *     "binary_available": true,
 *     "check_time_ms": 50
 *   },
 *   "queue": {
 *     "depth": 2,
 *     "workers_busy": 2,
 *     "workers_total": 4
 *   },
 *   "metrics": {
 *     "backtests_completed_today": 145,
 *     "average_execution_time_ms": 280,
 *     "error_rate_percent": 1.2
 *   }
 * }
 *
 * @example Degraded (binary unavailable)
 * {
 *   "status": "degraded",
 *   "timestamp": "2024-01-01T12:00:00.000Z",
 *   "uptime_seconds": 3600,
 *   "core_engine": {
 *     "status": "unavailable",
 *     "binary_available": false,
 *     "check_time_ms": 100,
 *     "error": "Binary not found at /app/core-engine-binary"
 *   },
 *   "queue": {...},
 *   "metrics": {...}
 * }
 */
export interface HealthResponse {
  /** Overall health status: healthy, degraded, unhealthy */
  status: 'healthy' | 'degraded' | 'unhealthy';

  /** ISO 8601 timestamp of health check */
  timestamp: string;

  /** API uptime in seconds since last restart */
  uptime_seconds: number;

  /** Core Engine binary status */
  core_engine: CoreEngineHealth;

  /** Request queue and worker metrics */
  queue: QueueMetrics;

  /** Aggregated operational metrics */
  metrics: OperationalMetrics;
}

/**
 * CoreEngineHealth - Status of Go Core Engine binary
 */
export interface CoreEngineHealth {
  /** Binary availability: "ready" | "unavailable" | "failing" */
  status: 'ready' | 'unavailable' | 'failing';

  /** true if binary is accessible and executable */
  binary_available: boolean;

  /** Time taken to check binary status (milliseconds) */
  check_time_ms: number;

  /** Error message if binary unavailable (e.g., "File not found", "Permission denied") */
  error?: string;

  /** Last successful subprocess execution (ISO 8601 timestamp) */
  last_success_time?: string;

  /** Number of consecutive failed subprocess attempts */
  consecutive_failures: number;
}

/**
 * QueueMetrics - Backtest request queue and worker pool status
 */
export interface QueueMetrics {
  /** Number of pending backtest requests waiting for worker availability */
  depth: number;

  /** Number of workers currently executing backtests */
  workers_busy: number;

  /** Total number of available workers in pool */
  workers_total: number;

  /** Estimated wait time for next available worker (milliseconds) */
  estimated_wait_ms: number;
}

/**
 * OperationalMetrics - Aggregated API performance metrics
 */
export interface OperationalMetrics {
  /** Total backtests completed since API startup or today (context-dependent) */
  backtests_completed_today: number;

  /** Average execution time across all backtests (milliseconds) */
  average_execution_time_ms: number;

  /** Percentage of requests that resulted in errors */
  error_rate_percent: number;

  /** Percentage of requests that timed out */
  timeout_rate_percent: number;

  /** Average response time for successful requests (milliseconds) */
  response_time_median_ms: number;

  /** 95th percentile response time (milliseconds) */
  response_time_p95_ms: number;

  /** Disk space available for 7-day result retention (bytes) */
  storage_available_bytes?: number;

  /** Memory usage of API process (bytes) */
  memory_usage_mb: number;

  /** CPU usage percentage of API process */
  cpu_usage_percent: number;
}

/**
 * HEALTH STATUS DETERMINATION
 *
 * Health status is determined by the following logic:
 *
 * - **"healthy"**: Core Engine is "ready" AND error rate < 5% AND timeout rate < 1%
 * - **"degraded"**: Core Engine is "failing" OR error rate 5-20% OR timeout rate 1-5%
 * - **"unhealthy"**: Core Engine is "unavailable" OR error rate > 20% OR timeout rate > 5%
 *
 * Load balancers should:
 * - Route traffic normally for "healthy" status
 * - Reduce traffic or warn for "degraded" status
 * - Stop routing traffic and raise alerts for "unhealthy" status
 *
 * Monitoring systems should:
 * - Warn if status is "degraded" for > 5 minutes
 * - Page on-call if status is "unhealthy" for > 1 minute
 */

/**
 * HEALTH CHECK IMPLEMENTATION PATTERN
 *
 * export class HealthMonitor {
 *   async getHealth(): Promise<HealthResponse> {
 *     const startTime = Date.now();
 *
 *     // Check Core Engine binary availability
 *     const coreEngineHealth = await this.checkCoreEngine();
 *
 *     // Get queue metrics
 *     const queueMetrics = this.workerPool.getMetrics();
 *
 *     // Get operational metrics
 *     const operationalMetrics = await this.metricsStore.getMetrics();
 *
 *     // Determine overall status
 *     let status: 'healthy' | 'degraded' | 'unhealthy';
 *     if (
 *       coreEngineHealth.status === 'ready' &&
 *       operationalMetrics.error_rate_percent < 5 &&
 *       operationalMetrics.timeout_rate_percent < 1
 *     ) {
 *       status = 'healthy';
 *     } else if (
 *       coreEngineHealth.status === 'failing' ||
 *       operationalMetrics.error_rate_percent >= 5 ||
 *       operationalMetrics.timeout_rate_percent >= 1
 *     ) {
 *       status = 'degraded';
 *     } else {
 *       status = 'unhealthy';
 *     }
 *
 *     return {
 *       status,
 *       timestamp: new Date().toISOString(),
 *       uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
 *       core_engine: coreEngineHealth,
 *       queue: queueMetrics,
 *       metrics: operationalMetrics,
 *     };
 *   }
 *
 *   private async checkCoreEngine(): Promise<CoreEngineHealth> {
 *     const startTime = Date.now();
 *
 *     try {
 *       // Try to access binary file
 *       await fs.promises.access(this.binaryPath, fs.constants.X_OK);
 *
 *       return {
 *         status: 'ready',
 *         binary_available: true,
 *         check_time_ms: Date.now() - startTime,
 *         last_success_time: new Date().toISOString(),
 *         consecutive_failures: 0,
 *       };
 *     } catch (error) {
 *       return {
 *         status: 'unavailable',
 *         binary_available: false,
 *         check_time_ms: Date.now() - startTime,
 *         error: (error as Error).message,
 *         consecutive_failures: this.consecutiveFailures,
 *       };
 *     }
 *   }
 * }
 */
