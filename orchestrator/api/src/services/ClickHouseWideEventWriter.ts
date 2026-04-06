import { chClient, database } from './ClickHouseClient.js';

/**
 * Row shape matching the sweep_wide_events ClickHouse table.
 * All decimal fields are strings to preserve precision (constitution: fixed-point arithmetic).
 */
export interface WideEventRow {
  session_id: string;
  run_id: string;
  schema_version: number;
  trade_id: string;
  timestamp: string;
  event_type: string;
  symbol: string;
  candle_open: string;
  candle_high: string;
  candle_low: string;
  candle_close: string;
  candle_volume: string;
  running_account_balance: string;
  global_candle_count: number;
  position_state: string;
  average_entry_price: string;
  position_quantity: string;
  total_capital_deployed: string;
  fees_accumulated: string;
  take_profit_price: string;
  liquidation_price: string;
  filled_orders_count: number;
  unrealized_pnl: string;
  current_drawdown_pct: string;
  action_price: string;
  action_quantity: string;
  action_fee: string;
  order_number: number;
  close_reason: string;
  realized_pnl: string;
}

/**
 * ClickHouseWideEventWriter buffers wide event rows and bulk-inserts them
 * into the sweep_wide_events table. Auto-flushes at BATCH_SIZE rows.
 *
 * Usage:
 *   const writer = new ClickHouseWideEventWriter();
 *   // ... in a loop:
 *   await writer.push(row);
 *   // ... when done:
 *   await writer.flush(); // flush-on-exit for partial buffers
 */
export class ClickHouseWideEventWriter {
  private buffer: WideEventRow[] = [];
  private readonly BATCH_SIZE = 1000;
  // Background insert Promises — auto-flush batches are fire-and-forget so they
  // never block the stdout processing loop. flush() awaits all of them before
  // inserting the final partial batch.
  private pendingInserts: Promise<void>[] = [];

  /**
   * Accumulates a wide event row. When the buffer reaches BATCH_SIZE the insert
   * is started in the background (non-blocking). Callers must NOT await this —
   * call flush() on close to ensure all rows are written.
   */
  push(row: WideEventRow): void {
    this.buffer.push(row);
    if (this.buffer.length >= this.BATCH_SIZE) {
      const p = this.insertBatch(this.buffer.splice(0, this.BATCH_SIZE)).catch((err) => {
        console.error('[ClickHouseWriter] background insert failed:', err?.message ?? err);
      });
      this.pendingInserts.push(p);
    }
  }

  /**
   * Awaits all background inserts then flushes any remaining buffered rows.
   * MUST be called on stream close before sending promotion_complete.
   */
  async flush(): Promise<void> {
    // Drain all background inserts first so we don't lose rows.
    if (this.pendingInserts.length > 0) {
      await Promise.allSettled(this.pendingInserts);
      this.pendingInserts = [];
    }
    if (this.buffer.length === 0) return;
    await this.insertBatch(this.buffer.splice(0));
  }

  /**
   * Issues a single ALTER TABLE ... DELETE mutation for the given run_ids within a session.
   * Uses a single IN(...) clause — NEVER issues per-run loops.
   * Noop if runIds is empty.
   */
  async bulkDeleteBeforeInsert(sessionId: string, runIds: string[]): Promise<void> {
    if (runIds.length === 0) return;
    await chClient.command({
      query: `ALTER TABLE ${database}.sweep_wide_events DELETE WHERE session_id = {sessionId:UUID} AND run_id IN ({runIds:Array(UUID)})`,
      query_params: { sessionId, runIds },
    });
  }

  private async insertBatch(rows: WideEventRow[]): Promise<void> {
    if (rows.length === 0) return;
    await chClient.insert<WideEventRow>({
      table: `${database}.sweep_wide_events`,
      values: rows,
      format: 'JSONEachRow',
      clickhouse_settings: {
        // Accept ISO 8601 timestamp strings with 'T' and 'Z' emitted by the Go engine.
        date_time_input_format: 'best_effort',
      },
    });
  }
}
