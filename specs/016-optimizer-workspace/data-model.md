# Data Model: Optimizer Workspace (016)

**Branch**: `016-optimizer-workspace` | **Date**: 2026-04-01

---

## Go Engine Domain

### `PreFlightLadderEntry`
Represents one rung of the DCA safety-order ladder, computed from pure domain math.

| Field | Type | Decimal Precision | Derivation |
|-------|------|-------------------|------------|
| `Level` | `int` | — | 1-indexed safety order number |
| `TriggerPricePct` | `decimal.Decimal` | 8dp | `(P_n - P_0) / P_0 * 100` (negative) |
| `TriggerPrice` | `decimal.Decimal` | 8dp | `P_n` from `ComputePriceSequence` with normalized $100 entry |
| `OrderSize` | `decimal.Decimal` | 8dp | `A_n` from `ComputeAmountSequence` |
| `CumulativeCost` | `decimal.Decimal` | 8dp | `sum(A_0..A_n)` |

### `PreFlightResult`
JSON output of both `--preflight` (single) and `--batch-preflight` (per element) modes.

| Field | Type | JSON key | Notes |
|-------|------|----------|-------|
| `RunID` | `string` | `run_id` | Echo of input `run_id`; empty for single mode |
| `MaxDrawdownCoveredPct` | `decimal.Decimal` | `max_drawdown_covered_pct` | `TriggerPricePct` of deepest ladder rung; `0` when `max_safety_orders=0` |
| `TotalCapitalRequired` | `decimal.Decimal` | `total_capital_required` | Sum of all `OrderSize` values |
| `Ladder` | `[]PreFlightLadderEntry` | `ladder` | One entry per safety order level |

**Serialization note**: `decimal.Decimal` fields serialized as `string` in JSON output (shopspring default) to preserve full precision. Node.js and frontend parse as strings and display with `toFixed(2)` where shown.

### `BatchJobConfig`
One element of the `--batch-config` JSON file input array. Extends `EngineRequest` with a required `run_id`.

| Field | Type | JSON key | Notes |
|-------|------|----------|-------|
| `RunID` | `string` | `run_id` | Required. UUID v4. Echoed in all output lines for this run. |
| *(all EngineRequest fields)* | — | — | Same schema as single-run stdin input |

### `BatchResultPayload`
Extends the existing `EngineResultPayload` with batch-specific fields.

| Field | Type | JSON key | Notes |
|-------|------|----------|-------|
| `RunID` | `string` | `run_id` | Matches the `BatchJobConfig.RunID` |
| `Type` | `string` | `type` | `"result"` or `"error"` |
| *(all EngineResultPayload fields)* | — | — | Same as single-run result when `type="result"` |
| `ErrorMessage` | `string` | `error_message` | Populated only when `type="error"` |

### `CandleGroup` (internal)
In-memory grouping key for shared candle cache. Not serialized.

| Field | Type | Notes |
|-------|------|-------|
| `Symbol` | `string` | Normalized (e.g., `"BTCUSDC"`) |
| `StartDate` | `string` | RFC3339 |
| `EndDate` | `string` | RFC3339 |
| `Candles` | `[]Candle` | Materialized slice from ClickHouse; read-only after load |

### `Candle` (new exported type in `application/orchestrator`)

| Field | Type | Notes |
|-------|------|-------|
| `Timestamp` | `time.Time` | UTC |
| `Open` | `decimal.Decimal` | |
| `High` | `decimal.Decimal` | |
| `Low` | `decimal.Decimal` | |
| `Close` | `decimal.Decimal` | |
| `Volume` | `decimal.Decimal` | |

**Note**: Candle data is already loaded internally by `clickhouse_loader.go`. This formalizes the struct as an exported type so `[]Candle` can be passed to workers. A new `LoadAll() ([]Candle, error)` method on `ClickHouseCandleLoader` materializes rows into this slice.

---

## Node.js Layer

### `SweepParameter`
Describes a single parameter's sweep definition as submitted by the frontend.

```typescript
type SweepParameterMode = 'fixed' | 'list' | 'range';

interface SweepParameter {
  name: string;           // matches EngineRequest field name (e.g., "price_scale")
  mode: SweepParameterMode;
  fixedValue?: string;    // decimal string; used when mode = 'fixed'
  listValues?: string[];  // decimal strings; used when mode = 'list' (comma-sep input → parsed)
  range?: SweepRange;     // used when mode = 'range'
}

interface SweepRange {
  start: string;   // decimal string
  end: string;     // decimal string
  step: string;    // decimal string; positive; start <= end required
}
```

### `SweepDefinition`
Top-level payload for `POST /optimizer/sweep`.

