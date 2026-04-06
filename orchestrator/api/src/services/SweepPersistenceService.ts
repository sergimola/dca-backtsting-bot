/**
 * SweepPersistenceService (T021–T026)
 *
 * Persists sweep sessions and per-run summaries to PostgreSQL.
 * Uses decimal.js for capital_efficiency calculation (constitution: fixed-point arithmetic).
 * All financial columns stored as numeric(10,4); win_rate as numeric(6,4).
 *
 * FR-008: NO tradeEvents or safetyOrderUsage stored here.
 * FR-009: SweepSession schema.
 * FR-010: SweepRunSummary schema.
 * FR-011: run_id mapped from engine's run_id (= config's idempotency_key); DB generates own UUID PK.
 * FR-012: total_execution_time_ms measured by API (wall-clock).
 * FR-013: CRUD endpoints supported by getSessions, getRunSummaries, deleteSession.
 */

import { db } from '../db/client.js';
import { sweepSessions, sweepRunSummaries } from '../db/schema.js';
import { eq, desc, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { SweepDefinition, SweepHistoryEntry, BatchRunResult } from '../types/optimizer.js';

// T079: Non-blocking tracer. Returns no-op spans when no SDK provider is registered.
const tracer = trace.getTracer('dca-bot.sweep-persistence', '1.0.0');

export interface RunSummaryRow {
  id: string;
  sessionId: string;
  runId: string;
  configJson: unknown;
  roi: string | null;
  maxDrawdown: string | null;
  totalFees: string | null;
  winRate: string | null;
  capitalEfficiency: string | null;
  executionTimeMs: number | null;
  longestTradeDurationMs: number | null;
  maxSafetyOrdersUsed: number | null;
  promotedAt: Date | null;
  createdAt: Date;
}

export interface SessionPage {
  sessions: SweepHistoryEntry[];
  total: number;
  page: number;
  hasMore: boolean;
}

export class SweepPersistenceService {
  // T021: Create a sweep session record with status='running' before execution starts.
  async createSession(
    sessionId: string,
    definition: SweepDefinition,
    tradingPair: string,
    startDate: string,
    endDate: string,
  ): Promise<void> {
    const span = tracer.startSpan('sweep_persistence.create_session');
    try {
      await db.insert(sweepSessions).values({
        id: sessionId,
        tradingPair,
        startDate,
        endDate,
        totalRuns: 0,
        status: 'running',
        configSnapshot: definition as unknown as Record<string, unknown>,
      });
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  }

  // T022: Persist a single run summary. Computes capitalEfficiency via decimal.js.
  // win_rate is null when totalPositionsClosed === 0 (FR-010).
  async persistRunSummary(
    sessionId: string,
    runResult: BatchRunResult,
    configJson: unknown,
    preFlightCapital: string | null,
  ): Promise<void> {
    const span = tracer.startSpan('sweep_persistence.persist_run_summary');
    try {
      const roi = runResult.pnlSummary?.roi ?? null;
      const maxDrawdown = runResult.pnlSummary?.maxDrawdown ?? null;
      const totalFees = runResult.pnlSummary?.totalFees ?? null;

      // win_rate: null when totalPositionsClosed === 0 to prevent divide-by-zero (FR-010).
      const winRate =
        runResult.totalPositionsClosed === 0 || runResult.winRate == null
          ? null
          : runResult.winRate;

      // capital_efficiency = ROI / preFlightCapital * 100 (decimal.js — constitution).
      let capitalEfficiency: number | null = null;
      if (roi != null && preFlightCapital != null) {
        try {
          const capital = new Decimal(preFlightCapital);
          if (capital.isPositive()) {
            capitalEfficiency = new Decimal(roi).div(capital).mul(100).toDecimalPlaces(4).toNumber();
          }
        } catch {
          // malformed capital string — skip computation
        }
      }

      await db.insert(sweepRunSummaries).values({
        id: randomUUID(),
        sessionId,
        runId: runResult.run_id,
        configJson: configJson as Record<string, unknown>,
        roi: roi != null ? String(new Decimal(roi).toDecimalPlaces(4)) : null,
        maxDrawdown: maxDrawdown != null ? String(new Decimal(maxDrawdown).toDecimalPlaces(4)) : null,
        totalFees: totalFees != null ? String(new Decimal(totalFees).toDecimalPlaces(4)) : null,
        winRate: winRate != null ? String(new Decimal(winRate).toDecimalPlaces(4)) : null,
        capitalEfficiency: capitalEfficiency != null ? String(capitalEfficiency) : null,
        executionTimeMs: runResult.executionTimeMs ?? null,
        longestTradeDurationMs: runResult.longest_trade_duration_ms ?? 0,
        maxSafetyOrdersUsed: runResult.max_safety_orders_used ?? 0,
        totalStopsTriggered: runResult.total_stops_triggered ?? 0,
        promotedAt: null,
      });
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  }

  // T023: Finalize a session (completed, cancelled, or failed).
  async finalizeSession(
    sessionId: string,
    status: 'completed' | 'cancelled' | 'failed',
    maxRoi: number | null,
    totalRuns: number,
    totalExecutionTimeMs: number,
  ): Promise<void> {
    const span = tracer.startSpan('sweep_persistence.finalize_session');
    try {
      await db
        .update(sweepSessions)
        .set({
          status,
          totalRuns,
          maxRoi: maxRoi != null ? String(new Decimal(maxRoi).toDecimalPlaces(4)) : null,
          totalExecutionTimeMs,
        })
        .where(eq(sweepSessions.id, sessionId));
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  }

  // T024: Paginated session list sorted by createdAt DESC.
  async getSessions(page: number, limit: number): Promise<SessionPage> {
    const offset = (page - 1) * limit;

    const [rows, totalResult] = await Promise.all([
      db
        .select()
        .from(sweepSessions)
        .orderBy(desc(sweepSessions.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(sweepSessions),
    ]);

    const total = Number(totalResult[0]?.total ?? 0);

    const sessions: SweepHistoryEntry[] = rows.map((r) => ({
      id: r.id,
      tradingPair: r.tradingPair,
      startDate: r.startDate,
      endDate: r.endDate,
      totalRuns: r.totalRuns,
      maxRoi: r.maxRoi != null ? parseFloat(r.maxRoi) : null,
      status: r.status as 'completed' | 'cancelled' | 'running',
      createdAt: r.createdAt.toISOString(),
    }));

    return {
      sessions,
      total,
      page,
      hasMore: offset + rows.length < total,
    };
  }

  // T025: All run summaries for a session.
  async getRunSummaries(sessionId: string): Promise<RunSummaryRow[]> {
    const rows = await db
      .select()
      .from(sweepRunSummaries)
      .where(eq(sweepRunSummaries.sessionId, sessionId));

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      runId: r.runId,
      configJson: r.configJson,
      roi: r.roi,
      maxDrawdown: r.maxDrawdown,
      totalFees: r.totalFees,
      winRate: r.winRate,
      capitalEfficiency: r.capitalEfficiency,
      executionTimeMs: r.executionTimeMs,
      longestTradeDurationMs: r.longestTradeDurationMs,
      maxSafetyOrdersUsed: r.maxSafetyOrdersUsed,
      promotedAt: r.promotedAt,
      createdAt: r.createdAt,
    }));
  }

  // T026: Delete session (cascades to sweep_run_summaries via FK ON DELETE CASCADE).
  async deleteSession(sessionId: string): Promise<void> {
    await db.delete(sweepSessions).where(eq(sweepSessions.id, sessionId));
  }

  // 018: Mark a run as promoted (set promoted_at to now).
  async setPromotedAt(runId: string): Promise<void> {
    await db.update(sweepRunSummaries)
      .set({ promotedAt: new Date() })
      .where(eq(sweepRunSummaries.runId, runId));
  }
}
