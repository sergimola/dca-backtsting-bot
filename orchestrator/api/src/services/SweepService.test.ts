/**
 * SweepService Unit Tests (T014)
 *
 * Tests combinatorial count, range expansion, Cartesian product, and pruning.
 * No Go binary required — these are pure-logic unit tests.
 */

import { SweepService } from './SweepService.js';
import type {
  SweepParameter,
  SweepDefinition,
  PreFlightSummary,
  PreFlightLadderEntry,
  GeneratedConfig,
} from '../types/optimizer.js';

// Use a dummy binary path — none of these tests invoke it.
const service = new SweepService('/nonexistent/binary');

// ─── calculateCombinationCount ──────────────────────────────────────────────

describe('calculateCombinationCount', () => {
  test('3×2 = 6 combinations', () => {
    const params: SweepParameter[] = [
      { name: 'price_scale', mode: 'sweep', values: ['1.0', '1.5', '2.0'] },
      { name: 'amount_scale', mode: 'sweep', values: ['1.0', '2.0'] },
    ];
    const result = service.calculateCombinationCount(params);
    expect(result.count).toBe(6);
    expect(result.overLimit).toBe(false);
  });

  test('large count: 10,100 → overLimit=false (no hard limit)', () => {
    const params: SweepParameter[] = [
      // 101 × 100 = 10,100 — no limit enforced
      { name: 'price_scale', mode: 'sweep', values: Array.from({ length: 101 }, (_, i) => String(i)) },
      { name: 'amount_scale', mode: 'sweep', values: Array.from({ length: 100 }, (_, i) => String(i)) },
    ];
    const result = service.calculateCombinationCount(params);
    expect(result.count).toBe(10100);
    expect(result.overLimit).toBe(false);
  });

  test('single fixed param = 1', () => {
    const params: SweepParameter[] = [
      { name: 'price_scale', mode: 'fixed', fixedValue: '1.5' },
    ];
    const result = service.calculateCombinationCount(params);
    expect(result.count).toBe(1);
    expect(result.overLimit).toBe(false);
  });

  test('mix of fixed and sweep', () => {
    const params: SweepParameter[] = [
      { name: 'price_entry', mode: 'fixed', fixedValue: '2.0' },
      { name: 'price_scale', mode: 'sweep', values: ['1.0', '1.5'] },
      { name: 'amount_scale', mode: 'sweep', values: ['1.0', '2.0', '3.0'] },
    ];
    const result = service.calculateCombinationCount(params);
    expect(result.count).toBe(6); // 2 × 3
    expect(result.overLimit).toBe(false);
  });
});

// ─── expandRangeToValues ────────────────────────────────────────────────────

describe('expandRangeToValues', () => {
  test('1.0 → 2.0 step 0.5 → [1, 1.5, 2]', () => {
    const values = service.expandRangeToValues('1.0', '2.0', '0.5');
    expect(values).toEqual(['1', '1.5', '2']);
  });

  test('float-safe: no drift for 0.1 step', () => {
    const values = service.expandRangeToValues('0', '1', '0.1');
    expect(values).toHaveLength(11); // 0, 0.1, 0.2, ..., 1.0
    expect(values[0]).toBe('0');
    expect(values[10]).toBe('1');
  });

  test('start=end=1.0 → [1]', () => {
    const values = service.expandRangeToValues('1.0', '1.0', '0.5');
    expect(values).toEqual(['1']);
  });

  test('start > end throws', () => {
    expect(() => service.expandRangeToValues('2.0', '1.0', '0.5')).toThrow('Start must be <= end');
  });
});

// ─── buildCartesianProduct ──────────────────────────────────────────────────

