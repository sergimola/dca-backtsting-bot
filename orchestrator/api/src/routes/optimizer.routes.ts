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
import { SweepService, SweepLimitExceededError } from '../services/SweepService.js';
import { OptimizerSessionStore } from '../services/OptimizerSessionStore.js';
import { randomUUID } from 'crypto';
import type { SweepDefinition, OptimizerSession, GeneratedConfig } from '../types/optimizer.js';
import { BacktestJobRepository } from '../services/BacktestJobRepository.js';
import type {
  ApiBacktestRequest,
  StoredPnlSummary,
  StoredTradeEvent,
  SafetyOrderUsageEntry,
} from '../types/index.js';

function toApiBacktestRequest(cfg: GeneratedConfig): ApiBacktestRequest {
  return {
    trading_pair: cfg.trading_pair,
    start_date: cfg.start_date,
    end_date: cfg.end_date,
    price_entry: cfg.price_entry,
    price_scale: cfg.price_scale,
    amount_scale: cfg.amount_scale,
    number_of_orders: cfg.number_of_orders,
    amount_per_trade: cfg.amount_per_trade,
    margin_type: cfg.margin_type as 'cross' | 'isolated',
    multiplier: cfg.multiplier,
    take_profit_distance_percent: cfg.take_profit_distance_percent,
    account_balance: cfg.account_balance,
    monthly_addition: cfg.monthly_addition,
    exit_on_last_order: cfg.exit_on_last_order,
    idempotency_key: cfg.run_id,
  };
}

export function createOptimizerRouter(
  sweepService: SweepService,
  sessionStore: OptimizerSessionStore,
  backtestJobRepository?: BacktestJobRepository,
): Router {
  const router = Router();

  const resolveClickHouseFromEnv = () => ({
    clickhouse_addr: `${process.env.CLICKHOUSE_HOST ?? 'localhost'}:${process.env.CLICKHOUSE_NATIVE_PORT ?? '9000'}`,
    clickhouse_db: process.env.CLICKHOUSE_DATABASE ?? 'data',
    clickhouse_user: process.env.CLICKHOUSE_USER ?? 'default',
    clickhouse_password: process.env.CLICKHOUSE_PASSWORD ?? '',
  });

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

      // Step 1: Count check.
      const countResult = sweepService.calculateCombinationCount(normalizedDefinition.parameters);
      if (countResult.overLimit) {
        return res.status(400).json({
          error: `Combination count ${countResult.count} exceeds limit of 10,000`,
          count: countResult.count,
          overLimit: true,
        });
      }

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

      // Step 6: Create session.
      const sessionId = randomUUID();
      const session: OptimizerSession = {
        sessionId,
        phase: 'validating',
        sweepDefinition: normalizedDefinition,
        validConfigs: pruningResult.validConfigs,
        pruningResult,
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
        },
        validConfigs: pruningResult.validConfigs,
        preFlightSummary: {
          minDrawdown,
          maxDrawdown,
          maxCapital,
        },
      });
    } catch (err: any) {
      if (err instanceof SweepLimitExceededError) {
        return res.status(400).json({ error: err.message, count: err.count, overLimit: true });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /session/:sessionId/execute — SSE stream of batch execution results
  router.post('/session/:sessionId/execute', (req: Request, res: Response): void => {
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

    let buffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          sessionStore.addResult(sessionId, event);

          if (backtestJobRepository && event?.type === 'result' && typeof event?.run_id === 'string') {
            const cfg = runConfigMap.get(event.run_id);
            if (cfg) {
              const summary: StoredPnlSummary = {
                roi: Number(event?.pnlSummary?.roi ?? 0),
                maxDrawdown: Number(event?.pnlSummary?.maxDrawdown ?? 0),
                totalFees: Number(event?.pnlSummary?.totalFees ?? 0),
              };
              const tradeEvents = Array.isArray(event?.tradeEvents)
                ? (event.tradeEvents as StoredTradeEvent[])
                : [];
              const safetyOrderUsage = Array.isArray(event?.safetyOrderUsage)
                ? (event.safetyOrderUsage as SafetyOrderUsageEntry[])
                : [];
              const executionTimeMs = Number(event?.executionTimeMs ?? 0);
              const persistTask = backtestJobRepository
                .createCompletedFromResult(
                  toApiBacktestRequest(cfg),
                  summary,
                  tradeEvents,
                  safetyOrderUsage,
                  executionTimeMs,
                )
                .then(() => undefined)
                .catch((persistErr: any) => {
                  console.error(`[optimizer persist] failed to persist run ${event.run_id}: ${persistErr?.message ?? persistErr}`);
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

      // Clean up temp file
      try { unlinkSync(tmpFile); } catch { /* ignore */ }

      if (persistenceTasks.length > 0) {
        await Promise.allSettled(persistenceTasks);
      }

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

    // Handle client disconnect while stream is still in progress.
    res.on('close', () => {
      if (executionFinished) return;
      child.kill('SIGTERM');
      sessionStore.update(sessionId, { phase: 'cancelled' });
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    });
  });

  // DELETE /session/:sessionId — Cancel running sweep and delete session
  router.delete('/session/:sessionId', (req: Request, res: Response) => {
    const sessionId = req.params.sessionId as string;
    const session = sessionStore.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    sessionStore.update(sessionId, { phase: 'cancelled' });
    sessionStore.delete(sessionId);
    return res.json({ status: 'cancelled' });
  });

  return router;
}
