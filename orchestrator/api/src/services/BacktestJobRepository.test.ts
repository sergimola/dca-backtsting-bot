/**
 * Unit tests for BacktestJobRepository — Phase 6 (T025)
 *
 * Uses @jest/globals + jest.unstable_mockModule for ESM-compatible mocking.
 * Module-level mocks must be set up BEFORE dynamically importing the module under test.
 *
 * Tests:
 * - updateProgress writes floored percent and optional currentMetrics
 * - claimNext result includes progress and currentMetrics (camelCase mapping)
 */

import { jest, beforeEach, describe, it, expect } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock stubs — defined before unstable_mockModule so factories can reference them
// ---------------------------------------------------------------------------

const mockWhere  = jest.fn() as jest.Mock;
const mockSet    = jest.fn() as jest.Mock;
const mockUpdate = jest.fn() as jest.Mock;
const mockExecute = jest.fn() as jest.Mock;

mockWhere.mockImplementation(() => Promise.resolve());
mockSet.mockReturnValue({ where: mockWhere });
mockUpdate.mockReturnValue({ set: mockSet });

// ---------------------------------------------------------------------------
// Register module mocks BEFORE importing the module under test
// ---------------------------------------------------------------------------

await jest.unstable_mockModule('../db/client.js', () => ({
  db: {
    update:  mockUpdate,
    execute: mockExecute,
  },
}));

await jest.unstable_mockModule('../db/schema.js', () => ({
  backtests: {
    id:             'id',
    progress:       'progress',
    currentMetrics: 'current_metrics',
    updatedAt:      'updated_at',
  },
}));

await jest.unstable_mockModule('drizzle-orm', () => ({
  eq:              jest.fn((col: unknown, val: unknown) => ({ col, val })),
  sql:             jest.fn(),
  desc:            jest.fn(),
  and:             jest.fn(),
  gte:             jest.fn(),
  lte:             jest.fn(),
  getTableColumns: jest.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// Load module AFTER mocks are registered
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { BacktestJobRepository } = await import('./BacktestJobRepository.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BacktestJobRepository.updateProgress', () => {
  let repo: InstanceType<typeof BacktestJobRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWhere.mockImplementation(() => Promise.resolve());
    mockSet.mockReturnValue({ where: mockWhere });
    mockUpdate.mockReturnValue({ set: mockSet });
    repo = new BacktestJobRepository();
  });

  it('writes floored percent and updatedAt', async () => {
    await repo.updateProgress('job-1', 67.9);

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        progress:  67,          // Math.floor(67.9)
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('clamps percent below 0 to 0', async () => {
    await repo.updateProgress('job-1', -5);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ progress: 0 }));
  });

  it('clamps percent above 100 to 100', async () => {
    await repo.updateProgress('job-1', 150);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ progress: 100 }));
  });

  it('includes currentMetrics when provided', async () => {
    const metrics = {
      type: 'progress' as const,
      percent: 50,
      current_date: '2025-01-15T00:00:00Z',
      processed_candles: 500,
      total_candles: 1000,
      current_price: 100,
      realized_pnl: 0,
      candles_per_second: 100000,
    };
    await repo.updateProgress('job-1', 50, metrics);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ currentMetrics: metrics }),
    );
  });

  it('omits currentMetrics key when not provided', async () => {
    await repo.updateProgress('job-1', 30);
    const setArg = (mockSet.mock.calls[0] as [Record<string, unknown>])[0];
    expect('currentMetrics' in setArg).toBe(false);
  });
});
