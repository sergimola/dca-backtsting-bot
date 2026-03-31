# Contract: JSONL Wide Event File Format

**Version**: schema_version 1  
**Producer**: Go engine (`core-engine/application/orchestrator`)  
**Consumer**: Node.js ingester (`orchestrator/api/src/services/WideEventIngester.ts`)

---

## Overview

The Go engine writes one `.jsonl` file per backtest run to `{output_dir}/{run_id}.jsonl`.  
Each line is a self-contained JSON object representing one `WideEvent`.  
Lines are newline-delimited (`\n`). The file contains no header, no trailing metadata, no array wrapper.

The Node.js consumer reads this file and streams it directly to ClickHouse using `JSONEachRow` format.

---

## File Naming

```
{output_dir}/{run_id}.jsonl
```

- `output_dir` defaults to `./output/wide_events/` relative to the engine binary.
- `run_id` matches the `BacktestRun.ID` field (format: `{backtestID}-{unixNano}`).
- The path is written to the engine's stdout JSON result under the key `"wide_event_file"`.

---

## Per-Line Schema (schema_version: 1)

Every field is always present. No field may be JSON null. String fields use `""` as the no-data  
sentinel; numeric fields use `"0.00000000"` (quoted decimal string, 8 decimal places).

```json
{
  "schema_version":            1,
  "run_id":                    "abc123-1743200000000000000",
  "trade_id":                  "abc123-1743200000000000000-1743201000000",
  "timestamp":                 "2025-01-01T00:00:00Z",
  "event_type":                "price_changed",
  "symbol":                    "BTCUSDC",

  "candle_open":               "97000.00000000",
  "candle_high":               "97500.00000000",
  "candle_low":                "96800.00000000",
  "candle_close":              "97200.00000000",
  "candle_volume":             "12.34567890",

  "running_account_balance":   "10000.00000000",
  "global_candle_count":       1441,

  "position_state":            "active",
  "average_entry_price":       "97000.00000000",
  "position_quantity":         "0.01020000",
  "total_capital_deployed":    "989.40000000",
  "fees_accumulated":          "0.98940000",
  "take_profit_price":         "99910.00000000",
  "liquidation_price":         "0.00000000",
  "filled_orders_count":       1,

  "unrealized_pnl":            "2.04000000",
  "current_drawdown_pct":      "-0.20618600",

  "action_price":              "0.00000000",
  "action_quantity":           "0.00000000",
  "action_fee":                "0.00000000",
  "order_number":              0,
  "realized_pnl":              "0.00000000",
  "close_reason":              ""
}
```

---

## Field Reference

### Identity Fields

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | integer | Always `1` for this contract version. Ingester MUST reject unknown versions. |
| `run_id` | string | Backtest run identifier. FK to `backtest_configs.run_id`. |
| `trade_id` | string | Active position trade ID. `""` when no position is open. |
| `timestamp` | string (RFC3339) | UTC timestamp of the triggering candle. |
| `event_type` | string (enum) | One of: `price_changed`, `order_filled`, `position_opened`, `position_closed`. |
| `symbol` | string | Trading pair, e.g. `"BTCUSDC"`. |

### Market Fields

| Field | Type | Description |
|-------|------|-------------|
| `candle_open` | quoted decimal | OHLCV open price for the triggering candle. |
| `candle_high` | quoted decimal | OHLCV high price. |
| `candle_low` | quoted decimal | OHLCV low price (used for `current_drawdown_pct` calculation). |
| `candle_close` | quoted decimal | OHLCV close price (used for `unrealized_pnl` calculation). |
| `candle_volume` | quoted decimal | OHLCV volume in base currency. |

### Portfolio Fields

| Field | Type | Description |
|-------|------|-------------|
| `running_account_balance` | quoted decimal | Total available balance at event time (includes monthly injections and realized profits). |
| `global_candle_count` | integer | Number of candles processed since backtest start (1-indexed at first candle). |

### Position Fields

All position fields carry sentinel defaults when no position is active.

| Field | Type | No-Position Default | Description |
|-------|------|---------------------|-------------|
| `position_state` | string | `""` | `"idle"`, `"active"`, or `"closed"`. |
| `average_entry_price` | quoted decimal | `"0.00000000"` | Size-weighted average entry price. |
| `position_quantity` | quoted decimal | `"0.00000000"` | Total base currency held. |
| `total_capital_deployed` | quoted decimal | `"0.00000000"` | Σ(fill_quote + fill_fee) across all fills. |
| `fees_accumulated` | quoted decimal | `"0.00000000"` | Sum of all fees paid. |
| `take_profit_price` | quoted decimal | `"0.00000000"` | Active take-profit trigger price. |
| `liquidation_price` | quoted decimal | `"0.00000000"` | Active liquidation trigger price; `"0.00000000"` for spot (Multiplier=1). |
| `filled_orders_count` | integer | `0` | Number of completed DCA buy fills. |

### Analytics Fields

| Field | Type | No-Position Default | Calculation |
|-------|------|---------------------|-------------|
| `unrealized_pnl` | quoted decimal | `"0.00000000"` | `(candle_close − average_entry_price) × position_quantity` |
| `current_drawdown_pct` | quoted decimal | `"0.00000000"` | `(candle_low − average_entry_price) / average_entry_price × 100` |

> **Important**: `unrealized_pnl` uses `candle_close`; `current_drawdown_pct` uses `candle_low`.  
> This is the canonical distinction: PnL = settlement price; drawdown = worst intracandle price.

### Action Fields

All action fields carry sentinel defaults for non-fill events (`price_changed`, `position_opened`).

| Field | Type | No-Action Default | Description |
|-------|------|-------------------|-------------|
| `action_price` | quoted decimal | `"0.00000000"` | Fill price for this order. |
| `action_quantity` | quoted decimal | `"0.00000000"` | Fill quantity (base currency). |
| `action_fee` | quoted decimal | `"0.00000000"` | Fee paid for this fill. |
| `order_number` | integer | `0` | 1-indexed DCA order number (`OrderFill.OrderNumber`). |
| `realized_pnl` | quoted decimal | `"0.00000000"` | Net profit on position close. |
| `close_reason` | string | `""` | `"take_profit"`, `"liquidation"`, `"exit_on_last_order"`, or `""`. |

---

## Event Type to Field Population Matrix

| `event_type` | Action fields populated? | Position fields populated? | Analytics populated? |
|---|---|---|---|
| `price_changed` | No (all sentinels) | Yes, if position open | Yes, if position open |
| `position_opened` | Partially: `action_price` = entry price, `action_fee` = entry fee, `order_number` = 1 | Yes | Yes |
| `order_filled` | Yes: all action fields | Yes | Yes |
| `position_closed` | Yes: `realized_pnl`, `close_reason`, closing fill fields | Yes (final snapshot) | Yes (final snapshot) |

---

## Ingester Contract (Node.js)

The `WideEventIngester` MUST follow this exact sequence:

1. **Existence check**: if the file does not exist or is 0 bytes, log a warning and return `{ rowsInserted: 0 }`.
2. **Schema version check**: read the first line, parse it, verify `schema_version === 1`. Reject with error if unknown.
3. **Partition drop**: `ALTER TABLE {database}.wide_events DROP PARTITION '{runId}'` via `chClient.command()`.
4. **Stream insert**: `chClient.insert({ table: '{database}.wide_events', values: fs.createReadStream(filePath), format: 'JSONEachRow' })`.
5. **Row count verification**: compare `summary.written_rows` against file line count. Warn if mismatch.

The `ALTER TABLE DROP PARTITION` step is idempotent (safe if partition does not yet exist) — no guard required.
