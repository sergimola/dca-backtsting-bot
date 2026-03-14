# Contract: Go Engine Stdin/Stdout JSON Protocol

**Feature**: 008-clickhouse-market-data  
**Date**: 2026-03-14  
**Status**: Breaking change to existing contract

This document describes the JSON messages exchanged between the Node.js API and the Go engine subprocess over stdin/stdout.

---

## Stdin: EngineRequest

The Node.js API spawns the Go binary and writes a single JSON object to its stdin. The Go engine reads this once on startup.

### Schema

```typescript
interface EngineRequest {
  // ── Trading Parameters (13 SDD §4.1 fields — unchanged) ──────────────
  trading_pair:                 string;    // e.g. "BTCUSDT"
  start_date:                   string;    // RFC 3339, e.g. "2024-01-01T00:00:00Z"
  end_date:                     string;    // RFC 3339, e.g. "2024-02-01T00:00:00Z"
  price_entry:                  string;    // decimal string, e.g. "42000.00"
  price_scale:                  string;    // decimal string
  amount_scale:                 string;    // decimal string
  number_of_orders:             number;    // integer
  amount_per_trade:             string;    // decimal string
  margin_type:                  string;    // "isolated" | "cross"
  multiplier:                   string;    // decimal string
  take_profit_distance_percent: string;    // decimal string
  account_balance:              string;    // decimal string
  exit_on_last_order:           boolean;

  // ── ClickHouse Connection (NEW — replaces market_data_csv_path) ───────
  clickhouse_addr:     string;    // host:port, native TCP, e.g. "localhost:9000"
  clickhouse_db:       string;    // database name, e.g. "dca_bot"
  clickhouse_user:     string;    // e.g. "default"
  clickhouse_password: string;    // may be empty string

  // ── Metadata (unchanged) ──────────────────────────────────────────────
  idempotency_key: string;
}
```

### Removed Fields

| Field | Reason |
|-------|--------|
| `market_data_csv_path` | Replaced by ClickHouse connection fields. CSV data loading is removed entirely. |

### Validation Rules (enforced by Go engine)

- `clickhouse_addr` must be non-empty (fails fast with exit code 1 + stderr message)
- `clickhouse_db` must be non-empty
- All 13 trading parameters retain their existing validation rules

---

## Stdout: EngineResponse

The Go engine writes a single JSON object to stdout upon completion (unchanged from current design).

### Schema

```typescript
interface EngineResponse {
  events:           BacktestEvent[];    // chronological event stream
  final_position:   FinalPosition | null;
  execution_time_ms: number;
  candle_count:     number;
  event_count:      number;
}
```

No changes to the stdout contract. The event schema, event types, and result shape are unaffected by this feature.

---

## Backward Compatibility

This is a **breaking change**: the `market_data_csv_path` field is removed and must be replaced by `clickhouse_addr`, `clickhouse_db`, `clickhouse_user`, `clickhouse_password` in the same request. Any existing integration test fixtures or test helpers that construct `EngineRequest` objects must be updated.

---

## Error Handling

| Scenario | Go engine behaviour |
|----------|---------------------|
| Cannot connect to ClickHouse | Exit 1; write error JSON to stderr: `{"error": "clickhouse connection failed: <details>"}` |
| No candles found for requested range | Exit 1; write error JSON: `{"error": "no candle data found for symbol X in range [start, end]"}` |
| Streaming query error mid-backtest | Exit 1; write partial event stream marker + error to stderr |
| Missing required field in stdin | Exit 1 immediately; write error to stderr |
