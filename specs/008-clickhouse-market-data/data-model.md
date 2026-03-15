# Data Model: Auto-Downloader & ClickHouse Migration

**Feature**: 008-clickhouse-market-data  
**Date**: 2026-03-14

---

## Entity: Candle (OHLCV)

The canonical unit of market data. One row per trading symbol per minute.

### ClickHouse Table DDL

```sql
CREATE TABLE IF NOT EXISTS market_data (
    symbol    String,
    timestamp DateTime64(3, 'UTC'),
    open      Float64,
    high      Float64,
    low       Float64,
    close     Float64,
    volume    Float64
) ENGINE = ReplacingMergeTree()
ORDER BY (symbol, timestamp);
```

### Constraints & Rules

| Rule | Value |
|------|-------|
| Primary key | `(symbol, timestamp)` — enforced by `ORDER BY` + background deduplication |
| Timestamp precision | Milliseconds (`DateTime64(3, 'UTC')`) |
| Deduplication | `ReplacingMergeTree` — background merge resolves exact `(symbol, timestamp)` duplicates silently |
| Query accuracy | Use `FINAL` modifier on SELECT for count/gap detection to force synchronous dedup |
| OHLCV validity | `high >= open`, `high >= close`, `high >= low`, `low <= open`, `low <= close` — enforced in application layer before insert |
| Minimum batch size | 1,000 rows per INSERT (constitution gate) |

### Go Struct (application/orchestrator)

```go
// Candle represents a single OHLCV candlestick from ClickHouse.
// Field names map to ClickHouse column names via struct tags.
type Candle struct {
    Symbol    string          `ch:"symbol"`
    Timestamp time.Time       `ch:"timestamp"`
    Open      decimal.Decimal
    High      decimal.Decimal
    Low       decimal.Decimal
    Close     decimal.Decimal
    Volume    decimal.Decimal
}
```

No change to the `Candle` struct shape — only the source changes from CSV parsing to CH scan.

### TypeScript Shape (Node.js insert)

```typescript
interface OHLCVRow {
  symbol:    string;
  timestamp: string;    // ISO 8601 UTC, e.g. "2024-01-01T00:00:00.000Z"
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
}
```

---

## Entity: MarketDataGap

A contiguous time interval with no candle records in the database for a given symbol. The GapResolver computes these before a backtest starts.

### TypeScript Shape

```typescript
interface MarketDataGap {
  symbol:    string;    // e.g. "BTC/USDT" (slash notation, ccxt format)
  startDate: Date;      // inclusive — first missing minute
  endDate:   Date;      // inclusive — last missing minute
}
```

### Computation Logic

```
expectedCount = Math.floor((endMs - startMs) / 60_000) + 1
actualCount   = COUNT(*) FINAL WHERE symbol = ? AND timestamp BETWEEN start AND end

if actualCount >= expectedCount:
    return []  ← no gap

else:
    return [{ symbol, startDate, endDate }]   ← full range to be downloaded
```

The gap is expressed as the full requested range, not a partial sub-range. Partial counts may occur due to internal exchange gaps (downtime), and re-downloading the full range is safe because `ReplacingMergeTree` deduplicates on insert.

---

## Entity: BacktestStatus

The state machine visible to the frontend via `GET /backtest/:id`.

### State Definitions

| State | Description |
|-------|-------------|
| `PENDING` | Job received, gap check not yet run |
| `DOWNLOADING_DATA` | GapResolver is actively fetching candles from Binance |
| `RUNNING` | Go engine subprocess is active |
| `COMPLETE` | Engine exited successfully; results available |
| `FAILED` | Any stage (gap check, download, engine) encountered an unrecoverable error |

### State Transitions

```
PENDING
  ├─► DOWNLOADING_DATA  (gap detected, download started)
  │       ├─► RUNNING       (download complete, engine started)
  │       │       ├─► COMPLETE
  │       │       └─► FAILED
  │       └─► FAILED        (download error)
  └─► RUNNING           (no gap, engine started immediately)
          ├─► COMPLETE
          └─► FAILED
```

### TypeScript Enum

```typescript
export type BacktestStatus =
  | 'PENDING'
  | 'DOWNLOADING_DATA'
  | 'RUNNING'
  | 'COMPLETE'
  | 'FAILED';
```

---

## Entity: EngineRequest

The JSON payload written to the Go engine's stdin. This evolves from the current shape by replacing `market_data_csv_path` with ClickHouse connection fields.

### Before (current)

```typescript
{
  // ... 13 SDD params
  market_data_csv_path: string;
  idempotency_key:      string;
}
```

### After (this feature)

```typescript
{
  // ... 13 SDD params (unchanged)
  clickhouse_addr:     string;  // e.g. "localhost:9000" (native TCP)
  clickhouse_db:       string;  // e.g. "dca_bot"
  clickhouse_user:     string;  // e.g. "default"
  clickhouse_password: string;  // e.g. ""
  idempotency_key:     string;  // unchanged
  // market_data_csv_path — REMOVED
}
```

---

## Entity: DownloadBatch

A batch of candles fetched in a single Binance API call and written in a single ClickHouse INSERT.

### Rules

| Rule | Value |
|------|-------|
| Max rows per Binance call | 1,000 candles |
| Min rows per CH insert | 1,000 rows (constitution gate) |
| Flush strategy | Insert each Binance page immediately after fetch (1 fetch → 1 insert) |
| Exception | Final page (< 1,000 candles) is still inserted as-is — the minimum is only enforced for non-final pages where feasible. Accumulating pages to reach 1,000 is the preferred pattern for very sparse ranges. |
| Pacing | Must enforce rate limits (`ccxt` `enableRateLimit: true` **plus** an explicit `sleep(250ms)`) between chunk fetches to prevent exchange IP bans during multi-year backfills. |
| Open Candle Discard | The system MUST check the timestamp of the very last fetched candle. If it represents the current, ongoing (unclosed) minute — i.e. `lastCandleTs >= Math.floor(Date.now() / 60_000) * 60_000` — it MUST be removed from the batch before insertion. Storing an in-progress candle corrupts volume permanently; deduplication cannot repair incorrect values. |

---

## Entity: CandleLoader (Go interface)

The abstraction that decouples the orchestrator from the data source. Replaces the direct `CSVLoader` usage.

```go
// CandleLoader streams candles into the orchestrator.
// Implementations: ClickHouseCandleLoader (production), MockCandleLoader (tests).
type CandleLoader interface {
    // NextCandle returns the next candle in ascending timestamp order.
    // Returns (nil, nil) at end-of-stream.
    // Returns (nil, err) on error.
    NextCandle() (*Candle, error)

    // Close releases underlying resources (DB connection, cursor).
    Close() error
}
```

This interface preserves the orchestrator's streaming loop unchanged — the only behavioral difference is the source of `*Candle` values.
