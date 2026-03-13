# Contract: Engine JSON Protocol

**Layer**: Go engine stdin/stdout  
**Direction**: Node.js API → Go engine  
**Transport**: newline-delimited JSON (ndjson) over child process stdio  
**Version**: v2 (this feature)

---

## Request Schema (stdin)

Sent as a single JSON line to the engine's stdin, terminated with `\n`.

```json
{
  "trading_pair":                   "LTC/USDT",
  "start_date":                     "2024-01-02 14:00:00",
  "end_date":                       "2024-01-05 14:00:00",
  "price_entry":                    "2.00000000",
  "price_scale":                    "1.10000000",
  "amount_scale":                   "2.00000000",
  "number_of_orders":               10,
  "amount_per_trade":               "17500.00000000",
  "margin_type":                    "cross",
  "multiplier":                     1,
  "take_profit_distance_percent":   "0.50000000",
  "account_balance":                "1000.00000000",
  "exit_on_last_order":             false,
  "market_data_csv_path":           "/data/market/LTCUSDT-1m-2024-01.csv",
  "idempotency_key":                "550e8400-e29b-41d4-a716-446655440000"
}
```

### Field Types

| Field | JSON type | Notes |
|-------|-----------|-------|
| `trading_pair` | string | Slash-separated, e.g. `"LTC/USDT"` |
| `start_date` | string | `"YYYY-MM-DD HH:MM:SS"` |
| `end_date` | string | `"YYYY-MM-DD HH:MM:SS"` |
| `price_entry` | string | Decimal, 8 d.p., > 0 |
| `price_scale` | string | Decimal, 8 d.p., > 0 (e.g., `"1.1"`, `"2.0"`) |
| `amount_scale` | string | Decimal, 8 d.p., > 0 (e.g., `"2.0"`, `"1.05"`) |
| `number_of_orders` | number (int) | ≥ 1, ≤ 100 |
| `amount_per_trade` | string | Decimal, 8 d.p., > 0 |
| `margin_type` | string | `"cross"` or `"isolated"` |
| `multiplier` | number (int) | ≥ 1 |
| `take_profit_distance_percent` | string | Decimal, 8 d.p., > 0 |
| `account_balance` | string | Decimal, 8 d.p., > 0 |
| `exit_on_last_order` | boolean | — |
| `market_data_csv_path` | string | Absolute path, resolved by API |
| `idempotency_key` | string (optional) | UUID RFC 4122 |

### Removed Fields (v1 → v2 breaking change)

The following fields from the v1 schema are no longer accepted and MUST NOT be sent:

- `entry_price` → replaced by `price_entry`
- `amounts` → removed (computed by engine)
- `sequences` → removed (computed by engine)
- `leverage` → replaced by `multiplier`
- `margin_ratio` → removed (engine uses internal `mmr=0.0067`)

---

## Response Schema (stdout)

Single JSON object written to stdout, terminated with `\n`.

```json
{
  "events": [...],
  "execution_time_ms": 1234,
  "candle_count": 4320,
  "event_count": 18,
  "final_position": {
    "trading_pair":                  "LTC/USDT",
    "price_entry":                   "2.00000000",
    "multiplier":                    "1",
    "margin_type":                   "cross",
    "number_of_orders":              10,
    "amount_per_trade":              "17500.00000000",
    "account_balance":               "1000.00000000",
    "price_scale":                   "1.10000000",
    "amount_scale":                  "2.00000000",
    "take_profit_distance_percent":  "0.50000000",
    "exit_on_last_order":            false
  }
}
```

The `final_position` object now reflects all user-supplied parameters (not just 7 as in v1).

---

## Error Protocol (stderr)

On fatal error, the engine writes a human-readable message to **stderr** and exits with code 1.
The Node.js `ErrorMapper.ts` maps known stderr patterns to structured error codes.

New stderr patterns added by this feature:

| Pattern | Error Code | User Message |
|---------|-----------|--------------|
| `"Missing required field"` | `REQUEST_VALIDATION_FAILED` | Field name included in message |
| `"invalid price_entry"` | `VALIDATION_OUT_OF_BOUNDS` | — |
| `"invalid amount_scale"` | `VALIDATION_OUT_OF_BOUNDS` | — |
| `"invalid multiplier"` | `VALIDATION_OUT_OF_BOUNDS` | — |

---

## Versioning Notes

This is a **breaking** schema change. Both the Go engine binary and the Node.js API must be deployed
together. The API's `BacktestService.ts` sends the new schema; the engine's `main.go` expects the new
schema. Mixed deployment (old binary + new API or vice versa) will result in a `REQUEST_VALIDATION_FAILED`
error (engine exits on unknown/missing fields).

Backward compatibility for stored `BacktestResult` records is maintained — the response schema is
additive only (new fields in `final_position`).
