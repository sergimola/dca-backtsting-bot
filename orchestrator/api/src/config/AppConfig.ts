/**
 * Application Configuration
 * Loaded from environment variables
 */

/**
 * AppConfig - Runtime configuration loaded from environment
 */
export interface AppConfig {
  /** Port to listen on (default: 3000) */
  port: number;

  /** Path to Core Engine binary executable */
  coreEngineBinaryPath: string;

  /** Maximum number of worker threads (auto-detect CPU cores) */
  maxWorkerThreads: number;

  /** Backtest execution timeout in milliseconds (default: 30000) */
  timeoutMs: number;

  /** Directory to store backtest results */
  resultsDir: string;

  /** Result TTL in days (default: 7) */
  resultsTtlDays: number;

  /** Log level (debug, info, warn, error) */
  logLevel: string;

  /** Environment (development, production) */
  environment: string;
}

/**
 * Loads application configuration from environment variables
 * Falls back to sensible defaults
 */
export function loadAppConfig(): AppConfig {
  const os = await import('os');

  const port = parseInt(process.env.PORT || '3000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: expected 1-65535, got ${port}`);
  }

  const coreEngineBinaryPath = process.env.CORE_ENGINE_BINARY_PATH;
  if (!coreEngineBinaryPath) {
    throw new Error('Missing required env var: CORE_ENGINE_BINARY_PATH');
  }

  const maxWorkerThreads = parseInt(
    process.env.MAX_WORKER_THREADS || String(os.cpus().length),
    10
  );
  if (isNaN(maxWorkerThreads) || maxWorkerThreads < 1) {
    throw new Error('Invalid MAX_WORKER_THREADS: must be >= 1');
  }

  const timeoutMs = parseInt(process.env.TIMEOUT_MS || '30000', 10);
  if (isNaN(timeoutMs) || timeoutMs < 1000) {
    throw new Error('Invalid TIMEOUT_MS: must be >= 1000');
  }

  const resultsDir = process.env.RESULTS_DIR || './data/results';
  const resultsTtlDays = parseInt(process.env.RESULTS_TTL_DAYS || '7', 10);
  if (isNaN(resultsTtlDays) || resultsTtlDays < 1) {
    throw new Error('Invalid RESULTS_TTL_DAYS: must be >= 1');
  }

  const logLevel = process.env.LOG_LEVEL || 'info';
  const validLogLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLogLevels.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: must be one of ${validLogLevels.join(', ')}`);
  }

  const environment = process.env.NODE_ENV || 'development';

  return {
    port,
    coreEngineBinaryPath,
    maxWorkerThreads,
    timeoutMs,
    resultsDir,
    resultsTtlDays,
    logLevel,
    environment,
  };
}