describe('buildCartesianProduct', () => {
  const baseDefinition: SweepDefinition = {
    symbol: 'BTCUSDT',
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-31T00:00:00Z',
    accountBalance: '10000',
    parameters: [],
    fixedParams: {
      trading_pair: 'BTC/USDC',
      start_date: '2025-01-01T00:00:00Z',
      end_date: '2025-01-31T00:00:00Z',
      margin_type: 'cross',
      exit_on_last_order: false,
      clickhouse_addr: 'localhost:9000',
      clickhouse_db: 'dca_bot',
      clickhouse_user: 'default',
      clickhouse_password: '',
    },
  };

  test('3×2 → 6 distinct configs with unique run_ids', () => {
    const def: SweepDefinition = {
      ...baseDefinition,
      parameters: [
        { name: 'price_scale', mode: 'sweep', values: ['1.0', '1.5', '2.0'] },
        { name: 'amount_scale', mode: 'sweep', values: ['1.0', '2.0'] },
      ],
    };
    const configs = service.buildCartesianProduct(def);
    expect(configs).toHaveLength(6);

    // All run_ids must be unique.
    const ids = new Set(configs.map((c) => c.run_id));
    expect(ids.size).toBe(6);

    // Verify all parameter combinations are present.
    const combos = configs.map((c) => `${c.price_scale}-${c.amount_scale}`);
    expect(combos.sort()).toEqual([
      '1.0-1.0', '1.0-2.0', '1.5-1.0', '1.5-2.0', '2.0-1.0', '2.0-2.0',
    ]);
  });

  test('fixed params carry through', () => {
    const def: SweepDefinition = {
      ...baseDefinition,
      parameters: [
        { name: 'price_scale', mode: 'fixed', fixedValue: '1.5' },
        { name: 'monthly_addition', mode: 'fixed', fixedValue: '250' },
      ],
    };
    const configs = service.buildCartesianProduct(def);
    expect(configs).toHaveLength(1);
    expect(configs[0].margin_type).toBe('cross');
    expect(configs[0].trading_pair).toBe('BTC/USDC');
    expect(configs[0].monthly_addition).toBe('250');
  });

  test('monthly_addition sweep values are mapped into GeneratedConfig', () => {
    const def: SweepDefinition = {
      ...baseDefinition,
      parameters: [
        { name: 'price_scale', mode: 'fixed', fixedValue: '1.5' },
        { name: 'monthly_addition', mode: 'sweep', values: ['0', '250', '500'] },
      ],
    };
    const configs = service.buildCartesianProduct(def);
    expect(configs).toHaveLength(3);
    const monthlyValues = configs.map(c => c.monthly_addition).sort();
    expect(monthlyValues).toEqual(['0', '250', '500']);
  });
});

// ─── pruneConfigs ───────────────────────────────────────────────────────────

