# API Contract: monthly_addition Parameter — Feature 012

**Branch**: `012-monthly-capital-injection`  
**Date**: 2026-03-16  
**Interface type**: REST endpoint extension (POST /backtests)

---

## Overview

Feature 012 extends the `POST /backtests` request body with a single new optional field: `monthly_addition`. The field is forwarded verbatim to the Go engine's `EngineRequest.MonthlyAddition` and becomes the capital injection amount applied every 43,200 1-minute candles.

---

## `POST /backtests` — Extended Request Body

### New Field

| Field | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `monthly_addition` | `string` (decimal) | No | `"0"` | Non-negative decimal string; must be parseable as a finite decimal number |

### Extended Example

```json
{
  "trading_pair": "BTC/USDC",
  "start_date": "2022-01-01T00:00:00Z",
  "end_date": "2025-01-01T00:00:00Z",
  "price_entry": "2.0",
  "price_scale": "1.1",
  "amount_scale": "2.0",
  "number_of_orders": 5,
  "amount_per_trade": "0.10",
  "margin_type": "cross",
  "multiplier": 1,
  "take_profit_distance_percent": "2.5",
  "account_balance": "1000.00",
  "monthly_addition": "500.00",
  "exit_on_last_order": false
}
```

### Validation Behaviour

| Submitted value | Server response |
|---|---|
| Field absent | Treated as `"0"`; no error |
| `"0"` | Valid; no monthly additions fire |
| `"500.00"` | Valid |
| `"500"` | Valid |
| `"-50"` | `400 Bad Request` — `monthly_addition` must be >= 0 |
| `"abc"` | `400 Bad Request` — decimal parse error on `monthly_addition` |
| `-50` (number, not string) | `400 Bad Request` — type error: must be a string decimal |

### Error Response Shape

Matches existing validation error contract:

```json
{
  "error": {
    "code": "VALIDATION_OUT_OF_BOUNDS",
    "message": "monthly_addition must be >= 0, got -50",
    "details": {
      "field": "monthly_addition"
    }
  }
}
```

---

## `GET /backtests/:id` — Result Response (unchanged shape)

The `config` object in the stored result will now include `monthly_addition` when present. Historical records without the field return `monthly_addition: undefined` (not `"0"`); callers should treat absence the same as `"0"`.

No other response fields change.

---

## `MonthlyAdditionEvent` — Event Bus Contract

Emitted into the Orchestrator's event bus at each 43,200-candle boundary (when `monthly_addition > 0`). Published as part of the engine's standard event stream.

```json
{
  "type": "monthly.addition",
  "run_id": "...",
  "trade_id": "...",
  "timestamp": "2022-02-01T00:00:00Z",
  "addition_amount": "500.00",
  "previous_balance": "1000.00",
  "new_balance": "1500.00",
  "addition_number": 1,
  "days_since_start": 30
}
```

| Field | Description |
|---|---|
| `addition_number` | 1-based index of this injection (`globalCandleCount / 43200`) |
| `days_since_start` | `globalCandleCount / 1440` |
| `previous_balance` | `runningBalance` before this injection |
| `new_balance` | `position.AccountBalance` after injection (when position open); `runningBalance` otherwise |

**Emission condition**: Only when `globalCandleCount % 43200 == 0 AND monthly_addition > 0 AND position is open`. When no position is open at the boundary, the balance is silently updated without emitting an event (no `TradeID` to associate it with).

---

## Frontend `BacktestFormState` Contract

```typescript
interface BacktestFormState {
  // ... existing 13 fields ...
  monthlyAddition: string  // NEW — maps to monthly_addition in API payload
}
```

**Serialization rule**: When `monthlyAddition === ''` or `monthlyAddition.trim() === ''`, the API payload sends `"monthly_addition": "0"`. Otherwise, sends the string verbatim.

---

## Backward Compatibility

- All existing backtest requests without `monthly_addition` continue to work identically.
- The Go engine defaults to `decimal.Zero` when the field is absent, producing no behavioral change.
- No database migration is required.
- No breaking change to any existing API consumer.
