# Contract: Go Engine Stdout Line Protocol

**Version**: 1.0 | **Feature**: 011-go-engine-io-optimization | **Date**: 2026-03-15

This contract defines the complete stdout protocol between the Go engine binary (`core-engine.exe`) and the Node.js `BacktestService`. It is binding for both sides — any deviation is a contract violation.

---

## Protocol Overview

The engine writes **newline-delimited JSON (NDJSON)** to stdout. Each line is a complete, valid JSON object terminated by `\n`. The stream has exactly two line types:

1. **Zero or more `progress` lines** — emitted at the configured ticker interval during simulation
2. **Exactly one `result` line** — emitted as the final line after simulation completes

stderr is reserved exclusively for `slog` text output (never JSON).

```
stdout = (progress_line)* result_line
stderr = (slog_text_entry)*
```

---

## Line Type 1: Progress Line

```json
{
  "type": "progress",
  "percent": 45.2,
  "current_date": "2024-05-12T14:00:00Z",
  "processed_candles": 150000,
  "total_candles": 331200,
  "current_price": 65000.50,
  "realized_pnl": 125.50,
  "candles_per_second": 612000
}
```

### Field Definitions

| Field | Type | Constraints | Description |
|---|---|---|---|
| `type` | string | always `"progress"` | Discriminant |
| `percent` | float64 | `[0, 99]` | `(processed / total) * 100`, capped at 99 until final result |
| `current_date` | string | RFC3339 UTC | Timestamp of the last processed candle |
| `processed_candles` | integer | ≥ 0 | Candles consumed from ClickHouse so far |
| `total_candles` | integer | ≥ 0 | Result of pre-flight COUNT; `0` if unknown |
| `current_price` | float64 | ≥ 0 | Close price of the last processed candle (`decimal.InexactFloat64()`) |
| `realized_pnl` | float64 | any | Cumulative sum of all `PositionClosed.profit` events seen so far |
| `candles_per_second` | integer | ≥ 0 | Candles processed in the last tick window / window duration |

### Emission Timing

- First emission: no earlier than `progress_interval_ms` after engine start
- Subsequent emissions: approximately every `progress_interval_ms` (wall-clock, not CPU time)
- **Last emission**: before the final result line; the ticker is stopped and drained before the result is written

### Consumer Responsibility (BacktestService / BackgroundWorker)

- Parse with `JSON.parse`; discard silently on parse failure
- On `type === "progress"`: call progress handler (fire-and-forget); do not await before next line
- `percent` must be floored to integer before Postgres UPDATE: `Math.floor(line.percent)`

---

## Line Type 2: Result Line

```json
{
  "type": "result",
  "pnlSummary": {
    "roi": 12.5,
    "maxDrawdown": 4.2,
    "totalFees": 18.30
  },
  "tradeEvents": [
    {
      "timestamp": "5/12/2024, 2:00:00 PM",
      "rawTimestamp": "2024-05-12T14:00:00Z",
      "eventType": "ENTRY",
      "price": 65000.50,
      "quantity": 0.00153846,
      "balance": 100.00,
      "trade_id": "1",
      "fee": 0.10
    }
  ],
  "safetyOrderUsage": [
    { "level": "1", "count": 42 },
    { "level": "2", "count": 18 }
  ],
  "executionTimeMs": 4821,
  "candleCount": 331200,
  "eventCount": 480
}
```

### `pnlSummary` Fields

| Field | Type | Description |
|---|---|---|
| `roi` | float64 | `(realizedPnl / accountBalance) * 100`; zero if accountBalance is zero |
| `maxDrawdown` | float64 | Maximum peak-to-trough equity decline as percentage |
| `totalFees` | float64 | Sum of all entry fees, safety order fees, and sell fees |

### `tradeEvents` Entry Fields

| Field | Type | JSON key | Event source |
|---|---|---|---|
| `timestamp` | string | `"timestamp"` | `event.Timestamp` formatted with `time.Local` |
| `rawTimestamp` | string | `"rawTimestamp"` | `event.Timestamp.Format(time.RFC3339)` |
| `eventType` | string | `"eventType"` | `"ENTRY"` / `"SAFETY_ORDER"` / `"EXIT"` |
| `price` | float64 | `"price"` | Entry: `configured_orders[0].price`; SO: `data.price`; Exit: `data.closing_price` |
| `quantity` | float64 | `"quantity"` | Entry: `amount/price`; SO: `data.base_size`; Exit: `data.size` |
| `balance` | float64 | `"balance"` | Entry/SO: cost in quote; Exit: `data.profit` |
| `trade_id` | string | `"trade_id"` | Monotonically increasing per `PositionOpened`; `"1"`, `"2"`, ... |
| `fee` | float64 | `"fee"` | Entry: `data.entry_fee`; SO: `data.fee`; Exit: patched from next `SellOrderExecuted.fee` |

> **Note on `trade_id` JSON key**: This field uses snake_case (`"trade_id"`) to maintain parity with the existing TypeScript `StoredTradeEvent.trade_id` field. All other `tradeEvents` fields use camelCase. This asymmetry is intentional and must be preserved.

### `safetyOrderUsage` Entry Fields

| Field | Type | Description |
|---|---|---|
| `level` | string | 1-indexed depth as string: `"1"` = first safety order |
| `count` | integer | Number of times this depth was filled across all trades in the backtest |

Entries are sorted ascending by level. Levels with `count === 0` are omitted.

### Top-Level Result Fields

| Field | Type | Description |
|---|---|---|
| `type` | string | always `"result"` |
| `executionTimeMs` | integer | `backtest.EndTime - backtest.StartTime` in ms (engine internal) |
| `candleCount` | integer | Total candles processed |
| `eventCount` | integer | Total domain events captured |

### Consumer Responsibility

- This line is the authoritative source for `markCompleted`
- `executionTimeMs` reported to Postgres should be the **worker wall-clock time** (job-claim to result-receipt), not the engine-internal value
- If this line is never received and the process exits, call `markFailed`

---

## Error Conditions

| Condition | Engine stdout | Engine exit code | Consumer action |
|---|---|---|---|
| Normal completion | 0+ progress lines + 1 result line | 0 | `markCompleted` |
| Engine crash before result | Some progress lines (possibly 0) | non-zero | `markFailed(stderr)` |
| Engine timeout (SIGTERM/SIGKILL) | Partial | non-zero | `markFailed` with timeout message |
| stdout closes without result line | 0+ progress lines | 0 or non-zero | `markFailed("engine exited without result")` |

---

## Versioning

Breaking changes to this protocol (field additions are non-breaking; field removals or type changes are breaking) require a coordinated update of both the Go engine and the TypeScript BacktestService. The `type` discriminant allows future additional line types to be introduced as non-breaking additions.
