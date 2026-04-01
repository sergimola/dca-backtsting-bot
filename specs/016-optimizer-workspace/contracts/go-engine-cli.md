# Contract: Go Engine CLI — Optimizer Modes

**Branch**: `016-optimizer-workspace` | **Date**: 2026-04-01

---

## Overview

The Go engine binary exposes two new operating modes via flags, in addition to the existing single-run mode (stdin JSON → NDJSON stdout).

---

## Mode 1: `--preflight` (Single Pre-Flight)

### Invocation
```sh
echo '<EngineRequest JSON>' | core-engine --preflight
```

### stdin
Same `EngineRequest` JSON schema as the single-run mode. Only the following fields are used; the rest are ignored:
- `price_entry`, `price_scale`, `amount_scale`, `number_of_orders`, `amount_per_trade`, `multiplier`, `take_profit_distance_percent`, `account_balance`
- `trading_pair` (for metadata echo in response)
- ClickHouse fields: **NOT used** (no I/O in Pre-Flight mode)

### stdout
Single JSON object (not NDJSON). Written atomically at end of computation.

```jsonc
{
  "run_id": "",                         // empty string for single mode
  "max_drawdown_covered_pct": "-7.12500000", // decimal string, always <= 0
  "total_capital_required": "1500.00000000", // decimal string, always > 0
  "ladder": [
    {
      "level": 1,
      "trigger_price_pct": "-1.50000000",  // % drop from entry; negative
      "trigger_price": "98.50000000",       // absolute price (normalized $100 entry)
      "order_size": "200.00000000",
      "cumulative_cost": "200.00000000"
    },
    {
      "level": 2,
      "trigger_price_pct": "-3.75000000",
      "trigger_price": "96.25000000",
      "order_size": "400.00000000",
      "cumulative_cost": "600.00000000"
    }
    // ...one entry per safety order (number_of_orders)
  ]
}
```

**Note**: All numeric values are serialized as decimal strings (8 decimal places) to preserve fixed-point precision. The consumer MUST parse these as arbitrary-precision decimals, not float64.

### stderr
Standard slog output (respects `--log-level` flag). No ClickHouse connection is opened.

### Exit codes
- `0`: Success
- `1`: Invalid input JSON or validation error (message on stderr)

---

## Mode 2: `--batch-preflight <path>` (Batch Pre-Flight)

### Invocation
```sh
core-engine --batch-preflight /tmp/preflight-input-<uuid>.json
```

### Input file (`<path>`)
JSON array of config objects. Each object is identical to `EngineRequest` plus a required `run_id`.

```jsonc
[
  {
    "run_id": "a1b2c3d4-...",
    "trading_pair": "BTCUSDC",
    "price_entry": "2.0",
    "price_scale": "1.0",
    "amount_scale": "2.0",
    "number_of_orders": 10,
    "amount_per_trade": "17500",
    "multiplier": 1,
    "take_profit_distance_percent": "0.5",
    "account_balance": "10000",
    // ClickHouse fields present but NOT used in Pre-Flight
    "clickhouse_addr": "localhost:9000",
    "clickhouse_db": "dca_bot",
    "clickhouse_user": "default",
    "clickhouse_password": ""
  }
  // ... up to 10,000 elements
]
```

### stdout
JSON array of `PreFlightResult` objects, one per input element, in input order.

```jsonc
[
  {
    "run_id": "a1b2c3d4-...",
    "max_drawdown_covered_pct": "-7.12500000",
    "total_capital_required": "1500.00000000",
    "ladder": [ ... ]
  }
  // ...
]
```

### Exit codes
- `0`: Success (all results computed)
- `1`: File not found, invalid JSON, or structural validation error

---

## Mode 3: `--batch-config <path>` (Batch Backtest Execution)

### Invocation
```sh
core-engine --batch-config /tmp/batch-config-<uuid>.json \
            [--log-level INFO] \
            [--wide-event-dir /tmp/wide-events/]
```

**Note**: `--progress-interval-ms` is ignored in batch mode (progress is tracked per-run via the `run_id` tagging, not via a shared ticker).

### Input file (`<path>`)
JSON array of `BatchJobConfig` objects — same schema as batch Pre-Flight input.

### stdout (NDJSON)
One JSON line per completed run. Lines are emitted as workers complete; order is non-deterministic (sorted by arrival time, not input order). Each line is one of:

**Success result**:
```jsonc
{
  "type": "result",
  "run_id": "a1b2c3d4-...",
  "pnlSummary": { "roi": 12.5, "maxDrawdown": -8.3, "totalFees": 42.10 },
  "tradeEvents": [ ... ],
  "safetyOrderUsage": [ ... ],
  "executionTimeMs": 1234,
  "candleCount": 262800,
  "eventCount": 47
}
```

**Error result** (run failed; others continue):
```jsonc
{
  "type": "error",
  "run_id": "b2c3d4e5-...",
  "error_message": "simulation failed: position state machine error: ..."
}
```

**Batch summary** (final line after all runs):
```jsonc
{
  "type": "batch_summary",
  "total_runs": 100,
  "completed_runs": 98,
  "error_runs": 2,
  "total_execution_time_ms": 45230
}
```

### Exit codes
- `0`: All runs completed (even if some emitted error results)
- `1`: Fatal error (file not found, invalid JSON schema, ClickHouse connection failure before any run starts)
