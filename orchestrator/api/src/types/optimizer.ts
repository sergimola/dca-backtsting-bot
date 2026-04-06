/**
 * Optimizer Types — TypeScript interfaces for the Optimizer Workspace feature.
 * Consumed by: SweepService, OptimizerSessionStore, optimizer.routes, and frontend.
 * Spec: /specs/016-optimizer-workspace/data-model.md
 */

import { ChildProcess } from 'child_process';

// ── Sweep Input Types ──────────────────────────────────────────────────────

/** A range with start/end/step for float-safe expansion via decimal.js. */
export interface SweepRange {
  start: string;
  end: string;
  step: string;
}

/** A single parameter's sweep configuration. */
export interface SweepParameter {
  name: string;
  mode: 'fixed' | 'sweep';
  fixedValue?: string;
  values?: string[];  // comma-separated parsed into array
  range?: SweepRange; // expanded to values before Cartesian product
}

/** The full sweep definition sent from the frontend. */
export interface SweepDefinition {
  symbol: string;
  startDate: string;
  endDate: string;
  accountBalance: string;
  parameters: SweepParameter[];
  fixedParams: FixedParams;
}

/** Fixed (non-sweepable) parameters that apply to every config in the sweep. */
export interface FixedParams {
  trading_pair: string;
  start_date: string;
  end_date: string;
  margin_type: 'cross' | 'isolated';
  exit_on_last_order: boolean;
  stop_loss_enabled?: boolean;
  stop_loss_baseline?: 'first_entry' | 'average_entries';
  clickhouse_addr: string;
  clickhouse_db: string;
  clickhouse_user: string;
  clickhouse_password: string;
}

// ── Generated Config Types ─────────────────────────────────────────────────

/** A fully expanded config ready for the Go engine. */
export interface GeneratedConfig {
  run_id: string;
  trading_pair: string;
  start_date: string;
  end_date: string;
  price_entry: string;
  price_scale: string;
  amount_scale: string;
  number_of_orders: number;
  amount_per_trade: string;
  margin_type: string;
  multiplier: number;
  take_profit_distance_percent: string;
  account_balance: string;
  monthly_addition: string;
  exit_on_last_order: boolean;
  stop_loss_enabled?: boolean;
  stop_loss_percent?: string;
  stop_loss_baseline?: string;
  stop_loss_timeout_minutes?: number;
  clickhouse_addr: string;
  clickhouse_db: string;
  clickhouse_user: string;
  clickhouse_password: string;
}

// ── Pre-Flight Types ───────────────────────────────────────────────────────

/** Summary of a single config's Pre-Flight analysis (returned by Go --batch-preflight). */
export interface PreFlightSummary {
  run_id: string;
  max_drawdown_covered_pct: string;
  total_capital_required: string;
  ladder: PreFlightLadderEntry[];
}

/** A single rung of the DCA safety-order ladder. */
export interface PreFlightLadderEntry {
  level: number;
  trigger_price_pct: string;
  trigger_price: string;
  order_size: string;
  cumulative_cost: string;
}

// ── Pruning Types ──────────────────────────────────────────────────────────

/** Reasons a config can be pruned. */
export type PruneReason =
  | 'capital_exceeds_balance'
  | 'base_order_below_minimum'
  | 'guaranteed_fee_loss'
  | 'exceeds_100_percent_drawdown'
  | 'tick_size_violation';

/** Categorised counts of pruned configs — all 5 keys always present (FR-015). */
export interface PruneBreakdown {
  capital_exceeds_balance: number;
  base_order_below_minimum: number;
  guaranteed_fee_loss: number;
  exceeds_100_percent_drawdown: number;
  tick_size_violation: number;
}

/** A config that was pruned with an explanation. */
export interface PrunedConfig {
  run_id: string;
  reason: PruneReason;
  detail: string;
}

/** The result of the pruning pipeline. */
export interface PruningResult {
  generated: number;
  pruned: number;
  valid: number;
  validConfigs: GeneratedConfig[];
  prunedConfigs: PrunedConfig[];
  pruneReasons: PruneBreakdown;
}

// ── Count Endpoint ─────────────────────────────────────────────────────────

/** Response from POST /optimizer/sweep/count. */
export interface SweepCountResponse {
  count: number;
  overLimit: boolean;
}

// ── Session & Execution Types ──────────────────────────────────────────────

/** The lifecycle phase of an optimizer sweep. */
export type SweepPhase = 'idle' | 'validating' | 'running' | 'complete' | 'cancelled' | 'partial';

/** An in-memory optimizer session (ephemeral — not persisted to DB per FR-034). */
export interface OptimizerSession {
  sessionId: string;
  phase: SweepPhase;
  sweepDefinition?: SweepDefinition;
  validConfigs: GeneratedConfig[];
  pruningResult?: PruningResult;
  preFlightMap?: Map<string, PreFlightSummary>;
  results: BatchRunResult[];
  engineProcess?: ChildProcess;
  createdAt: Date;
  completedAt?: Date;
  cancelledAt?: Date;
}

/** A UI-facing projection of SweepSession for the history list (FR-004). */
export interface SweepHistoryEntry {
  id: string;
  tradingPair: string;
  startDate: string;
  endDate: string;
  totalRuns: number;
  maxRoi: number | null;
  status: 'completed' | 'cancelled' | 'running';
  createdAt: string;
}

/** Result of a single run within a batch (streamed via SSE). */
export interface BatchRunResult {
  run_id: string;
  type: 'result' | 'error';
  error?: string;
  winRate?: number | null;
  totalPositionsClosed?: number;
  pnlSummary?: {
    roi: number;
    maxDrawdown: number;
    totalFees: number;
    annualizedReturn?: number | null;
  };
  tradeEvents?: Array<{
    timestamp: string;
    rawTimestamp: string;
    eventType: string;
    price: number;
    quantity: number;
    balance: number;
    trade_id: string;
    fee: number;
  }>;
  safetyOrderUsage?: Array<{
    level: string;
    count: number;
  }>;
  executionTimeMs?: number;
  candleCount?: number;
  eventCount?: number;
  longest_trade_duration_ms?: number;
  max_safety_orders_used?: number;
  total_stops_triggered?: number;
  total_take_profits?: number;
}

/** Full response from POST /optimizer/sweep. */
export interface SweepResponse {
  sessionId: string;
  pruningResult: PruningResult;
  preFlightSummary: {
    minDrawdown: number;
    maxDrawdown: number;
    maxCapital: string;
  };
}