describe('pruneConfigs', () => {
  const makeConfig = (
    runId: string,
    amountPerTrade: string,
    overrides: Partial<GeneratedConfig> = {}
  ): GeneratedConfig => ({
    run_id: runId,
    trading_pair: 'BTC/USDC',
    start_date: '2025-01-01T00:00:00Z',
    end_date: '2025-01-31T00:00:00Z',
    price_entry: '2.0',
    price_scale: '1.1',
    amount_scale: '2.0',
    number_of_orders: 3,
    amount_per_trade: amountPerTrade,
    margin_type: 'cross',
    multiplier: 1,
    take_profit_distance_percent: '0.5',
    account_balance: '10000',
    monthly_addition: '0',
    exit_on_last_order: false,
    clickhouse_addr: '',
    clickhouse_db: '',
    clickhouse_user: '',
    clickhouse_password: '',
    ...overrides,
  });

  test('prunes capital-exceeding and below-minimum configs', () => {
    const configs: GeneratedConfig[] = [];
    const preFlightMap = new Map<string, PreFlightSummary>();

    // 80 valid configs.
    for (let i = 0; i < 80; i++) {
      const id = `valid-${i}`;
      configs.push(makeConfig(id, '100'));
      preFlightMap.set(id, {
        run_id: id,
        max_drawdown_covered_pct: '-5.00000000',
        total_capital_required: '500',
        ladder: [],
      });
    }

    // 15 capital-exceeding configs.
    for (let i = 0; i < 15; i++) {
      const id = `over-cap-${i}`;
      configs.push(makeConfig(id, '5000'));
      preFlightMap.set(id, {
        run_id: id,
        max_drawdown_covered_pct: '-10.00000000',
        total_capital_required: '15000', // > 10000 balance
        ladder: [],
      });
    }

    // 5 below-minimum configs.
    for (let i = 0; i < 5; i++) {
      const id = `below-min-${i}`;
      configs.push(makeConfig(id, '5')); // < $10 minimum
      preFlightMap.set(id, {
        run_id: id,
        max_drawdown_covered_pct: '-1.00000000',
        total_capital_required: '5',
        ladder: [],
      });
    }

    const result = service.pruneConfigs(configs, preFlightMap, '10000');

    expect(result.generated).toBe(100);
    expect(result.pruned).toBe(20);
    expect(result.valid).toBe(80);

    // Check prune reasons.
    const capitalPruned = result.prunedConfigs.filter(
      (p) => p.reason === 'capital_exceeds_balance'
    );
    const belowMinPruned = result.prunedConfigs.filter(
      (p) => p.reason === 'base_order_below_minimum'
    );
    expect(capitalPruned).toHaveLength(15);
    expect(belowMinPruned).toHaveLength(5);
  });

  test('all valid → pruned=0', () => {
    const configs = [makeConfig('v1', '100')];
    const pfMap = new Map<string, PreFlightSummary>();
    pfMap.set('v1', {
      run_id: 'v1',
      max_drawdown_covered_pct: '0',
      total_capital_required: '100',
      ladder: [],
    });
    const result = service.pruneConfigs(configs, pfMap, '10000');
    expect(result.pruned).toBe(0);
    expect(result.valid).toBe(1);
  });

  test('percentage amount_per_trade uses account balance for base-order minimum check', () => {
    const configs: GeneratedConfig[] = [
      makeConfig('pct-pass', '1', {
        amount_scale: '1.0',
        number_of_orders: 8,
      }),
      makeConfig('pct-fail', '1', {
        amount_scale: '1.5',
        number_of_orders: 12,
      }),
    ];

    const pfMap = new Map<string, PreFlightSummary>();
    pfMap.set('pct-pass', {
      run_id: 'pct-pass',
      max_drawdown_covered_pct: '-5.0',
      total_capital_required: '1000',
      ladder: [],
    });
    pfMap.set('pct-fail', {
      run_id: 'pct-fail',
      max_drawdown_covered_pct: '-5.0',
      total_capital_required: '1000',
      ladder: [],
    });

    const result = service.pruneConfigs(configs, pfMap, '1000');

    expect(result.valid).toBe(1);
    expect(result.pruned).toBe(1);
    expect(result.validConfigs[0]?.run_id).toBe('pct-pass');
    expect(result.prunedConfigs[0]?.run_id).toBe('pct-fail');
    expect(result.prunedConfigs[0]?.reason).toBe('base_order_below_minimum');
  });
});

// ─── pruneConfigs (US6 new rules, T033) ───────────────────────────────────────

