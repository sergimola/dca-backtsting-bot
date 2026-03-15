# Research: Auto-Downloader & ClickHouse Migration

**Feature**: 008-clickhouse-market-data  
**Date**: 2026-03-14  
**Status**: Complete — no NEEDS CLARIFICATION items remain

---

## R-001: Go ClickHouse Driver

**Decision**: Use `github.com/ClickHouse/clickhouse-go/v2` (native interface, not `database/sql` wrapper)

**Rationale**: The native interface exposes `conn.PrepareBatch()` for zero-overhead bulk inserts, `conn.Query()` returning a block-streaming cursor that never buffers all rows, and struct-tag marshaling (`batch.AppendStruct`). The `database/sql` wrapper adds reflection overhead and blocks access to the native batch API. For 1–3 million row streaming, the native interface is measurably faster (benchmark: 675ms vs 924ms for equivalent bulk writes).

**Alternatives considered**:
- `database/sql` wrapper — rejected: slower, no native batch API, no struct marshaling
- `uptrace/go-clickhouse` — rejected: less maintained, smaller community, v2 driver is the official ClickHouse-endorsed library

**Version**: `v2.43.0` (latest stable, Jan 29 2026)

**Add command**:
```bash
go get github.com/ClickHouse/clickhouse-go/v2@v2.43.0
```

**Key patterns**:

*Streaming query (memory-flat):*
```go
rows, err := conn.Query(ctx, `
    SELECT symbol, timestamp, open, high, low, close, volume
    FROM market_data FINAL
    WHERE symbol = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
`, symbol, start, end)
defer rows.Close()

for rows.Next() {
    var c Candle
    if err := rows.Scan(&c.Symbol, &c.Timestamp, &c.Open, &c.High, &c.Low, &c.Close, &c.Volume); err != nil {
        return err
    }
    // send to channel
}
return rows.Err()
```

*Native connection open:*
```go
conn, err := clickhouse.Open(&clickhouse.Options{
    Addr:            []string{os.Getenv("CLICKHOUSE_HOST") + ":" + os.Getenv("CLICKHOUSE_PORT")},
    Auth:            clickhouse.Auth{Database: os.Getenv("CLICKHOUSE_DB"), Username: os.Getenv("CLICKHOUSE_USER"), Password: os.Getenv("CLICKHOUSE_PASSWORD")},
    BlockBufferSize: 10,  // default 2; increase for large streaming queries
    MaxOpenConns:    5,
})
```

**Context cancellation**: Cancelling the context passed to `conn.Query()` terminates client-side decoding and signals the server. Add `max_execution_time` server setting for hard server-side cap.

---

## R-002: Node.js ClickHouse Client

**Decision**: Use `@clickhouse/client-node` (the Node.js-specific package from the official ClickHouse JS client family)

**Rationale**: The `-node` variant uses native Node.js HTTP streams, avoiding fetch-polyfill overhead. It exposes a typed `insert<T>()` method that streams `JSONEachRow` format, which handles arrays of 1,000+ objects efficiently. It has a `ping()` method for startup health checks and parameterised query support to prevent injection.

**Alternatives considered**:
- `@clickhouse/client` (universal) — would also work; `-node` preferred for backend HTTP stream performance
- Raw HTTP via `fetch` / `axios` — rejected: no typed API, no connection pooling, manual error handling

**Version**: `1.9.x` latest stable

**Install command**:
```bash
npm install @clickhouse/client-node
```

**Key patterns**:

*Client init (env vars):*
```typescript
import { createClient } from '@clickhouse/client-node';

export const chClient = createClient({
  url: `${process.env.CLICKHOUSE_HOST ?? 'http://localhost'}:${process.env.CLICKHOUSE_PORT ?? 8123}`,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE ?? 'default',
});
```

*Batch insert (1000+ rows):*
```typescript
await chClient.insert<OHLCVRow>({
  table: 'market_data',
  values: rows,        // OHLCVRow[]
  format: 'JSONEachRow',
});
```

*Gap detection query:*
```typescript
const result = await chClient.query({
  query: `SELECT COUNT(*) AS cnt FROM market_data FINAL
          WHERE symbol = {symbol:String}
            AND timestamp >= {start:DateTime64(3)}
            AND timestamp <= {end:DateTime64(3)}`,
  query_params: { symbol, start: startISO, end: endISO },
  format: 'JSONEachRow',
});
const rows = await result.json<{ cnt: string }>();
```

**Note**: ClickHouse returns `DateTime64` as a string like `'2024-01-15 12:00:00.000'`. Use `new Date(raw.replace(' ', 'T') + 'Z')` to convert safely.

---

## R-003: Binance OHLCV Download (ccxt)

**Decision**: Use `ccxt` library with `binance` exchange adapter, `fetchOHLCV('BTC/USDT', '1m', since, 1000)` with manual pagination

**Rationale**: `ccxt` is the de-facto standard for exchange API unification. It handles authentication, request signing, and built-in rate limiting via a leaky-bucket mechanism. The Binance adapter supports `fetchOHLCV` returning `[timestamp, open, high, low, close, volume][]`. The `enableRateLimit: true` default (50ms inter-request for Binance) prevents IP bans without manual `sleep()` calls.

**Alternatives considered**:
- Binance REST API directly via `axios` — rejected: need to re-implement rate limiting, error handling, time synchronisation
- `binance-api-node` — rejected: single-exchange, less maintained, no multi-symbol support for future extension

