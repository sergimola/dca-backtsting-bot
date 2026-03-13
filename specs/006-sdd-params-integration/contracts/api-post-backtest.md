# Contract: HTTP API — POST /backtest

**Layer**: Node.js Express API  
**Endpoint**: `POST /backtest`  
**Content-Type**: `application/json`  
**Version**: v2 (this feature)

---

## Request Body

```json
{
  "trading_pair":                 "LTC/USDT",
  "start_date":                   "2024-01-02 14:00:00",
  "end_date":                     "2024-01-05 14:00:00",
  "price_entry":                  "2.00000000",
  "price_scale":                  "1.10000000",
  "amount_scale":                 "2.00000000",
  "number_of_orders":             10,
  "amount_per_trade":             "17500.00000000",
  "margin_type":                  "cross",
  "multiplier":                   1,
  "take_profit_distance_percent": "0.50000000",
  "account_balance":              "1000.00000000",
  "exit_on_last_order":           false,
  "idempotency_key":              "550e8400-e29b-41d4-a716-446655440000"
}
```

`market_data_csv_path` is **not accepted from clients** — it is derived server-side from
`trading_pair` and `start_date`.

---

## Successful Response — HTTP 200

```json
{
  "request_id":       "uuid",
  "status":           "success",
  "events":           [...],
  "final_position":   { ...all 13 params echoed back... },
  "pnl_summary": {
    "roi_percent":            "12.34",
    "total_fees":             "8.75",
    "safety_order_usage_counts": { "0": 42, "1": 18 }
  },
  "execution_time_ms": 1234,
  "timestamp":         "2026-03-12T10:00:00.000Z"
}
```

---

## Error Responses

### HTTP 400 — Validation failure

```json
{
  "error": {
    "error_code": "VALIDATION_MISSING_FIELD",
    "message":    "Missing required field: price_entry",
    "field":      "price_entry"
  }
}
```

### HTTP 400 — Market data not found

```json
{
  "error": {
    "error_code": "CSV_FILE_NOT_FOUND",
    "message":    "Market data not found for LTC/USDT (2024-01). Expected: LTCUSDT-1m-2024-01.csv",
    "field":      "trading_pair"
  }
}
```

### HTTP 400 — Same-month guard violated

```json
{
  "error": {
    "error_code": "VALIDATION_OUT_OF_BOUNDS",
    "message":    "start_date and end_date must be within the same calendar month. Multi-month backtests are not yet supported.",
    "field":      "end_date"
  }
}
```

### HTTP 422 — Engine execution failure

```json
{
  "error": {
    "error_code": "BACKTEST_EXECUTION_FAILED",
    "message":    "Core engine failed: <stderr excerpt>",
    "technical_message": "..."
  }
}
```

---

## Field Validation Rules

| Field | Rule | Error code on failure |
|-------|------|-----------------------|
| `trading_pair` | Non-empty string, must contain `/` | `VALIDATION_MISSING_FIELD` |
| `start_date` | parseable `YYYY-MM-DD HH:MM:SS`, not empty | `VALIDATION_TYPE_ERROR` |
| `end_date` | parseable `YYYY-MM-DD HH:MM:SS`, after `start_date` | `VALIDATION_OUT_OF_BOUNDS` |
| `start_date` + `end_date` | Same calendar month (MVP) | `VALIDATION_OUT_OF_BOUNDS` |
| `price_entry` | Decimal string > 0 | `VALIDATION_OUT_OF_BOUNDS` |
| `price_scale` | Decimal string > 0 | `VALIDATION_OUT_OF_BOUNDS` |
| `amount_scale` | Decimal string > 0 | `VALIDATION_OUT_OF_BOUNDS` |
| `number_of_orders` | Integer ≥ 1, ≤ 100 | `VALIDATION_OUT_OF_BOUNDS` |
| `amount_per_trade` | Decimal string > 0 | `VALIDATION_OUT_OF_BOUNDS` |
| `margin_type` | `"cross"` or `"isolated"` | `VALIDATION_TYPE_ERROR` |
| `multiplier` | Integer ≥ 1 | `VALIDATION_OUT_OF_BOUNDS` |
| `take_profit_distance_percent` | Decimal string > 0 | `VALIDATION_OUT_OF_BOUNDS` |
| `account_balance` | Decimal string > 0 | `VALIDATION_OUT_OF_BOUNDS` |
| `exit_on_last_order` | Boolean | `VALIDATION_TYPE_ERROR` |
| `idempotency_key` | UUID RFC 4122 (if present) | `VALIDATION_TYPE_ERROR` |
