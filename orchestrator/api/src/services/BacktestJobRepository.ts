/**
 * BacktestJobRepository (T009)
 *
 * All database operations for the `backtests` table.
 *
 * Constitution requirements enforced here:
 * - claimNext()  → atomic UPDATE … FOR UPDATE SKIP LOCKED (prevents double-claiming)
 * - listWithoutBlobs() → excludes `trades` and `safetyOrders` JSONB columns (select omission, FR-017)
 */

import { eq, sql, desc, and, gte, lte } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm';
import { db } from '../db/client.js';
import { backtests, type BacktestRow } from '../db/schema.js';
import type { ApiBacktestRequest, StoredPnlSummary, StoredTradeEvent, ProgressLine, SafetyOrderUsageEntry } from '../types/index.js';

export type { BacktestRow };

export class BacktestJobRepository {
  /**
   * Persist a new pending job and return the created row.
   */
  async create(config: ApiBacktestRequest): Promise<BacktestRow> {
    const [row] = await db
      .insert(backtests)
      .values({ config, status: 'pending' })
      .returning();
    return row;
  }

  /**
   * Persist an already-computed run directly as `completed`.
   * Used by optimizer batch execution so rows are written atomically without
   * entering the pending/running worker queue lifecycle.
   */
  async createCompletedFromResult(
    config: ApiBacktestRequest,
    summary: StoredPnlSummary,
    trades: StoredTradeEvent[],
    safetyOrders: SafetyOrderUsageEntry[],
    executionTimeMs: number,
  ): Promise<BacktestRow> {
    const [row] = await db
      .insert(backtests)
      .values({
        status: 'completed',
        config,
        summary,
        trades,
        safetyOrders,
        executionTimeMs,
        progress: 100,
        currentMetrics: null,
      })
      .returning();
    return row;
  }

  /**
   * Fetch a single job by UUID. Returns null if not found.
   */
  async findById(id: string): Promise<BacktestRow | null> {
    const [row] = await db
      .select()
      .from(backtests)
      .where(eq(backtests.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * List jobs WITHOUT the heavy `trades` and `safetyOrders` JSONB columns.
   *
   * Uses drizzle's `getTableColumns()` destructure pattern (FR-017 select omission).
   * This prevents multi-MB JSONB blobs from being serialised on list queries.
   */
  async listWithoutBlobs(options: {
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  } = {}): Promise<Omit<BacktestRow, 'trades' | 'safetyOrders'>[]> {
    // Destructure out the heavy columns — only listed cols are sent in SELECT
    const { trades, safetyOrders, ...listCols } = getTableColumns(backtests);

    const conditions = [];
    if (options.from)  conditions.push(gte(backtests.createdAt, options.from));
    if (options.to)    conditions.push(lte(backtests.createdAt, options.to));

    const query = db
      .select(listCols)
      .from(backtests)
      .orderBy(desc(backtests.createdAt))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  /**
   * Atomically claim the next pending job for a worker.
   *
   * Uses UPDATE … FOR UPDATE SKIP LOCKED so multiple workers never claim the
   * same row, even under concurrent load. Returns null if no pending jobs exist.
   */
  async claimNext(): Promise<BacktestRow | null> {
    const result = await db.execute(sql`
      UPDATE backtests
      SET    status     = 'running',
             updated_at = now()
      WHERE  id = (
        SELECT id
        FROM   backtests
        WHERE  status = 'pending'
        ORDER  BY created_at ASC
        LIMIT  1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as Record<string, unknown>;
    // pg returns snake_case column names; map to camelCase to match BacktestRow
    return {
      id:              row['id'] as string,
      status:          row['status'] as BacktestRow['status'],
      config:          row['config'] as ApiBacktestRequest,
      summary:         row['summary'] as StoredPnlSummary | null,
      trades:          row['trades'] as StoredTradeEvent[] | null,
      safetyOrders:    row['safety_orders'] as SafetyOrderUsageEntry[] | null,
      executionTimeMs: row['execution_time_ms'] as number | null,
      errorMessage:    row['error_message'] as string | null,
      progress:        (row['progress'] as number) ?? 0,
      currentMetrics:  (row['current_metrics'] as ProgressLine | null) ?? null,
      createdAt:       row['created_at'] as Date,
      updatedAt:       row['updated_at'] as Date,
    };
  }

  /**
   * Update the in-flight progress percent and optional current metrics snapshot.
   * Clamps percent to [0, 100] and floors to integer to keep the DB column clean.
   */
  async updateProgress(id: string, percent: number, metrics?: ProgressLine): Promise<void> {
    await db
      .update(backtests)
      .set({
        progress: Math.max(0, Math.min(100, Math.floor(percent))),
        ...(metrics ? { currentMetrics: metrics } : {}),
        updatedAt: new Date(),
      })
      .where(eq(backtests.id, id));
  }

  /**
   * Transition a job to `completed` and store the result data.
   * safetyOrders accepts the typed SafetyOrderUsageEntry[] from the engine result.
   */
  async markCompleted(
    id: string,
    summary: StoredPnlSummary,
    trades: StoredTradeEvent[],
    safetyOrders: SafetyOrderUsageEntry[],
    executionTimeMs: number,
  ): Promise<void> {
    await db
      .update(backtests)
      .set({
        status:          'completed',
        summary,
        trades,
        safetyOrders,
        executionTimeMs,
        progress:        100,
        currentMetrics:  null,
        updatedAt:       new Date(),
      })
      .where(eq(backtests.id, id));
  }

  /**
   * Transition a job to `failed` and capture the engine stderr.
   */
  async markFailed(id: string, errorMessage: string): Promise<void> {
    await db
      .update(backtests)
      .set({
        status:       'failed',
        errorMessage,
        updatedAt:    new Date(),
      })
      .where(eq(backtests.id, id));
  }
}