**Version**: `4.5.x` latest stable (`npm install ccxt`)

**Pagination pattern**:
```typescript
let since = startDate.getTime(); // Unix ms
while (since < endDate.getTime()) {
  const raw = await exchange.fetchOHLCV(symbol, '1m', since, 1000);
  if (raw.length === 0) break;
  // collect candles with ts <= endDate.getTime()
  const lastTs = raw[raw.length - 1][0];
  if (lastTs >= endDate.getTime() || raw.length < 1000) break;
  since = lastTs + 1;
}
```

**Rate limiting**: `enableRateLimit: true` is the default. This respects Binance's 1200 weight/min limit. No manual delays needed.

**Symbol format**: ccxt uses `'BTC/USDT'` (slash notation). Existing `MarketDataResolver` normalises to `'BTCUSDC'` — the new resolver must NOT apply that normalisation; it must pass the slash format directly to ccxt (e.g. `'ETH/USDT'`).

---

## R-004: Gap Detection Strategy

**Decision**: Count-based gap detection — compare `COUNT(*) FINAL` of stored candles against expected candle count for the requested range.

**Rationale**: For 1-minute candles, the expected count for a date range is `floor((endMs - startMs) / 60000) + 1`. If the stored count matches, the data is complete. This is simple, correct, and executes as a single aggregation query. It handles internal gaps (e.g., exchange downtime) by re-downloading the whole missing sub-range.

**Alternatives considered**:
- `MAX(timestamp)` check only — rejected: detects trailing gaps but misses internal holes
- Full sparse gap scan (window functions) — rejected: complex, slow for large tables, overkill for an exchange that has near-complete data; COUNT is sufficient for this use case

**Implementation**:
1. Query `SELECT MIN(timestamp), MAX(timestamp), COUNT(*) AS cnt FROM market_data FINAL WHERE symbol = ? AND timestamp BETWEEN start AND end`
2. `expectedCount = Math.floor((end - start) / 60_000) + 1`
3. If `cnt >= expectedCount AND minTs <= start AND maxTs >= end` → data complete → start engine
4. Otherwise → download missing range → insert → start engine

**Note**: `ReplacingMergeTree` deduplication is asynchronous. Using `FINAL` in the query forces synchronous deduplication before counting, ensuring accuracy at the cost of a small query-time overhead. This overhead is acceptable at detection-time (once per backtest request).

---

## R-005: Engine Stdin Contract Change

**Decision**: Replace `market_data_csv_path` field in the Go engine's stdin JSON with ClickHouse connection parameters (`clickhouse_addr`, `clickhouse_db`, `clickhouse_user`, `clickhouse_password`).

**Rationale**: The Go engine is a child process launched by the Node.js API. Injecting connection info via stdin JSON is the lowest-coupling approach — it requires no new environment variables in the child process and keeps the API in control of which database the engine connects to. This also makes the engine hermetically testable by pointing it at a test database.

**Alternatives considered**:
- Environment variables inherited by child process — rejected: couples the Node process env to the Go env making them harder to configure independently; stdin injection is already the established pattern
- Shared config file — rejected: requires file system coordination, adds a race condition

**New stdin fields** (replaces `market_data_csv_path`):
```json
{
  "clickhouse_addr":     "localhost:9000",
  "clickhouse_db":       "dca_bot",
  "clickhouse_user":     "default",
  "clickhouse_password": ""
}
```

---

## R-006: DOWNLOADING_DATA Status State

**Decision**: Add `DOWNLOADING_DATA` as a new terminal-transient state in the backtest status state machine, surfaced via the existing status polling mechanism.

**Rationale**: The existing status model is synchronous — `POST /backtest` blocks until completion. To support a visible `DOWNLOADING_DATA` phase, the route handler must transition to an async model: set status to `DOWNLOADING_DATA` when the gap resolver starts fetching, then to `RUNNING` when the engine is launched. The frontend polls `GET /backtest/:id` and reacts to each state.

**State machine**:
```
PENDING → DOWNLOADING_DATA → RUNNING → COMPLETE
                           ↘ FAILED
         ↘ RUNNING (if no gap) → COMPLETE
                              ↘ FAILED
```

**Alternatives considered**:
- WebSocket push — rejected: out of scope, more infrastructure, spec calls for polling
- No status (keep blocking) — rejected: users perceive frozen UI on large downloads, violates User Story 3

---

## R-007: ClickHouse Schema

**Decision**: Use `ReplacingMergeTree` ordered on `(symbol, timestamp)` with `DateTime64(3, 'UTC')`.

**Rationale**: `ReplacingMergeTree` provides background deduplication — overlap between adjacent download batches is automatically resolved without error. `ORDER BY (symbol, timestamp)` is the optimal key for the access pattern: always filtering by symbol and ranging by time. Millisecond precision (`DateTime64(3)`) preserves sub-second data if the exchange ever provides it; 1-minute OHLCV candles are stored with `000` ms suffix (no precision loss).

**Final DDL**:
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

**Alternatives considered**:
- `MergeTree` without replacing — rejected: would require exact-duplicate checking before every insert, making the downloader fragile on batch boundaries
- `AggregatingMergeTree` — rejected: overkill for raw OHLCV storage, complicates queries
- `TimescaleDB` — rejected: mentioned in constitution as an alternative; ClickHouse is spec'd directly; timescale requires Postgres extension stack