```typescript
interface SweepDefinition {
  symbol: string;          // e.g., "BTCUSDC" — fixed per sweep
  startDate: string;       // RFC3339 — fixed per sweep
  endDate: string;         // RFC3339 — fixed per sweep
  accountBalance: string;  // decimal string; used for capital pruning
  parameters: SweepParameter[];
  // ClickHouse connection (server-side only; not re-sent to frontend)
  clickhouseAddr?: string;
  clickhouseDb?: string;
  clickhouseUser?: string;
  clickhousePassword?: string;
}
```

### `GeneratedConfig`
One expanded combination from the Cartesian product. Equivalent to `BatchJobConfig`.

```typescript
interface GeneratedConfig {
  run_id: string;           // UUID v4
  // all EngineRequest fields resolved to concrete strings
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
  monthly_addition?: string;
  exit_on_last_order: boolean;
  clickhouse_addr: string;
  clickhouse_db: string;
  clickhouse_user: string;
  clickhouse_password: string;
}
```

### `PruningResult`
Output of the Smart Pruning step.

```typescript
interface PruneReason {
  run_id: string;
  reason: 'base_order_below_minimum' | 'capital_exceeds_balance';
  detail: string;  // human-readable (e.g., "Required $12,000 exceeds balance $10,000")
}

interface PruningResult {
  generated: number;
  pruned: number;
  valid: number;
  validConfigs: GeneratedConfig[];
  pruneReasons: PruneReason[];
}
```

### `SweepCountResponse`
Lightweight payload from `POST /optimizer/sweep/count` (footer combinatorial math).

```typescript
interface SweepCountResponse {
  generated: number;   // mathematical product of dimension cardinalities
  pruned: number;      // from batch pre-flight (may be 0 if over limit)
  valid: number;
  overLimit: boolean;  // true if generated > 10_000
  limitExceeded?: { count: number; limit: number }; // populated if overLimit
}
```

### `OptimizerSession` (in-memory, frontend + server)
Lifecycle state of one sweep. Not persisted to database (FR-034).

```typescript
type SweepPhase = 'idle' | 'running' | 'complete' | 'cancelled';

interface OptimizerSession {
  sessionId: string;       // UUID v4, generated on sweep launch
  phase: SweepPhase;
  sweepDefinition: SweepDefinition;
  pruningResult: PruningResult | null;
  totalRuns: number;
  completedRuns: number;
  results: BatchRunResult[];  // appended as SSE lines arrive
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
}
```

### `BatchRunResult`
A single completed run result as parsed from an SSE event.

```typescript
interface BatchRunResult {
  run_id: string;
  type: 'result' | 'error';
  // populated when type = 'result':
  pnlSummary?: { roi: number; maxDrawdown: number; totalFees: number };
  executionTimeMs?: number;
  candleCount?: number;
  // swept parameter values for this run (for Heatmap / Leaderboard column highlighting):
  sweptValues?: Record<string, string>;
  // populated when type = 'error':
  errorMessage?: string;
}
```

---

## Frontend State

### `OptimizerFormState`

```typescript
interface ParameterField {
  name: string;
  label: string;
  mode: 'fixed' | 'sweep';
  fixedValue: string;
  listInput: string;   // raw comma-separated string (e.g., "1.0, 1.5, 2.0")
  range: { start: string; end: string; step: string };
}

interface OptimizerFormState {
  symbol: string;
  startDate: string;
  endDate: string;
  accountBalance: string;
  parameters: ParameterField[];
}
```

### Sweepable Parameter Registry
The fixed set of numeric parameters exposed for sweep. Defined as a static registry in the frontend — non-numeric params (symbol, dates, margin_type, clickhouse connection) are never in this list.

| Parameter | Display Label | Default | Min | Max |
|-----------|--------------|---------|-----|-----|
| `price_entry` | Price Dev. % | 2.0 | 0.1 | 50.0 |
| `price_scale` | Price Scale | 1.1 | 1.0 | 5.0 |
| `amount_scale` | Amount Scale | 2.0 | 1.0 | 10.0 |
| `number_of_orders` | Safety Orders | 10 | 1 | 40 |
| `amount_per_trade` | Amount/Trade ($) | 17500 | 10 | — |
| `take_profit_distance_percent` | Take Profit % | 0.5 | 0.1 | 20.0 |
| `multiplier` | Leverage | 1 | 1 | 20 |

### State Transitions

```
Configuring (idle)
   └─[Launch Sweep]──→ Running
                           ├─[All complete]──→ Complete
                           └─[Cancel]────────→ Cancelled

Complete / Cancelled
   └─[New Sweep / Param change]──→ Configuring (idle)
```
