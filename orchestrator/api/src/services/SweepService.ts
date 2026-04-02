/**
 * SweepService — Cartesian product generation, Pre-Flight bridge, and smart pruning.
 *
 * Core pipeline:
 *   1. calculateCombinationCount ← O(k) guard
 *   2. expandRangeToValues ← decimal.js step arithmetic
 *   3. buildCartesianProduct ← iterative reduce+flatMap
 *   4. invokeBatchPreFlight ← spawn Go engine --batch-preflight
 *   5. pruneConfigs ← apply exchange + user constraints
 */

import Decimal from 'decimal.js';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  SweepParameter,
  SweepDefinition,
  GeneratedConfig,
  PrunedConfig,
  PruneReason,
  PruningResult,
  PreFlightSummary,
  SweepCountResponse,
} from '../types/optimizer.js';

export class SweepService {
  private binaryPath: string;

  constructor(binaryPath: string) {
    this.binaryPath = binaryPath;

    // Use .exe when present on Windows-style setups where env/path omits extension.
    if (!fs.existsSync(this.binaryPath) && fs.existsSync(`${this.binaryPath}.exe`)) {
      this.binaryPath = `${this.binaryPath}.exe`;
    }
  }

  getBinaryPath(): string {
    return this.binaryPath;
  }

  // ── 1. Combination Count (O(k)) ─────────────────────────────────────────

  calculateCombinationCount(params: SweepParameter[]): SweepCountResponse {
    let count = 1;
    for (const p of params) {
      if (p.mode === 'sweep') {
        const values = this.resolveValues(p);
        count *= values.length;
      }
    }
    return { count, overLimit: false };
  }

  // ── 2. Range Expansion (decimal.js) ──────────────────────────────────────

  expandRangeToValues(start: string, end: string, step: string): string[] {
    const s = new Decimal(start);
    const e = new Decimal(end);
    const st = new Decimal(step);

    if (s.equals(e)) return [s.toString()];
    if (st.lte(0)) throw new Error('Step must be positive');
    if (s.gt(e)) throw new Error('Start must be <= end for positive step');

    const values: string[] = [];
    let current = s;
    while (current.lte(e)) {
      values.push(current.toString());
      current = current.plus(st);
    }
    return values;
  }

  // ── 3. Cartesian Product ─────────────────────────────────────────────────

  buildCartesianProduct(definition: SweepDefinition): GeneratedConfig[] {
    const sweptEntries: { name: string; values: string[] }[] = [];
    const fixedEntries: { name: string; value: string }[] = [];

    for (const p of definition.parameters) {
      if (p.mode === 'sweep') {
        sweptEntries.push({ name: p.name, values: this.resolveValues(p) });
      } else {
        fixedEntries.push({ name: p.name, value: p.fixedValue ?? '' });
      }
    }

    // Build Cartesian product using iterative reduce+flatMap (no recursion).
    let combos: Record<string, string>[] = [{}];
    for (const entry of sweptEntries) {
      combos = combos.flatMap((combo) =>
        entry.values.map((v) => ({ ...combo, [entry.name]: v }))
      );
    }

    // Merge fixed values into each combo and build GeneratedConfig objects.
    return combos.map((combo) => {
      const merged: Record<string, string> = { ...combo };
      for (const f of fixedEntries) {
        merged[f.name] = f.value;
      }
      return this.buildGeneratedConfig(merged, definition);
    });
  }

  // ── 4. Batch Pre-Flight ──────────────────────────────────────────────────

  async invokeBatchPreFlight(
    configs: GeneratedConfig[]
  ): Promise<Map<string, PreFlightSummary>> {
    // Write configs to a temp file.
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `preflight-${randomUUID()}.json`);

