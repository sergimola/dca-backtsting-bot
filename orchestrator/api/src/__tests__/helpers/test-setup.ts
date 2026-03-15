/**
 * Test Setup Utilities
 * Shared configuration for BDD acceptance tests
 */

import { Express } from 'express';
import * as path from 'path';
import { createApp } from '../../app.js';
import { BacktestJobRepository } from '../../services/BacktestJobRepository.js';
import { SyncLedgerRepository } from '../../services/SyncLedgerRepository.js';
import { HealthMonitor } from '../../services/HealthMonitor.js';

/**
 * Check if Core Engine binary is available
 * Using mock script for tests, which is always guaranteed to exist
 * Used to conditionally skip acceptance tests
 */
export function hasCoreEngineBinary(): boolean {
  return true;
}

let testAppInstance: Express | null = null;

/**
 * Initialize a test Express app with mock repositories (no real DB).
 * Routes are fully wired for integration testing. Repo methods are
 * jest.fn() stubs so validation errors (400s) are testable without Postgres.
 */
export async function setupTestApp(): Promise<Express> {
  if (testAppInstance) {
    return testAppInstance;
  }

  // Mock repositories — no real DB connection required for acceptance tests
  const backtestJobRepository = {
    create: jest.fn().mockResolvedValue({ id: 'test-job-id', status: 'pending', config: {} }),
    findById: jest.fn().mockResolvedValue(null),
    listWithoutBlobs: jest.fn().mockResolvedValue([]),
    claimNext: jest.fn().mockResolvedValue(null),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  } as unknown as BacktestJobRepository;

  const syncLedgerRepository = {
    checkCoverage: jest.fn().mockResolvedValue(false),
    upsert: jest.fn().mockResolvedValue(undefined),
  } as unknown as SyncLedgerRepository;

  const coreEngineBinaryPath = path.resolve(process.cwd(), 'testdata', 'mock-core-engine.js');
  const healthMonitor = new HealthMonitor(coreEngineBinaryPath);

  testAppInstance = createApp({
    backtestJobRepository,
    syncLedgerRepository,
    healthMonitor,
  });

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
 * Get test services for assertions (stub — repos are mocks)
 */
export function getTestServices() {
  return {};
}

/**
 * Clean up test environment
 */
export async function cleanupTestApp(): Promise<void> {
  testAppInstance = null;
}

/**
 * Default valid backtest request matching current ApiBacktestRequest schema
 */
export function createValidBacktestRequest() {
  return {
    trading_pair: 'BTC/USDT',
    start_date: '2025-01-01T00:00:00Z',
    end_date: '2025-01-31T23:59:59Z',
    price_entry: '50000.00',
    price_scale: '1.05',
    amount_scale: '1.10',
    number_of_orders: 5,
    amount_per_trade: '100.00',
    margin_type: 'cross',
    multiplier: 1,
    take_profit_distance_percent: '2.5',
    account_balance: '5000.00',
    exit_on_last_order: false,
  };
}

/**
 * Create multiple backtest requests for testing
 */
export function createMultipleBacktestRequests(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ...createValidBacktestRequest(),
    price_entry: (50000 + i * 10).toFixed(2),
  }));
}
