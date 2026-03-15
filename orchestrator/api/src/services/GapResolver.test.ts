/**
 * GapResolver Unit Tests (T007)
 *
 * Verifies the COUNT(*) FINAL gap-detection logic — the "swiss cheese" prevention layer.
 * Stage 1 checks Postgres SyncLedgerRepository (mocked); Stage 2 queries ClickHouse (mocked).
 *
 * Test matrix:
 *   GT1 - Full coverage after ledger miss (CH count exact) → { hasGap: false }
 *   GT2 - Under-count returns { hasGap: true }
 *   GT3 - Empty table (actualCount = 0) returns { hasGap: true }
 *   GT4 - expectedCount formula: floor((end - start) / 60_000) + 1
 *   GT5 - COUNT(*) FINAL query is used — not MIN/MAX
 *   GT6 - Ledger hit skips COUNT query and returns { hasGap: false }
 */

import { GapResolver } from './GapResolver';
import type { SyncLedgerRepository } from './SyncLedgerRepository';

// Mock the ClickHouseClient module so no real connection is made
jest.mock('./ClickHouseClient', () => ({
  chClient: {
    query: jest.fn(),
  },
  database: process.env.CLICKHOUSE_DATABASE ?? 'data',
}));

import { chClient } from './ClickHouseClient';

const mockedQuery = jest.mocked(chClient.query);

// Helper: build a fake ResultSet with a json() method
function fakeResultSet(rows: object[]) {
  return {
    json: jest.fn().mockResolvedValue(rows),
  } as any;
}

describe('GapResolver', () => {
  let resolver: GapResolver;
  let mockSyncLedger: jest.Mocked<Pick<SyncLedgerRepository, 'checkCoverage'>>;

  // 30-day range: 2025-01-01T00:00:00Z → 2025-01-31T00:00:00Z
  const symbol = 'BTCUSDT';
  const startMs = new Date('2025-01-01T00:00:00Z').getTime();
  const endMs = new Date('2025-01-31T00:00:00Z').getTime();
  // Expected = floor((endMs - startMs) / 60_000) + 1
  const expectedCount = Math.floor((endMs - startMs) / 60_000) + 1; // 43201

  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncLedger = { checkCoverage: jest.fn() };
    resolver = new GapResolver(mockSyncLedger as unknown as SyncLedgerRepository);
  });

  it('GT1: full coverage returns { hasGap: false }', async () => {
    mockSyncLedger.checkCoverage.mockResolvedValueOnce(false);          // ledger miss
    mockedQuery.mockResolvedValueOnce(fakeResultSet([{ cnt: expectedCount.toString() }])); // count: full

    const result = await resolver.check(symbol, new Date(startMs), new Date(endMs));

    expect(result.hasGap).toBe(false);
    expect(result.actualCount).toBe(expectedCount);
    expect(result.expectedCount).toBe(expectedCount);
  });

  it('GT2: under-count (swiss-cheese gap) returns { hasGap: true }', async () => {
    const actualCount = expectedCount - 500;
    mockSyncLedger.checkCoverage.mockResolvedValueOnce(false);          // ledger miss
    mockedQuery.mockResolvedValueOnce(fakeResultSet([{ cnt: actualCount.toString() }])); // count: partial

    const result = await resolver.check(symbol, new Date(startMs), new Date(endMs));

    expect(result.hasGap).toBe(true);
    expect(result.actualCount).toBe(actualCount);
    expect(result.expectedCount).toBe(expectedCount);
  });

  it('GT3: empty table (actualCount = 0) returns { hasGap: true }', async () => {
    mockSyncLedger.checkCoverage.mockResolvedValueOnce(false);          // ledger miss
    mockedQuery.mockResolvedValueOnce(fakeResultSet([{ cnt: '0' }]));   // count: empty

    const result = await resolver.check(symbol, new Date(startMs), new Date(endMs));

    expect(result.hasGap).toBe(true);
    expect(result.actualCount).toBe(0);
  });

  it('GT4: expectedCount uses floor((end - start) / 60_000) + 1 formula', async () => {
    // 3-minute range: start=0ms, end=120_000ms → floor(120_000/60_000)+1 = 3
    const s = new Date(0);
    const e = new Date(120_000);
    const expected = Math.floor((e.getTime() - s.getTime()) / 60_000) + 1; // 3

    mockSyncLedger.checkCoverage.mockResolvedValueOnce(false);          // ledger miss
    mockedQuery.mockResolvedValueOnce(fakeResultSet([{ cnt: expected.toString() }])); // count: exact

    const result = await resolver.check('ETHUSDT', s, e);

    expect(result.expectedCount).toBe(3);
    expect(result.hasGap).toBe(false);
  });

  it('GT5: COUNT(*) FINAL query is used — not MIN/MAX', async () => {
    mockSyncLedger.checkCoverage.mockResolvedValueOnce(false);          // ledger miss
    mockedQuery.mockResolvedValueOnce(fakeResultSet([{ cnt: '1' }]));   // count query

    await resolver.check(symbol, new Date(startMs), new Date(endMs));

    const countQueryArg = mockedQuery.mock.calls[0][0] as { query: string };
    expect(countQueryArg.query).toMatch(/COUNT\(\*\)/i);
    expect(countQueryArg.query).toMatch(/FINAL/i);
    expect(countQueryArg.query).not.toMatch(/MIN\s*\(/i);
    expect(countQueryArg.query).not.toMatch(/MAX\s*\(/i);
  });

  it('GT6: ledger hit skips COUNT query and returns { hasGap: false }', async () => {
    mockSyncLedger.checkCoverage.mockResolvedValueOnce(true);           // ledger: hit

    const result = await resolver.check(symbol, new Date(startMs), new Date(endMs));

    expect(result.hasGap).toBe(false);
    expect(result.actualCount).toBe(expectedCount);  // echoes expectedCount
    // ClickHouse COUNT(*) FINAL must NOT be called when ledger reports coverage
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