describe('pruneConfigs (US6 pruneReasons breakdown)', () => {
  const makeCfg = (runId: string, tp = '0.5', overrides: Partial<GeneratedConfig> = {}): GeneratedConfig => ({
    run_id: runId,
    trading_pair: 'BTC/USDC',
    start_date: '2025-01-01T00:00:00Z',
    end_date: '2025-01-31T00:00:00Z',
    price_entry: '2.0',
    price_scale: '1.1',
    amount_scale: '2.0',
    number_of_orders: 3,
    amount_per_trade: '100',
    margin_type: 'cross',
    multiplier: 1,
    take_profit_distance_percent: tp,
    account_balance: '10000',
    monthly_addition: '0',
    exit_on_last_order: false,
    clickhouse_addr: '', clickhouse_db: '', clickhouse_user: '', clickhouse_password: '',
    ...overrides,
  });

  const makePF = (
    runId: string,
    maxDD = '-5',
    capital = '500',
    ladder: PreFlightLadderEntry[] = [],
  ): PreFlightSummary => ({ run_id: runId, max_drawdown_covered_pct: maxDD, total_capital_required: capital, ladder });

  test('guaranteed_fee_loss: TP = 0.15% → pruned with correct reason', () => {
    const cfg = makeCfg('gfl', '0.15');
    const pfMap = new Map([['gfl', makePF('gfl')]]);
    const result = service.pruneConfigs([cfg], pfMap, '10000');
    expect(result.pruned).toBe(1);
    expect(result.prunedConfigs[0]?.reason).toBe('guaranteed_fee_loss');
    expect(result.pruneReasons.guaranteed_fee_loss).toBe(1);
    expect(result.pruneReasons.capital_exceeds_balance).toBe(0);
  });

  test('exceeds_100_percent_drawdown: max_drawdown = -105% → pruned', () => {
    const cfg = makeCfg('dd100');
    const pfMap = new Map([['dd100', makePF('dd100', '-105.00000000')]]);
    const result = service.pruneConfigs([cfg], pfMap, '10000');
    expect(result.pruned).toBe(1);
    expect(result.prunedConfigs[0]?.reason).toBe('exceeds_100_percent_drawdown');
    expect(result.pruneReasons.exceeds_100_percent_drawdown).toBe(1);
  });

  test('tick_size_violation: consecutive ladder gap < 0.1% → pruned', () => {
    // gap = (1000.00 - 999.90) / 1000.00 * 100 = 0.01% < 0.1% → violation
    const ladder: PreFlightLadderEntry[] = [
      { level: 1, trigger_price_pct: '-1', trigger_price: '1000.00', order_size: '100', cumulative_cost: '100' },
      { level: 2, trigger_price_pct: '-1.01', trigger_price: '999.90', order_size: '200', cumulative_cost: '300' },
    ];
    const cfg = makeCfg('tsv');
    const pfMap = new Map([['tsv', makePF('tsv', '-5', '500', ladder)]]);
    const result = service.pruneConfigs([cfg], pfMap, '10000');
    expect(result.pruned).toBe(1);
    expect(result.prunedConfigs[0]?.reason).toBe('tick_size_violation');
    expect(result.pruneReasons.tick_size_violation).toBe(1);
  });

  test('all 5 pruneReasons keys present with value 0 when no violations', () => {
    const cfg = makeCfg('clean');
    const pfMap = new Map([['clean', makePF('clean')]]);
    const result = service.pruneConfigs([cfg], pfMap, '10000');
    expect(result.pruneReasons).toEqual({
      capital_exceeds_balance: 0,
      base_order_below_minimum: 0,
      guaranteed_fee_loss: 0,
      exceeds_100_percent_drawdown: 0,
      tick_size_violation: 0,
    });
  });

  test('sum of pruneReasons equals total pruned (FR-009 invariant)', () => {
    const configs = [
      makeCfg('gfl', '0.1'),   // guaranteed_fee_loss
      makeCfg('cap'),           // capital_exceeds_balance (capital 15000 > balance 10000)
      makeCfg('dd100'),         // exceeds_100_percent_drawdown
      makeCfg('valid'),         // valid
    ];
    const pfMap = new Map([
      ['gfl',   makePF('gfl', '-5', '500')],
      ['cap',   makePF('cap', '-5', '15000')],
      ['dd100', makePF('dd100', '-105', '500')],
      ['valid', makePF('valid', '-5', '500')],
    ]);
    const result = service.pruneConfigs(configs, pfMap, '10000');
    const reasonSum = Object.values(result.pruneReasons).reduce((a, b) => a + b, 0);
    expect(reasonSum).toBe(result.pruned);
  });
});
