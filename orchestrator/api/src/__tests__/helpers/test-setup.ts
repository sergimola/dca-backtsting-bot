/**
 * Test Setup Utilities
 * Shared configuration for BDD acceptance tests
 */

import { Express } from 'express';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { createApp } from '../../app.js';
import { ResultStore } from '../../services/ResultStore.js';
import { ProcessManager } from '../../services/ProcessManager.js';
import { BacktestService } from '../../services/BacktestService.js';
import { ResultAggregator } from '../../services/ResultAggregator.js';
import { IdempotencyCache } from '../../services/IdempotencyCache.js';
import { HealthMonitor } from '../../services/HealthMonitor.js';
import { MarketDataResolver } from '../../services/MarketDataResolver.js';

/**
 * Check if Core Engine binary is available
 * Using mock script for tests, which is always guaranteed to exist
 * Used to conditionally skip acceptance tests
 */
export function hasCoreEngineBinary(): boolean {
  return true;
}

let testAppInstance: Express | null = null;
let testServices: {
  resultStore: ResultStore;
  processManager: ProcessManager;
  backtestService: BacktestService;
  resultAggregator: ResultAggregator;
  idempotencyCache: IdempotencyCache;
  healthMonitor: HealthMonitor;
} | null = null;
let tempDir: string | null = null;

/**
 * Initialize a test Express app with all services
 * Routes are fully wired and functional for integration testing
 */
export async function setupTestApp(): Promise<Express> {
  if (testAppInstance) {
    return testAppInstance;
  }

  // Create temporary directory for test results
  tempDir = path.join(__dirname, '../../../.test-data', `run-${Date.now()}`);
  await fsPromises.mkdir(tempDir, { recursive: true });

  // Initialize services
  const resultStore = new ResultStore(tempDir, 7);
  await resultStore.initialize();

  const processManager = new ProcessManager();
  const mockBinaryPath = path.resolve(process.cwd(), 'testdata', 'mock-core-engine.js');
  const backtestService = new BacktestService(mockBinaryPath);
  const resultAggregator = new ResultAggregator();
  const idempotencyCache = new IdempotencyCache(7);
  const coreEngineBinaryPath = mockBinaryPath;
  const healthMonitor = new HealthMonitor(processManager, coreEngineBinaryPath);

  // Use an in-memory no-op resolver for tests (resolves any path as existing)
  const marketDataResolver = new MarketDataResolver(tempDir);

  // Create Express app
  testAppInstance = createApp({
    resultStore,
    processManager,
    backtestService,
    resultAggregator,
    idempotencyCache,
    healthMonitor,
    coreEngineBinaryPath,
    marketDataResolver,
  });

  testServices = {
    resultStore,
    processManager,
    backtestService,
    resultAggregator,
    idempotencyCache,
    healthMonitor,
  };

  return testAppInstance;
}

/**
 * Get initialized test app
 */
export function getTestApp(): Express {
  if (!testAppInstance) {
    throw new Error('Test app not initialized. Call setupTestApp() first.');
  }
  return testAppInstance;
}

/**
 * Get test services for assertions
 */
export function getTestServices() {
  if (!testServices) {
    throw new Error('Test services not initialized. Call setupTestApp() first.');
  }
  return testServices;
}

/**
 * Clean up test environment
 */
export async function cleanupTestApp(): Promise<void> {
  if (tempDir) {
    try {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  testAppInstance = null;
  testServices = null;
}

/**
 * Default valid backtest request for testing
 */
export function createValidBacktestRequest() {
  return {
    entry_price: '100.50000000',
    amounts: ['10.25000000', '15.50000000', '20.75000000'],
    sequences: [0, 1, 2],
    leverage: '2.00000000',
    margin_ratio: '0.75000000',
    market_data_csv_path: '/data/BTCUSDT_1m.csv',
  };
}

/**
 * Create multiple backtest requests for concurrency testing
 */
export function createMultipleBacktestRequests(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ...createValidBacktestRequest(),
    entry_price: (100.50 + i * 0.01).toFixed(8),
  }));
}
