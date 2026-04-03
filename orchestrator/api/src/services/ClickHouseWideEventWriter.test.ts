jest.mock('./ClickHouseClient', () => ({
  chClient: {
    insert: jest.fn().mockResolvedValue(undefined),
    command: jest.fn().mockResolvedValue(undefined),
  },
  database: 'data',
}));

import { chClient } from './ClickHouseClient';
import { ClickHouseWideEventWriter, WideEventRow } from './ClickHouseWideEventWriter';

const mockedInsert = jest.mocked(chClient.insert);
const mockedCommand = jest.mocked(chClient.command);

function makeRow(runId: string, idx: number): WideEventRow {
  return {
    session_id: '00000000-0000-0000-0000-000000000001',
    run_id: runId,
    schema_version: 1,
    trade_id: `trade-${idx}`,
    timestamp: '2025-01-01T00:00:00.000Z',
    event_type: 'price_changed',
    symbol: 'BTCUSDC',
    candle_open: '50000',
    candle_high: '50100',
    candle_low: '49900',
    candle_close: '50050',
    candle_volume: '100',
    running_account_balance: '10000',
    global_candle_count: idx,
    position_state: 'IDLE',
    average_entry_price: '0',
    position_quantity: '0',
    total_capital_deployed: '0',
    fees_accumulated: '0',
    take_profit_price: '0',
    liquidation_price: '0',
    filled_orders_count: 0,
    unrealized_pnl: '0',
    current_drawdown_pct: '0',
    action_price: '0',
    action_quantity: '0',
    action_fee: '0',
    order_number: 0,
  };
}

describe('ClickHouseWideEventWriter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('push 999 rows → no flush; push 1 more → auto-flush triggers', async () => {
    const writer = new ClickHouseWideEventWriter();
    for (let i = 0; i < 999; i++) {
      await writer.push(makeRow('run-1', i));
    }
    expect(mockedInsert).not.toHaveBeenCalled();

    await writer.push(makeRow('run-1', 999));
    expect(mockedInsert).toHaveBeenCalledTimes(1);
    expect(mockedInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.any(Array),
      })
    );
    // The batch should have exactly 1000 rows
    const insertedValues = mockedInsert.mock.calls[0][0].values as WideEventRow[];
    expect(insertedValues).toHaveLength(1000);
  });

  it('push 1500 → exactly 1 batch of 1000 flushed, 500 remain', async () => {
    const writer = new ClickHouseWideEventWriter();
    for (let i = 0; i < 1500; i++) {
      await writer.push(makeRow('run-1', i));
    }
    expect(mockedInsert).toHaveBeenCalledTimes(1);
    const insertedValues = mockedInsert.mock.calls[0][0].values as WideEventRow[];
    expect(insertedValues).toHaveLength(1000);

    // Flush remaining 500
    await writer.flush();
    expect(mockedInsert).toHaveBeenCalledTimes(2);
    const flushedValues = mockedInsert.mock.calls[1][0].values as WideEventRow[];
    expect(flushedValues).toHaveLength(500);
  });

  it('bulkDeleteBeforeInsert calls chClient.command exactly ONCE', async () => {
    const writer = new ClickHouseWideEventWriter();
    await writer.bulkDeleteBeforeInsert('session-1', ['id-1', 'id-2', 'id-3']);
    expect(mockedCommand).toHaveBeenCalledTimes(1);
    expect(mockedCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('IN'),
        query_params: { sessionId: 'session-1', runIds: ['id-1', 'id-2', 'id-3'] },
      })
    );
  });

  it('flush-on-exit: 350 buffered → flush() → chClient.insert called with 350 rows', async () => {
    const writer = new ClickHouseWideEventWriter();
    for (let i = 0; i < 350; i++) {
      await writer.push(makeRow('run-1', i));
    }
    expect(mockedInsert).not.toHaveBeenCalled();

    await writer.flush();
    expect(mockedInsert).toHaveBeenCalledTimes(1);
    const flushedValues = mockedInsert.mock.calls[0][0].values as WideEventRow[];
    expect(flushedValues).toHaveLength(350);
  });
});
