# Contract: Engine Request/Response (Stop-Loss Extension)

**Feature**: 019-engine-stop-loss  
**Layer**: `core-engine/cmd/engine/` — stdin/stdout NDJSON protocol  
**Date**: April 3, 2026

---

## Engine Request (stdin JSON)

The Go engine reads a single JSON object from stdin. The 4 new SL fields are optional (`omitempty`). When absent they default to disabled.

```typescript
interface EngineRequest {
  // === Existing fields (unchanged) ===
  trading_pair:                  string;   // e.g. "BTC/USDC"
  start_date:                    string;   // RFC3339
  end_date:                      string;   // RFC3339
  price_entry:                   string;   // decimal string > 0
  price_scale:                   string;   // decimal string > 0
  amount_scale:                  string;   // decimal string > 0
  number_of_orders:              number;   // int >= 1
  amount_per_trade:              string;   // decimal string in (0,1]
  margin_type:                   string;   // "cross" | "isolated"
  multiplier:                    number;   // int >= 1
  take_profit_distance_percent:  string;   // decimal string > 0
  account_balance:               string;   // decimal string > 0
  monthly_addition?:             string;   // decimal string >= 0
  exit_on_last_order:            boolean;
  clickhouse_addr:               string;
  clickhouse_db:                 string;
  clickhouse_user:               string;
  clickhouse_password:           string;
  idempotency_key?:              string;
  enable_wide_events?:           boolean;
  wide_events_to_stdout?:        boolean;

  // === NEW: Stop-Loss fields (all optional; absent = SL disabled) ===
  stop_loss_enabled?:            boolean;                              // default: false
  stop_loss_percent?:            string;                               // decimal string, required when enabled
  stop_loss_baseline?:           "first_entry" | "average_entries";   // default: "average_entries"
  stop_loss_timeout_minutes?:    number;                               // int >= 0; default: 0
}
```

---

## Engine Result Payload (stdout NDJSON, type="result")

The Go engine emits one result line at simulation end. New fields added:

```typescript
interface PnlSummary {
  roi:          number;
  maxDrawdown:  number;
  totalFees:    number;
  winRate:      number;   // NEW: total_take_profits / (total_take_profits + total_stops_triggered); 0.0 if both zero
}

interface EngineResultLine {
  type:                       "result";
  pnlSummary:                 PnlSummary;
  tradeEvents:                TradeEvent[];
  safetyOrderUsage:           SafetyOrderUsageEntry[];
  executionTimeMs:            number;
  candleCount:                number;
  eventCount:                 number;
  wide_event_file?:           string;
  wide_event_stall_duration_ms?: number;

  // NEW fields
  total_stops_triggered:      number;   // count of stop-loss position closes
  total_take_profits:         number;   // count of take-profit position closes
}
```

---

## Batch Config Array (--batch-config mode)

Each element in the batch config JSON array uses the same `EngineRequest` schema above. SL fields are per-run (each sweep permutation may have different `stop_loss_percent` or `stop_loss_timeout_minutes`).

```json
[
  {
    "trading_pair": "BTC/USDC",
    "stop_loss_enabled": true,
    "stop_loss_percent": "5",
    "stop_loss_baseline": "average_entries",
    "stop_loss_timeout_minutes": 60,
    "...": "..."
  },
  {
    "trading_pair": "BTC/USDC",
    "stop_loss_enabled": true,
    "stop_loss_percent": "3",
    "stop_loss_baseline": "average_entries",
    "stop_loss_timeout_minutes": 0,
    "...": "..."
  }
]
```

---

## WideEvent — Updated `close_reason` and `event_type` values

**No ClickHouse DDL changes needed.** `event_type` and `close_reason` are `LowCardinality(String)` — new values are accepted automatically.

> **Canonical wide-event shape**: A stop-loss execution emits a `position_closed` event (same `event_type` as all other closes) with `close_reason = 'stop_loss'`. There is **no** new `event_type = 'stop_loss_executed'` value. This is the authoritative definition; spec FR-021 and US6 acceptance criteria align to this shape.

New value for `close_reason`:

| `event_type`       | `close_reason` | Meaning                    |
|--------------------|----------------|----------------------------|
| `position_closed`  | `take_profit`  | Normal TP exit (existing)  |
| `position_closed`  | `liquidation`  | Margin call (existing)     |
| `position_closed`  | `end_of_backtest` | Backtest ended (existing) |
| `position_closed`  | `last_order_filled` | exitOnLastOrder (existing) |
| `position_closed`  | **`stop_loss`** | **NEW** — SL execution     |

---

## Domain Event: `StopLossExecutedEvent`

Internal domain event. Not stored in the events DB — it is consumed by the aggregator (cmd layer) and the wide-event enricher (application layer).

> **`average_entries` mode note (FR-024 / M1 clarification)**: When `stop_loss_baseline = "average_entries"`, the `SlTriggerPrice` is **zero at position open** and remains inactive until the first safety order fills (because `average_entry` is undefined before any SO fills). The SL check in `ProcessCandle` guards on `pos.SlTriggerPrice.IsPositive()`, so no SL evaluation occurs before the first fill. FR-024 ("SL evaluates on every candle including the opening candle") is fully honored for `first_entry` mode; for `average_entries` mode, evaluation is deferred until a meaningful average entry price exists. This behavior must be explicitly documented in `stop_loss_test.go` and spec.md.

```go
// EventType: "stop_loss.executed"
type StopLossExecutedEvent struct {
    RunID          string    `json:"run_id"`
    TradeID        string    `json:"trade_id"`
    Timestamp      time.Time `json:"timestamp"`
    TradingPair    string    `json:"trading_pair"`
    ExecutionPrice string    `json:"execution_price"` // candle.Close at execution
    Size           string    `json:"size"`            // total base quantity (e.g. BTC)
    RealizedLoss   string    `json:"realized_loss"`   // negative decimal string
    Fee            string    `json:"fee"`             // taker fee decimal string
}
```

---

## Sweep Run Summary API Response

The Leaderboard REST endpoint returns `sweep_run_summaries` rows. New field:

```typescript
interface SweepRunSummary {
  // ... existing fields ...
  total_stops_triggered: number;   // NEW: 0 when SL disabled or no stops fired
}
```

---

## Validation Contract

| Condition | Engine behavior |
|-----------|----------------|
| `stop_loss_enabled = false` | SL fields are ignored; engine runs pre-feature behavior |
| `stop_loss_enabled = true` AND `stop_loss_percent` missing/zero | Engine returns error to stderr, exits non-zero |
| `stop_loss_enabled = true` AND `stop_loss_percent > 100` | Engine returns error to stderr, exits non-zero |
| `stop_loss_enabled = true` AND `stop_loss_timeout_minutes < 0` | Engine returns error to stderr, exits non-zero |
| `stop_loss_baseline` absent | Defaults to `"average_entries"` |
| `stop_loss_timeout_minutes` absent | Defaults to `0` (immediate) |