    const batchInput = configs.map((c) => ({
      run_id: c.run_id,
      trading_pair: c.trading_pair,
      start_date: c.start_date,
      end_date: c.end_date,
      price_entry: c.price_entry,
      price_scale: c.price_scale,
      amount_scale: c.amount_scale,
      number_of_orders: typeof c.number_of_orders === 'string'
        ? parseInt(c.number_of_orders, 10)
        : c.number_of_orders,
      amount_per_trade: c.amount_per_trade,
      margin_type: c.margin_type,
      multiplier: typeof c.multiplier === 'string'
        ? parseInt(c.multiplier, 10)
        : c.multiplier,
      take_profit_distance_percent: c.take_profit_distance_percent,
      monthly_addition: c.monthly_addition ?? '0',
      account_balance: c.account_balance,
      exit_on_last_order: c.exit_on_last_order,
      clickhouse_addr: c.clickhouse_addr || '',
      clickhouse_db: c.clickhouse_db || '',
      clickhouse_user: c.clickhouse_user || '',
      clickhouse_password: c.clickhouse_password || '',
      idempotency_key: c.run_id,
    }));

    fs.writeFileSync(tmpFile, JSON.stringify(batchInput));

    try {
      const output = await this.spawnEngine(['--batch-preflight', tmpFile]);
      const results: PreFlightSummary[] = JSON.parse(output);
      const map = new Map<string, PreFlightSummary>();
      for (const r of results) {
        map.set(r.run_id, r);
      }
      return map;
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  // ── 5. Smart Pruning ─────────────────────────────────────────────────────

  pruneConfigs(
    configs: GeneratedConfig[],
    preFlightMap: Map<string, PreFlightSummary>,
    accountBalance: string
  ): PruningResult {
    const balance = new Decimal(accountBalance);
    const minBaseOrder = new Decimal('10'); // exchange minimum

    const validConfigs: GeneratedConfig[] = [];
    const prunedConfigs: PrunedConfig[] = [];

    for (const cfg of configs) {
      const pf = preFlightMap.get(cfg.run_id);

      // T031(b): guaranteed_fee_loss — TP distance ≤ 0.2% makes take-profit unreachable after fees.
      if (new Decimal(cfg.take_profit_distance_percent).lte(new Decimal('0.2'))) {
        prunedConfigs.push({
          run_id: cfg.run_id,
          reason: 'guaranteed_fee_loss' as PruneReason,
          detail: `TP distance ${cfg.take_profit_distance_percent}% ≤ 0.2% fee threshold`,
        });
        continue;
      }

      // Check base order minimum.
      const baseOrderAmount = this.computeBaseOrderAmount(cfg, balance);
      if (baseOrderAmount.lt(minBaseOrder)) {
        prunedConfigs.push({
          run_id: cfg.run_id,
          reason: 'base_order_below_minimum' as PruneReason,
          detail: `Base order $${baseOrderAmount.toFixed(8)} < minimum $10`,
        });
        continue;
      }

      // Check capital exceeds balance.
      if (pf) {
        const totalCapital = new Decimal(pf.total_capital_required);
        if (totalCapital.gt(balance)) {
          prunedConfigs.push({
            run_id: cfg.run_id,
            reason: 'capital_exceeds_balance' as PruneReason,
            detail: `Capital required $${pf.total_capital_required} > balance $${accountBalance}`,
          });
          continue;
        }
      }

      // T031(c): exceeds_100_percent_drawdown — drawdown ≤ -100% means full account wipeout.
      if (pf && new Decimal(pf.max_drawdown_covered_pct).lte(new Decimal('-100'))) {
        prunedConfigs.push({
          run_id: cfg.run_id,
          reason: 'exceeds_100_percent_drawdown' as PruneReason,
          detail: `Max drawdown ${pf.max_drawdown_covered_pct}% ≤ -100%; account would be wiped`,
        });
        continue;
      }

      // T031(d): tick_size_violation — any consecutive ladder price gap < 0.1%.
      if (pf && pf.ladder.length > 1) {
        let violated = false;
        for (let i = 1; i < pf.ladder.length; i++) {
          const prev = new Decimal(pf.ladder[i - 1].trigger_price);
          const curr = new Decimal(pf.ladder[i].trigger_price);
          if (prev.gt(0)) {
            const gap = prev.minus(curr).div(prev).mul(100).abs();
            if (gap.lt(new Decimal('0.1'))) {
              violated = true;
              break;
            }
          }
        }
        if (violated) {
          prunedConfigs.push({
            run_id: cfg.run_id,
            reason: 'tick_size_violation' as PruneReason,
            detail: 'Consecutive ladder entries have price gap < 0.1% (tick size too small)',
          });
          continue;
        }
      }

      validConfigs.push(cfg);
    }

    // T031–T035 (US6): compute per-reason breakdown — all 5 keys always present.
    const pruneReasons = {
      capital_exceeds_balance: prunedConfigs.filter(c => c.reason === 'capital_exceeds_balance').length,
      base_order_below_minimum: prunedConfigs.filter(c => c.reason === 'base_order_below_minimum').length,
      guaranteed_fee_loss: prunedConfigs.filter(c => c.reason === 'guaranteed_fee_loss').length,
      exceeds_100_percent_drawdown: prunedConfigs.filter(c => c.reason === 'exceeds_100_percent_drawdown').length,
      tick_size_violation: prunedConfigs.filter(c => c.reason === 'tick_size_violation').length,
    };

    return {
      generated: configs.length,
      pruned: prunedConfigs.length,
      valid: validConfigs.length,
      validConfigs,
      prunedConfigs,
      pruneReasons,
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private resolveValues(param: SweepParameter): string[] {
    if (param.values && param.values.length > 0) {
      return param.values;
    }
    if (param.range) {
      return this.expandRangeToValues(
        param.range.start,
        param.range.end,
        param.range.step
      );
    }
    return param.fixedValue ? [param.fixedValue] : [];
  }

  private buildGeneratedConfig(
    params: Record<string, string>,
    definition: SweepDefinition
  ): GeneratedConfig {
    return {
      run_id: randomUUID(),
      trading_pair: definition.fixedParams.trading_pair,
      start_date: definition.fixedParams.start_date,
      end_date: definition.fixedParams.end_date,
      price_entry: params['price_entry'] ?? '2.0',
      price_scale: params['price_scale'] ?? '1.1',
      amount_scale: params['amount_scale'] ?? '2.0',
      number_of_orders: parseInt(params['number_of_orders'] ?? '10', 10),
      amount_per_trade: params['amount_per_trade'] ?? '1000',
      margin_type: definition.fixedParams.margin_type,
      multiplier: parseInt(params['multiplier'] ?? '1', 10),
      take_profit_distance_percent: params['take_profit_distance_percent'] ?? '0.5',
      monthly_addition: params['monthly_addition'] ?? '0',
      account_balance: definition.accountBalance,
      exit_on_last_order: definition.fixedParams.exit_on_last_order,
      clickhouse_addr: definition.fixedParams.clickhouse_addr,
      clickhouse_db: definition.fixedParams.clickhouse_db,
      clickhouse_user: definition.fixedParams.clickhouse_user,
      clickhouse_password: definition.fixedParams.clickhouse_password,
    };
  }

  private computeBaseOrderAmount(cfg: GeneratedConfig, accountBalance: Decimal): Decimal {
    const one = new Decimal('1');
    const amountPerTrade = new Decimal(cfg.amount_per_trade);
    const amountScale = new Decimal(cfg.amount_scale);
    const orders = new Decimal(cfg.number_of_orders);
    const multiplier = new Decimal(cfg.multiplier);

    // Match core-engine semantics: <= 1.0 means percentage of dynamic balance.
    const totalVolume = amountPerTrade.lte(one)
      ? accountBalance.mul(amountPerTrade).mul(multiplier)
      : amountPerTrade.mul(multiplier);

    const normalization = amountScale.eq(one)
      ? orders
      : amountScale.pow(orders).minus(one).div(amountScale.minus(one));

    if (normalization.lte(0)) {
      return new Decimal(0);
    }

    return totalVolume.div(normalization);
  }

  private spawnEngine(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.binaryPath, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on('close', (code: number | null) => {
        if (code !== 0) {
          reject(new Error(`Engine exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });
      proc.on('error', (err: Error) => reject(err));
    });
  }
}
