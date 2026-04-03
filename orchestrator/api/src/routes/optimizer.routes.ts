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
import { SweepService, writeJsonArrayToFile } from '../services/SweepService.js';
import { OptimizerSessionStore } from '../services/OptimizerSessionStore.js';
import { SweepPersistenceService } from '../services/SweepPersistenceService.js';
import { ClickHouseWideEventWriter, WideEventRow } from '../services/ClickHouseWideEventWriter.js';
import { chClient, database } from '../services/ClickHouseClient.js';
import { randomUUID } from 'crypto';
import type { SweepDefinition, OptimizerSession, GeneratedConfig } from '../types/optimizer.js';

// Hard cap on GENERATED combinations before Cartesian expansion.
// buildCartesianProduct allocates ~1 KB per combo in JS heap; beyond ~2 M
// the process runs out of memory before pre-flight even starts.
const MAX_SWEEP_COMBINATIONS = 2_000_000;

// Hard cap on VALID configs after all pruning.
// The Go engine executes each valid config as a full backtest; the execute
// route streams results, Postgres persists them, and the leaderboard renders
// them — 50k valid runs is a very large sweep and takes significant time.
const MAX_VALID_CONFIGS = 500_000;

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

  // 018: Active promotion processes keyed by sessionId.
  const activePromotions = new Map<string, {
    child: ReturnType<typeof spawn>;
    sseRes: Response;
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

      // Step 1: O(k) count check — reject if too many to even expand in memory.
      // buildCartesianProduct allocates ~1 KB per combo; beyond ~2 M combos the
      // JS heap itself overflows. This cap is on GENERATED combos (cheap check).
      const sweepCount = sweepService.calculateCombinationCount(normalizedDefinition.parameters);
      if (sweepCount.count > MAX_SWEEP_COMBINATIONS) {
        return res.status(400).json({
          error: `Sweep generates ${sweepCount.count.toLocaleString()} combinations, which exceeds the maximum of ${MAX_SWEEP_COMBINATIONS.toLocaleString()}. Reduce parameter ranges or increase step sizes.`,
          count: sweepCount.count,
          limit: MAX_SWEEP_COMBINATIONS,
        });
      }

      // Step 2: Cartesian expansion.
      const configs = sweepService.buildCartesianProduct(normalizedDefinition);

      // Step 3: Batch Pre-Flight — JS-fast-preprune runs first (fee loss + base order),
      // then only configs that need ladder computation are sent to Go.
      // Go emits NDJSON so the result is parsed line-by-line; no giant string.
      const preFlightMap = await sweepService.invokeBatchPreFlight(configs, normalizedDefinition.accountBalance);

      // Step 4: Prune remaining configs (capital, drawdown, tick-size checks).
      const pruningResult = sweepService.pruneConfigs(
        configs,
        preFlightMap,
        normalizedDefinition.accountBalance
      );

      // Step 4b: Cap on VALID configs — apply after pruning so large gen-sets
      // that prune down to a small valid set are never rejected unfairly.
      if (pruningResult.valid > MAX_VALID_CONFIGS) {
        return res.status(400).json({
          error: `After pruning, ${pruningResult.valid.toLocaleString()} valid configurations remain, which exceeds the maximum of ${MAX_VALID_CONFIGS.toLocaleString()}. Add more restrictive parameter ranges or reduce step resolution.`,
          generated: pruningResult.generated,
          valid: pruningResult.valid,
          limit: MAX_VALID_CONFIGS,
        });
      }

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
        // Only return the swept-param fields needed by the frontend heatmap.
        // Never expose ClickHouse credentials or fixed infrastructure params.
        validConfigs: pruningResult.validConfigs.map(({ run_id, price_entry, price_scale, amount_scale, number_of_orders, amount_per_trade, multiplier, take_profit_distance_percent, monthly_addition }) => ({
          run_id, price_entry, price_scale, amount_scale, number_of_orders, amount_per_trade, multiplier, take_profit_distance_percent, monthly_addition,
        })),
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
    // Stream-write to avoid V8 string length crash on large sweeps.
    writeJsonArrayToFile(tmpFile, batchConfigs);

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

    // Kill active promotion if running
    const promoProc = activePromotions.get(sessionId);
    if (promoProc) {
      promoProc.child.kill('SIGTERM');
      activePromotions.delete(sessionId);
    }

    sessionStore.update(sessionId, { phase: 'cancelled' });
    sessionStore.delete(sessionId);

    // Drop ClickHouse partition for this session
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(sessionId)) {
        await chClient.command({
          query: `ALTER TABLE ${database}.sweep_wide_events DROP PARTITION '${sessionId}'`,
        });
      }
    } catch (e: any) {
      console.error(`[optimizer] ClickHouse partition drop failed: ${e?.message}`);
    }

    res.status(204).end();
  });

  // ─── 018: Batch Promotion Routes ─────────────────────────────────────────────

  // POST /session/:sessionId/promote — Batch promote runs to ClickHouse with SSE progress
  router.post('/session/:sessionId/promote', async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.params.sessionId as string;

    // Validate body
    const { run_ids } = req.body ?? {};
    if (!Array.isArray(run_ids) || run_ids.length === 0) {
      res.status(400).json({ error: 'run_ids array is required and must be non-empty' });
      return;
    }
    if (run_ids.length > 200) {
      res.status(400).json({ error: `run_ids count ${run_ids.length} exceeds cap of 200` });
      return;
    }

    // Check concurrent promotion
    if (activePromotions.has(sessionId)) {
      res.status(409).json({ error: 'Promotion already in progress for this session' });
      return;
    }

    if (!sweepPersistence) {
      res.status(503).json({ error: 'Persistence not configured' });
      return;
    }

    // Retrieve run summaries from Postgres (server-side config retrieval)
    const summaries = await sweepPersistence.getRunSummaries(sessionId);
    if (summaries.length === 0) {
      res.status(404).json({ error: 'Session not found or has no runs' });
      return;
    }

    const summaryMap = new Map(summaries.map(s => [s.runId, s]));
    const validRunIds = run_ids.filter((id: string) => summaryMap.has(id));
    if (validRunIds.length === 0) {
      res.status(400).json({ error: 'No valid run_ids found for this session' });
      return;
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    // Bulk pre-delete for re-promoted runs
    const alreadyPromotedIds = validRunIds.filter((id: string) => summaryMap.get(id)?.promotedAt != null);
    const writer = new ClickHouseWideEventWriter();
    try {
      if (alreadyPromotedIds.length > 0) {
        await writer.bulkDeleteBeforeInsert(sessionId, alreadyPromotedIds);
      }
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'promotion_error', run_id: '', error: `ClickHouse pre-delete failed: ${err.message}` })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'promotion_complete', completed: 0, failed: validRunIds.length })}\n\n`);
      res.end();
      return;
    }

    // Build batch config for the Go engine
    const chSettings = resolveClickHouseFromEnv();
    const batchConfigs = validRunIds.map((runId: string) => {
      const summary = summaryMap.get(runId)!;
      const config = summary.configJson as Record<string, unknown>;
      return {
        run_id: runId,
        ...config,
        ...chSettings,
        wide_events_to_stdout: true,
      };
    });

    // Write config to temp file
    const tmpFilePath = join(tmpdir(), `promote-${sessionId}-${Date.now()}.json`);
    writeFileSync(tmpFilePath, JSON.stringify(batchConfigs));

    // Spawn engine
    const enginePath = sweepService.getBinaryPath();
    const child = spawn(enginePath, ['--batch-config', tmpFilePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    activePromotions.set(sessionId, { child, sseRes: res });

    let completed = 0;
    let failed = 0;
    let lineBuffer = '';

    child.stdout.on('data', async (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'wide_event') {
            // Push wide event to ClickHouse writer — fire-and-forget; the ClickHouse
            // insert runs in the background so result lines are never blocked.
            const row: WideEventRow = {
              session_id: sessionId,
              run_id: parsed.run_id ?? '',
              schema_version: parsed.schema_version ?? 1,
              trade_id: parsed.trade_id ?? '',
              timestamp: parsed.timestamp ?? '',
              event_type: parsed.event_type ?? '',
              symbol: parsed.symbol ?? '',
              candle_open: String(parsed.candle_open ?? 0),
              candle_high: String(parsed.candle_high ?? 0),
              candle_low: String(parsed.candle_low ?? 0),
              candle_close: String(parsed.candle_close ?? 0),
              candle_volume: String(parsed.candle_volume ?? 0),
              running_account_balance: String(parsed.running_account_balance ?? 0),
              global_candle_count: parsed.global_candle_count ?? 0,
              position_state: parsed.position_state ?? '',
              average_entry_price: String(parsed.average_entry_price ?? 0),
              position_quantity: String(parsed.position_quantity ?? 0),
              total_capital_deployed: String(parsed.total_capital_deployed ?? 0),
              fees_accumulated: String(parsed.fees_accumulated ?? 0),
              take_profit_price: String(parsed.take_profit_price ?? 0),
              liquidation_price: String(parsed.liquidation_price ?? 0),
              filled_orders_count: parsed.filled_orders_count ?? 0,
              unrealized_pnl: String(parsed.unrealized_pnl ?? 0),
              current_drawdown_pct: String(parsed.current_drawdown_pct ?? 0),
              action_price: String(parsed.action_price ?? 0),
              action_quantity: String(parsed.action_quantity ?? 0),
              action_fee: String(parsed.action_fee ?? 0),
              order_number: parsed.order_number ?? 0,
            };
            writer.push(row);
          } else if (parsed.type === 'result') {
            // Persist KPIs + set promotedAt
            completed++;
            try {
              const summary = summaryMap.get(parsed.run_id);
              if (summary && sweepPersistence) {
                await sweepPersistence.setPromotedAt(parsed.run_id);
              }
            } catch (e: any) {
              console.error(`[promote] persistPromotedAt failed for ${parsed.run_id}: ${e?.message}`);
            }
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ type: 'promotion_progress', completed, total: validRunIds.length })}\n\n`);
            }
          } else if (parsed.type === 'error') {
            failed++;
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ type: 'promotion_error', run_id: parsed.run_id, error: parsed.error })}\n\n`);
            }
          }
        } catch { /* skip malformed lines */ }
      }
    });

    child.on('close', async () => {
      // Flush-on-exit: ensure all buffered rows are written
      try {
        await writer.flush();
      } catch (e: any) {
        console.error(`[promote] flush-on-exit failed: ${e?.message}`);
      }

      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'promotion_complete', completed, failed })}\n\n`);
        res.end();
      }

      activePromotions.delete(sessionId);

      // Cleanup temp file
      try { unlinkSync(tmpFilePath); } catch { /* best effort */ }
    });

    child.on('error', (err) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'promotion_error', run_id: '', error: `Engine spawn failed: ${err.message}` })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'promotion_complete', completed, failed: validRunIds.length - completed })}\n\n`);
        res.end();
      }
      activePromotions.delete(sessionId);
    });

    // Handle client disconnect
    req.on('close', () => {
      if (activePromotions.has(sessionId)) {
        child.kill('SIGTERM');
        activePromotions.delete(sessionId);
      }
    });
  });

  // DELETE /session/:sessionId/promote — Cancel active promotion
  router.delete('/session/:sessionId/promote', async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.params.sessionId as string;
    const promo = activePromotions.get(sessionId);
    if (!promo) {
      res.status(404).json({ error: 'No active promotion for this session' });
      return;
    }
    promo.child.kill('SIGTERM');
    if (!promo.sseRes.writableEnded) {
      promo.sseRes.write(`data: ${JSON.stringify({ type: 'promotion_cancelled', completed: 0, total: 0 })}\n\n`);
      promo.sseRes.end();
    }
    activePromotions.delete(sessionId);
    res.status(204).end();
  });

  return router;
}
