# Contract: Backtest Status API

**Feature**: 008-clickhouse-market-data  
**Date**: 2026-03-14  
**Status**: Additive change to existing contract

This document describes the changes to the HTTP API surface introduced by this feature.

---

## `GET /backtest/:id` — Status Response

Polling endpoint used by the frontend to track progress. This feature adds a new possible value for the `status` field.

### Status Enum (updated)

```typescript
type BacktestStatus =
  | 'PENDING'
  | 'DOWNLOADING_DATA'   // NEW — gap resolver is fetching from Binance
  | 'RUNNING'
  | 'COMPLETE'
  | 'FAILED';
```

### Response Schema

```typescript
interface BacktestStatusResponse {
  id:      string;
  status:  BacktestStatus;
  message: string;       // human-readable description of current state
  error?:  string;       // present only when status === 'FAILED'
}
```

### `message` values by state

| Status | Example `message` |
|--------|-------------------|
| `PENDING` | `"Queued — waiting to start"` |
| `DOWNLOADING_DATA` | `"Downloading missing market data for BTCUSDT (2024-01-01 → 2024-02-01)…"` |
| `RUNNING` | `"Backtest in progress"` |
| `COMPLETE` | `"Backtest complete"` |
| `FAILED` | `"Data download failed: exchange API unreachable"` |

### Backward Compatibility

This is an **additive change**. Existing clients that only handle `PENDING`, `RUNNING`, `COMPLETE`, and `FAILED` will receive `DOWNLOADING_DATA` as an unknown value. The frontend must be updated to display it rather than falling through to an error state.

---

## `POST /backtest` — Request Changes

No change to the request schema. The trading parameters stay the same; `market_data_csv_path` is no longer accepted or forwarded.

### Removed from internal processing (not user-facing)

The API no longer expects a `market_data_csv_path` from the request — this was never a public field, only used internally to pass data to the Go engine. Its role is now fulfilled by the ClickHouse connection injection.

---

## New Environment Variables

The following environment variables must be set for the Node.js API process:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLICKHOUSE_HOST` | Yes | `http://localhost` | Base URL with scheme |
| `CLICKHOUSE_PORT` | No | `8123` | HTTP port for the Node.js `@clickhouse/client-node` |
| `CLICKHOUSE_NATIVE_PORT` | No | `9000` | Native TCP port forwarded to the Go engine |
| `CLICKHOUSE_DATABASE` | No | `default` | Database name |
| `CLICKHOUSE_USER` | No | `default` | Username |
| `CLICKHOUSE_PASSWORD` | No | `""` | Password |

**Note**: The Node.js API uses the HTTP port (8123) for gap detection queries and batch inserts. The Go engine is passed the native port (9000) in the stdin JSON for streaming efficiency.
