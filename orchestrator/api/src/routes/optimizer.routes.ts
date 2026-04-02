/**
 * Optimizer Routes (T017)
 *
 * POST /optimizer/sweep/count — Calculate combination count without allocating configs
 * POST /optimizer/sweep       — Expand + Pre-Flight + Prune → return valid configs + session
 * POST /optimizer/session/:sessionId/execute — SSE stream batch execution results
 * DELETE /optimizer/session/:sessionId — Cancel and delete session
 */

import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { SweepService } from '../services/SweepService.js';
import { OptimizerSessionStore } from '../services/OptimizerSessionStore.js';
import { SweepPersistenceService } from '../services/SweepPersistenceService.js';
import { randomUUID } from 'crypto';
import type { SweepDefinition, OptimizerSession, GeneratedConfig } from '../types/optimizer.js';

// T079: Non-blocking route tracer. Returns no-op spans when no SDK provider is registered.
const routeTracer = trace.getTracer('dca-bot.optimizer-routes', '1.0.0');

export function createOptimizerRouter(
  sweepService: SweepService,
  sessionStore: OptimizerSessionStore,
  sweepPersistence?: SweepPersistenceService,
): Router {
  const router = Router();

  const resolveClickHouseFromEnv = () => ({
    clickhouse_addr: `${process.env.CLICKHOUSE_HOST ?? 'localhost'}:${process.env.CLICKHOUSE_NATIVE_PORT ?? '9000'}`,
    clickhouse_db: process.env.CLICKHOUSE_DATABASE ?? 'data',
    clickhouse_user: process.env.CLICKHOUSE_USER ?? 'default',
    clickhouse_password: process.env.CLICKHOUSE_PASSWORD ?? '',
  });

  // T063: Active engine processes keyed by sessionId — shared between execute and DELETE routes.
  const activeProcesses = new Map<string, {
    child: ReturnType<typeof spawn>;
    sseRes: Response;
    cancelledAt: number | null;
    execStartTime: number;
    completedCount: number;
    maxRoi: number | null;
    totalConfigs: number;
  }>();

  // POST /sweep/count — O(k) combination count check
  router.post('/sweep/count', (req: Request, res: Response) => {
    try {
      const { parameters } = req.body;
      if (!parameters || !Array.isArray(parameters)) {
        return res.status(400).json({ error: 'parameters array is required' });
      }
      const result = sweepService.calculateCombinationCount(parameters);
      if (result.overLimit) {
        return res.status(400).json({
          error: `Combination count ${result.count} exceeds limit of 10,000`,
          count: result.count,
          overLimit: true,
        });
      }
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /sweep — Full pipeline: count → expand → Pre-Flight → prune → create session
  router.post('/sweep', async (req: Request, res: Response) => {
    try {
      // Guard: only one sweep at a time.
      if (sessionStore.hasRunningSession()) {
        return res.status(409).json({
          error: 'A sweep is already running. Cancel it before launching a new one.',
        });
      }

      const definition: SweepDefinition = req.body;
      if (!definition.parameters || !Array.isArray(definition.parameters)) {
        return res.status(400).json({ error: 'parameters array is required' });
      }

      // Server-side source of truth for infrastructure credentials.
      // Ignore frontend-provided ClickHouse connection fields and enforce .env values.
      const ch = resolveClickHouseFromEnv();
      const normalizedDefinition: SweepDefinition = {
        ...definition,
        fixedParams: {
          ...definition.fixedParams,
          clickhouse_addr: ch.clickhouse_addr,
          clickhouse_db: ch.clickhouse_db,
          clickhouse_user: ch.clickhouse_user,
          clickhouse_password: ch.clickhouse_password,
        },
      };

      // Step 1: Count (informational only — no hard limit enforced).
      const countResult = sweepService.calculateCombinationCount(normalizedDefinition.parameters);

      // Step 2: Cartesian expansion.
      const configs = sweepService.buildCartesianProduct(normalizedDefinition);

      // Step 3: Batch Pre-Flight.
      const preFlightMap = await sweepService.invokeBatchPreFlight(configs);

      // Step 4: Prune.
      const pruningResult = sweepService.pruneConfigs(
        configs,
        preFlightMap,
        normalizedDefinition.accountBalance
      );

      // Step 5: Compute Pre-Flight summary from valid configs.
      let minDrawdown = 0;
      let maxDrawdown = 0;
      let maxCapital = '0';
      for (const cfg of pruningResult.validConfigs) {
        const pf = preFlightMap.get(cfg.run_id);
        if (pf) {
          const dd = parseFloat(pf.max_drawdown_covered_pct);
          if (dd < minDrawdown) minDrawdown = dd;
          if (dd > maxDrawdown || maxDrawdown === 0) maxDrawdown = dd;
          const cap = parseFloat(pf.total_capital_required);
          if (cap > parseFloat(maxCapital)) maxCapital = pf.total_capital_required;
        }
      }

      // Step 6: Create session (store preFlightMap for capital_efficiency computation — T011).
      const sessionId = randomUUID();
      const session: OptimizerSession = {
        sessionId,
        phase: 'validating',
        sweepDefinition: normalizedDefinition,
        validConfigs: pruningResult.validConfigs,
        pruningResult,
        preFlightMap,
        results: [],
        createdAt: new Date(),
      };
      sessionStore.create(session);

      return res.json({
        sessionId,
        pruningResult: {
          generated: pruningResult.generated,
          pruned: pruningResult.pruned,
          valid: pruningResult.valid,
          prunedConfigs: pruningResult.prunedConfigs,
          pruneReasons: pruningResult.pruneReasons,
        },
        validConfigs: pruningResult.validConfigs,
        preFlightSummary: {
          minDrawdown,
          maxDrawdown,
          maxCapital,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /sessions — Paginated list of sweep sessions sorted by created_at DESC (T042)
  router.get('/sessions', async (req: Request, res: Response) => {
    if (!sweepPersistence) {
      return res.status(503).json({ error: 'Persistence not configured' });
    }
    const span = routeTracer.startSpan('optimizer.get_sessions');
    try {
      const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10));
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10)));
      const result = await sweepPersistence.getSessions(page, limit);
      span.setStatus({ code: SpanStatusCode.OK });
      return res.json(result);
    } catch (err: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      return res.status(500).json({ error: err.message });
    } finally {
      span.end();
    }
  });

  // GET /sessions/:id/results — All run summaries for a session (T043)
  router.get('/sessions/:id/results', async (req: Request, res: Response) => {
    if (!sweepPersistence) {
      return res.status(503).json({ error: 'Persistence not configured' });
    }
    const span = routeTracer.startSpan('optimizer.get_session_results');
    try {
      const sessionId = req.params['id'] as string;
      const results = await sweepPersistence.getRunSummaries(sessionId);
      span.setStatus({ code: SpanStatusCode.OK });
      if (results.length === 0) {
        // Verify session exists to distinguish 404 vs empty result set.
        // We still return empty array if session exists but has no results.
        return res.json({ results, count: 0 });
      }
      return res.json({ results, count: results.length });
    } catch (err: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      return res.status(500).json({ error: err.message });
    } finally {
      span.end();
    }
  });

  // POST /session/:sessionId/execute — SSE stream of batch execution results
  router.post('/session/:sessionId/execute', async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.params.sessionId as string;
    const session = sessionStore.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!session.validConfigs || session.validConfigs.length === 0) {
      res.status(400).json({
        error: 'No valid configurations to execute. All generated configs were pruned during pre-flight.',
      });
      return;
    }

    const runConfigMap = new Map<string, GeneratedConfig>(
      session.validConfigs.map((cfg) => [cfg.run_id, cfg])
    );
    const persistenceTasks: Promise<void>[] = [];

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sessionStore.update(sessionId, { phase: 'running' });

    // T028(d): execStartTime initialized BEFORE engine spawn — always defined even if cancelled
    // before the first result arrives.
    const execStartTime = Date.now();

    // T028(b): create DB session record before spawning engine.
    if (sweepPersistence && session.sweepDefinition) {
      try {
        await sweepPersistence.createSession(
          sessionId,
          session.sweepDefinition,
          session.sweepDefinition.fixedParams.trading_pair,
          session.sweepDefinition.fixedParams.start_date,
          session.sweepDefinition.fixedParams.end_date,
        );
      } catch (persistErr: any) {
        console.error(`[optimizer persist] failed to create session ${sessionId}: ${persistErr?.message}`);
        res.write(`data: ${JSON.stringify({ type: 'persistence_error', message: persistErr?.message ?? 'createSession failed' })}\n\n`);
      }
    }

    // Build batch config file for the Go engine
    const batchConfigs = session.validConfigs.map((cfg: GeneratedConfig) => ({
      run_id: cfg.run_id,
      trading_pair: cfg.trading_pair,
      start_date: cfg.start_date,
      end_date: cfg.end_date,
      price_entry: cfg.price_entry,
      price_scale: cfg.price_scale,
      amount_scale: cfg.amount_scale,
      number_of_orders: cfg.number_of_orders,
      amount_per_trade: cfg.amount_per_trade,
      margin_type: cfg.margin_type,
      multiplier: cfg.multiplier,
      take_profit_distance_percent: cfg.take_profit_distance_percent,
      monthly_addition: cfg.monthly_addition ?? '0',
      account_balance: cfg.account_balance,
      exit_on_last_order: cfg.exit_on_last_order,
      clickhouse_addr: cfg.clickhouse_addr,
      clickhouse_db: cfg.clickhouse_db,
      clickhouse_user: cfg.clickhouse_user,
      clickhouse_password: cfg.clickhouse_password,
    }));

    const tmpFile = join(tmpdir(), `dca-batch-${sessionId}.json`);
    writeFileSync(tmpFile, JSON.stringify(batchConfigs));

    const enginePath = sweepService.getBinaryPath();
    const child = spawn(enginePath, ['--batch-config', tmpFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let executionFinished = false;

    // T063: Register procEntry in activeProcesses so DELETE route can kill and write to sseRes.
    const procEntry = {
      child,
      sseRes: res,
      cancelledAt: null as number | null,
      execStartTime,
      completedCount: 0,
      maxRoi: null as number | null,
      totalConfigs: session.validConfigs.length,
    };
    activeProcesses.set(sessionId, procEntry);

    let buffer = '';

    // T028(c): per-result persistence via SweepPersistenceService (replaces backtestJobRepository).
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          sessionStore.addResult(sessionId, event);

          if (event?.type === 'result' && typeof event?.run_id === 'string') {
            procEntry.completedCount++;
            const roi = event?.pnlSummary?.roi;
            if (roi != null && (procEntry.maxRoi === null || roi > procEntry.maxRoi)) {
              procEntry.maxRoi = roi;
            }
            if (sweepPersistence) {
              const cfg = runConfigMap.get(event.run_id);
              const preFlightCapital = session.preFlightMap?.get(event.run_id)?.total_capital_required ?? null;
              const persistTask = sweepPersistence
                .persistRunSummary(sessionId, event, cfg ?? ({} as GeneratedConfig), preFlightCapital)
                .catch((persistErr: any) => {
                  res.write(`data: ${JSON.stringify({ type: 'persistence_error', message: persistErr?.message })}\n\n`);
                });
              persistenceTasks.push(persistTask);
            }
          }

          res.write(`data: ${line}\n\n`);
        } catch { /* skip malformed lines */ }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      // Log stderr but don't fail — engine logs to stderr
      console.error(`[engine stderr] ${chunk.toString().trim()}`);
    });

    child.on('close', async (code) => {
      executionFinished = true;
      activeProcesses.delete(sessionId);

      // Clean up temp file
      try { unlinkSync(tmpFile); } catch { /* ignore */ }

      if (persistenceTasks.length > 0) {
        await Promise.allSettled(persistenceTasks);
      }

      // T028(e): finalize in DB — skip if already cancelled by DELETE or client disconnect.
      if (sweepPersistence && procEntry.cancelledAt === null) {
        try {
          const status = (code !== 0 && code !== null) ? 'failed' : 'completed';
          await sweepPersistence.finalizeSession(
            sessionId,
            status,
            procEntry.maxRoi,
            procEntry.completedCount,
            Date.now() - procEntry.execStartTime,
          );
        } catch (finalizeErr: any) {
          console.error(`[optimizer persist] failed to finalize session ${sessionId}: ${finalizeErr?.message}`);
        }
      }

      // If cancelled externally (DELETE route already wrote cancelled SSE and ended stream).
      if (procEntry.cancelledAt !== null) return;

      if (code !== 0 && code !== null) {
        // Engine crash resilience (T041)
        const errorEvent = JSON.stringify({
          type: 'error',
          message: `Engine process terminated unexpectedly (exit code ${code})`,
        });
        res.write(`data: ${errorEvent}\n\n`);
        sessionStore.update(sessionId, { phase: 'partial' });
      } else {
        sessionStore.update(sessionId, { phase: 'complete' });
      }

      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
      res.end();
    });

    // T029: Handle client disconnect — guard prevents double-cancel when DELETE fires first.
    res.on('close', async () => {
      if (executionFinished) return;
      const proc = activeProcesses.get(sessionId);
      if (!proc || proc.cancelledAt !== null) return;
      proc.cancelledAt = Date.now();
      proc.child.kill('SIGTERM');
      sessionStore.update(sessionId, { phase: 'cancelled' });
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
      if (sweepPersistence) {
        try {
          await sweepPersistence.finalizeSession(
            sessionId,
            'cancelled',
            proc.maxRoi,
            proc.completedCount,
            proc.cancelledAt - proc.execStartTime,
          );
        } catch (e: any) {
          console.error(`[optimizer persist] finalizeSession(cancelled) failed: ${e?.message}`);
        }
      }
    });
  });

  // DELETE /session/:sessionId — Cancel running sweep and delete session
  // T062/T063: Kills engine process, emits cancelled SSE event, persists partial state.
  router.delete('/session/:sessionId', async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.params.sessionId as string;
    const session = sessionStore.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const proc = activeProcesses.get(sessionId);
    if (proc && proc.cancelledAt === null) {
      proc.cancelledAt = Date.now();
      proc.child.kill('SIGTERM');
      // Emit cancelled event to the still-open SSE stream before ending it.
      if (!proc.sseRes.writableEnded) {
        proc.sseRes.write(
          `data: ${JSON.stringify({ type: 'cancelled', completed: proc.completedCount, total: proc.totalConfigs })}\n\n`,
        );
        proc.sseRes.end();
      }
      if (sweepPersistence) {
        try {
          await sweepPersistence.finalizeSession(
            sessionId,
            'cancelled',
            proc.maxRoi,
            proc.completedCount,
            proc.cancelledAt - proc.execStartTime,
          );
        } catch (e: any) {
          console.error(`[optimizer persist] DELETE finalizeSession failed: ${e?.message}`);
        }
      }
      activeProcesses.delete(sessionId);
    }

    sessionStore.update(sessionId, { phase: 'cancelled' });
    sessionStore.delete(sessionId);
    res.status(204).end();
  });

  return router;
}
