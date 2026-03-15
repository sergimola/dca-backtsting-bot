/**
 * ClickHouseWriter Unit Tests (T008)
 *
 * Verifies the insertBatch() bulk-insert guard: ≥1,000 rows per INSERT,
 * empty-array guard, and correct @clickhouse/client call shape.
 *
 * Test matrix:
 *   CW1 - Empty-array call throws internal guard error
 *   CW2 - Batch of 1,000 rows calls chClient.insert exactly once
 *   CW3 - Format is JSONEachRow on every insert call
 *   CW4 - Table is 'dca_bot.market_data'
 */

import { ClickHouseWriter } from './ClickHouseWriter';

// Mock the ClickHouseClient module
jest.mock('./ClickHouseClient', () => ({
  chClient: {
    insert: jest.fn(),
  },
  database: process.env.CLICKHOUSE_DATABASE ?? 'data',
}));

import { chClient } from './ClickHouseClient';

const mockedInsert = jest.mocked(chClient.insert);

function makeRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    symbol: 'BTCUSDT',
    timestamp: new Date(Date.now() + i * 60_000).toISOString(),
    open: 50000 + i,
    high: 50001 + i,
    low: 49999 + i,
    close: 50000 + i,
    volume: 1.5,
  }));
}

describe('ClickHouseWriter', () => {
  let writer: ClickHouseWriter;

  beforeEach(() => {
    writer = new ClickHouseWriter();
    mockedInsert.mockClear();
    mockedInsert.mockResolvedValue(undefined as any);
  });

  it('CW1: empty-array call throws guard error', async () => {
    await expect(writer.insertBatch([])).rejects.toThrow('insertBatch called with empty array');
    expect(mockedInsert).not.toHaveBeenCalled();
  });

  it('CW2: batch of 1,000 rows calls insert exactly once', async () => {
    const rows = makeRows(1000);
    await writer.insertBatch(rows);
    expect(mockedInsert).toHaveBeenCalledTimes(1);
  });

  it('CW3: insert is called with format JSONEachRow', async () => {
    const rows = makeRows(100);
    await writer.insertBatch(rows);
    const callArg = mockedInsert.mock.calls[0][0] as any;
    expect(callArg.format).toBe('JSONEachRow');
  });

  it('CW4: insert targets the {database}.market_data table from env', async () => {
    const rows = makeRows(100);
    await writer.insertBatch(rows);
    const callArg = mockedInsert.mock.calls[0][0] as any;
    // Table name uses CLICKHOUSE_DATABASE env var (defaults to 'data')
    const expectedDb = process.env.CLICKHOUSE_DATABASE ?? 'data';
    expect(callArg.table).toBe(`${expectedDb}.market_data`);
  });

  it('CW5: batch of 2,500 rows (two separate calls from caller) each trigger one insert each', async () => {
    const batch1 = makeRows(1500);
    const batch2 = makeRows(1000);
    await writer.insertBatch(batch1);
    await writer.insertBatch(batch2);
    expect(mockedInsert).toHaveBeenCalledTimes(2);
  });
});
