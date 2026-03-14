# Implementation Plan: Auto-Downloader & ClickHouse Migration

**Branch**: `008-clickhouse-market-data` | **Date**: 2026-03-14 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `/specs/008-clickhouse-market-data/spec.md`

## Summary

Migrate the DCA backtesting system from flat CSV files to ClickHouse as the sole market data store. The Node.js API gains a `GapResolver` that checks ClickHouse coverage for the requested symbol/range, auto-downloads missing candles from Binance via `ccxt` (paginated, 1,000 rows per page, strictly rate-limited with sleep intervals to prevent IP bans, open-candle truncation, and bulk-inserted), and surfaces a `DOWNLOADING_DATA` status to the UI. The Go engine's `CSVLoader` is replaced by a `ClickHouseCandleLoader` that streams rows directly from ClickHouse over the native TCP driver — eliminating the CSV file path entirely from the request contract.

## Technical Context

**Language/Version**: Go 1.26.1 (core engine), TypeScript 5.x / Node.js 20 (API), React 18 (frontend)  
**Primary Dependencies**:
- Go engine: `github.com/ClickHouse/clickhouse-go/v2@v2.43.0` (new), `github.com/shopspring/decimal v1.4.0` (existing)
- Node API: `@clickhouse/client-node` 1.9.x (new), `ccxt` 4.5.x (new), Express 5, Pino (existing)
- Frontend: React 18, existing polling hook (no new deps)

**Storage**: ClickHouse — `ReplacingMergeTree`, ordered on `(symbol, timestamp)`, 1-minute OHLCV candles  
**Testing**: Go `testing` package + BDD acceptance scenarios, Jest + Supertest (Node), Jest (frontend)  
**Target Platform**: Local dev — ClickHouse in Docker (Linux image), Go binary (Windows/Linux), Node 20 server  
**Project Type**: Polyglot web service + compiled engine binary  
**Performance Goals**: 3-year backtest (≈1.5M 1-minute candles) must complete without OOM; memory profile flat regardless of date range  
**Constraints**: Min 1,000 rows per CH insert; Go engine must never receive candle rows via stdin; no CSV fallback  
**Scale/Scope**: Single user, single symbol per backtest, up to 5 years of 1-minute data (~2.6M candles)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked post-design below.*

| Gate | Status | How Satisfied |
|------|--------|---------------|
| **No Live Trading** | ✅ PASS | Feature adds data storage and retrieval only. No order execution, no broker connectivity. |
| **Green Light Protocol** | ✅ PASS | All existing CSV loader tests (`csv_loader_test.go`, `csv_loader_bench_test.go`) are deleted with their implementation; new `clickhouse_loader_test.go` replaces them. Existing orchestrator and integration tests are updated to use `MockCandleLoader`. The PR must not be merged while any test is red. |
| **Fixed-point arithmetic** | ✅ PASS | Candle OHLCV fields (open/high/low/close/volume) are stored as `Float64` in ClickHouse (not monetary values). All monetary calculations (entry prices, order sizes, profits, fees) remain in `shopspring/decimal` in the domain layer — this feature does not touch those code paths. |
| **Single-position invariant** | ✅ PASS | The orchestrator loop logic is unchanged; only the candle data source changes from `CSVLoader` to `ClickHouseCandleLoader` via the `CandleLoader` interface. |
| **Gap-Down Rule** | ✅ PASS | Execution logic is untouched. |
| **Architecture: adapters outside domain** | ✅ PASS | `ClickHouseCandleLoader` is placed in `core-engine/application/orchestrator/` (the adapter layer), not in `core-engine/domain/`. Node.js services (`GapResolver`, `BinanceDownloader`, `ClickHouseWriter`) are in `orchestrator/api/src/services/`. |
| **ClickHouse Batching Rule** | ✅ PASS | `BinanceDownloader` accumulates candles and calls `ClickHouseWriter.insert()` per page (≥1,000 rows per insert). Single-row inserts are structurally impossible — the insert method only accepts arrays. Enforced by a unit test that stubs the CH client and asserts `insert()` is never called with fewer than 1,000 rows. |
| **Go Engine Independence** | ✅ PASS | The Go engine receives only a ClickHouse DSN (not candle data) via stdin. It opens its own native TCP connection to ClickHouse. The Node.js API never queries the `market_data` table and relays results to Go. |
| **BDD acceptance criteria** | ✅ PASS | Given/When/Then scenarios in spec User Stories 1–3 are binding. Each has a corresponding integration test. |
| **OTel / Observability** | ℹ️ N/A | This feature does not add new tracing spans; it replaces an existing I/O path. Existing OTel instrumentation is unaffected. |

**Post-design re-check**: All gates remain satisfied after Phase 1 design. No violations require justification.

## Project Structure

### Documentation (this feature)

```text
specs/008-clickhouse-market-data/
├── plan.md              ← this file
├── spec.md
├── research.md          ← Phase 0 complete
├── data-model.md        ← Phase 1 complete
├── quickstart.md        ← Phase 1 complete
├── contracts/
│   ├── engine-protocol.md   ← Phase 1 complete
│   └── api-status.md        ← Phase 1 complete
└── tasks.md             ← generated by /speckit.tasks (next step)
```

### Source Code Changes — Feature Placement

```text
core-engine/                                          # Go engine — adapter only
  application/orchestrator/
    clickhouse_loader.go            NEW   ← CandleLoader interface + ClickHouseCandleLoader
    clickhouse_loader_test.go       NEW   ← unit tests for CH loader (mock conn)
    orchestrator.go                 MOD   ← accept CandleLoader instead of io.Reader
    orchestrator_test.go            MOD   ← inject MockCandleLoader in tests
    config.go                       MOD   ← remove DataSourcePath, add CH connection fields
    types.go                        MOD   ← add ClickHouseConfig struct
    csv_loader.go                   DEL   ← removed entirely
    csv_loader_test.go              DEL   ← removed with implementation
    csv_loader_bench_test.go        DEL   ← removed with implementation
  cmd/engine/main.go                MOD   ← read CH fields from stdin; open CH connection
  go.mod                            MOD   ← add clickhouse-go/v2 dependency

orchestrator/api/                                     # Node.js API — gap + download logic
  src/services/
    GapResolver.ts                  NEW   ← replaces MarketDataResolver.ts; CH coverage check
    BinanceDownloader.ts            NEW   ← ccxt-based paginated OHLCV fetcher
    ClickHouseWriter.ts             NEW   ← batch insert service (enforces ≥1000 rows)
    ClickHouseClient.ts             NEW   ← singleton @clickhouse/client-node instance
    MarketDataResolver.ts           DEL   ← replaced by GapResolver.ts
    MarketDataResolver.test.ts      DEL   ← replaced by GapResolver.test.ts
    GapResolver.test.ts             NEW   ← unit tests for gap detection logic
    BinanceDownloader.test.ts       NEW   ← unit tests (ccxt exchange stubbed)
    ClickHouseWriter.test.ts        NEW   ← unit tests (batch size enforcement)
    BacktestService.ts              MOD   ← pass CH fields instead of csv path
  src/routes/
    backtest.routes.ts              MOD   ← async status; DOWNLOADING_DATA transitions
  src/types/
    index.ts                        MOD   ← add BacktestStatus.DOWNLOADING_DATA
  package.json                      MOD   ← add @clickhouse/client-node, ccxt

frontend/src/                                         # React frontend — UI state
  services/backtest-api.ts          MOD   ← handle DOWNLOADING_DATA in polling
  components/                       MOD   ← display "Downloading market data…" message
```

## Complexity Tracking

No constitution violations. No extra complexity justification required.

---

## Implementation Phases

### Phase A — Go Engine: ClickHouse Data Loader

**Scope**: Replace `CSVLoader` with `ClickHouseCandleLoader` inside `core-engine/application/orchestrator/`. No domain-layer changes.

#### A1 — Add `clickhouse-go/v2` dependency

```bash
cd core-engine
go get github.com/ClickHouse/clickhouse-go/v2@v2.43.0
```

Update `go.work` if needed to propagate into the workspace.

#### A2 — Define `CandleLoader` interface

**File**: `core-engine/application/orchestrator/types.go` (extend existing)

```go
// CandleLoader is the abstraction over any candle data source.
// Implementations: ClickHouseCandleLoader (production), MockCandleLoader (tests).
type CandleLoader interface {
    NextCandle() (*Candle, error)
    Close() error
}
```

#### A3 — Implement `ClickHouseCandleLoader`

**File**: `core-engine/application/orchestrator/clickhouse_loader.go` (new)

```go
type ClickHouseConfig struct {
    Addr     string
    Database string
    User     string
    Password string
}

type ClickHouseCandleLoader struct {
    conn   driver.Conn
    rows   driver.Rows
    ctx    context.Context
    cancel context.CancelFunc
}

func NewClickHouseCandleLoader(ctx context.Context, cfg ClickHouseConfig,
    symbol, startDate, endDate string) (*ClickHouseCandleLoader, error)
```

Internally:
1. `clickhouse.Open(&clickhouse.Options{Addr: [cfg.Addr], Auth: ..., BlockBufferSize: 10})`
2. Execute `SELECT symbol, timestamp, open, high, low, close, volume FROM market_data FINAL WHERE symbol = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC`
3. Return the loader holding the open `rows` cursor

`NextCandle()` calls `rows.Next()` / `rows.Scan()` — yields one `*Candle` per call.  
`Close()` calls `rows.Close()` then `conn.Close()`.

#### A4 — Refactor `Orchestrator.RunBacktest`

**File**: `core-engine/application/orchestrator/orchestrator.go`

Replace signature:
```go
// Before:
func (o *Orchestrator) RunBacktest(csvReader io.Reader) (*BacktestRun, error)

// After:
func (o *Orchestrator) RunBacktest(loader CandleLoader) (*BacktestRun, error)
```

The loop body is unchanged — it still calls `loader.NextCandle()` in a for loop.

#### A5 — Update `main.go`

**File**: `core-engine/cmd/engine/main.go`

1. Remove `MarketDataCSVPath` from `EngineRequest`
2. Add `ClickhouseAddr`, `ClickhouseDb`, `ClickhouseUser`, `ClickhousePassword` to `EngineRequest`
3. Replace `os.Open(request.MarketDataCSVPath)` with `NewClickHouseCandleLoader(ctx, chConfig, symbol, startDate, endDate)`
4. Pass loader directly to `orch.RunBacktest(loader)` instead of a file

#### A6 — Delete CSV files, update tests

- Delete `csv_loader.go`, `csv_loader_test.go`, `csv_loader_bench_test.go`
- Add `clickhouse_loader_test.go` with a `MockCandleLoader` and unit tests for `ClickHouseCandleLoader` (using a test ClickHouse instance or mock `driver.Rows`)
- Update `orchestrator_test.go` and `integration_test.go` to inject `MockCandleLoader` instead of the CSV reader

---

### Phase B — Node.js API: Gap Resolution & Download

**Scope**: Replace `MarketDataResolver` with the gap resolver + downloader + CH writer stack. Add `DOWNLOADING_DATA` status.

#### B1 — Install dependencies

```bash
cd orchestrator/api
npm install @clickhouse/client-node ccxt
```

#### B2 — ClickHouse client singleton

**File**: `orchestrator/api/src/services/ClickHouseClient.ts` (new)

```typescript
import { createClient } from '@clickhouse/client-node';

export const chClient = createClient({
  url:      `${process.env.CLICKHOUSE_HOST ?? 'http://localhost'}:${process.env.CLICKHOUSE_PORT ?? 8123}`,
  username: process.env.CLICKHOUSE_USER     ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE ?? 'default',
});
```

Startup ping:
```typescript
await chClient.ping(); // throws if unreachable
```

#### B3 — `ClickHouseWriter` service

**File**: `orchestrator/api/src/services/ClickHouseWriter.ts` (new)

Single public method:
```typescript
async insertBatch(rows: OHLCVRow[]): Promise<void>
```

- Throws if `rows.length < 1` (internal guard)
- Calls `chClient.insert<OHLCVRow>({ table: 'market_data', values: rows, format: 'JSONEachRow' })`
- Caller is responsible for the ≥1,000 row batch minimum (enforced at `BinanceDownloader` level)

Unit test: assert `insert` is never called with an empty array; assert a batch of 1,000 rows produces exactly one `insert` call.

#### B4 — `BinanceDownloader` service

**File**: `orchestrator/api/src/services/BinanceDownloader.ts` (new)

```typescript
class BinanceDownloader {
  private exchange = new ccxt.binance({ enableRateLimit: true });

  async downloadAndStore(
    symbol: string,    // ccxt format: "BTC/USDT"
    startDate: Date,
    endDate: Date,
    writer: ClickHouseWriter,
  ): Promise<number>   // total candles stored
```

Pagination loop:
1. `since = startDate.getTime()`
2. Fetch `exchange.fetchOHLCV(symbol, '1m', since, 1000)`
3. Filter candles with `ts > endDate.getTime()`
4. Map `[ts, o, h, l, c, v]` → `OHLCVRow`; set `symbol` from the request
5. Call `writer.insertBatch(batch)` — each Binance page is one insert (≥1000 rows except final page)
6. Advance `since = lastTs + 1`; stop when `lastTs >= endDate` or `raw.length < 1000`

Unit tests (ccxt exchange stubbed):
- Full page (1000 candles) → 1x `insertBatch` called
- Two pages (1000 + 400) → 2x `insertBatch` called; second call has 400 rows
- Empty response → `insertBatch` never called; returns 0

#### B5 — `GapResolver` service

**File**: `orchestrator/api/src/services/GapResolver.ts` (new, replaces `MarketDataResolver.ts`)

```typescript
interface GapResult {
  hasGap: boolean;
  expectedCount: number;
  actualCount:   number;
}

class GapResolver {
  async check(symbol: string, startDate: Date, endDate: Date): Promise<GapResult>
}
```

Gap detection query (see R-004):
```sql
SELECT toUInt64(COUNT(*)) AS cnt
FROM market_data FINAL
WHERE symbol = {symbol:String}
  AND timestamp >= {start:DateTime64(3)}
  AND timestamp <= {end:DateTime64(3)}
```

`expectedCount = Math.floor((endDate.getTime() - startDate.getTime()) / 60_000) + 1`

`hasGap = actual < expected`

Symbol format: passes through as-is (e.g. `'BTCUSDT'` — the trading_pair from the request). The `GapResolver` does NOT apply the old `MarketDataResolver` normalisation.

Unit tests:
- `actualCount >= expectedCount` → `hasGap: false`
- `actualCount < expectedCount` → `hasGap: true`
- Empty table → `hasGap: true`

#### B6 — Update `backtest.routes.ts`

**File**: `orchestrator/api/src/routes/backtest.routes.ts`

The route handler becomes async with explicit status transitions:

```
1. statusStore.set(id, PENDING)
2. gapResolver.check(symbol, start, end)
3. if hasGap:
     statusStore.set(id, DOWNLOADING_DATA)
     await downloader.downloadAndStore(symbol, start, end, writer)
4. statusStore.set(id, RUNNING)
5. result = await backtestService.execute({ ...params, clickhouse_addr, clickhouse_db, ... })
6. statusStore.set(id, COMPLETE)
```

Remove all `MarketDataResolver` references. Remove `market_data_csv_path` from `BacktestService.execute()` call.

`GET /backtest/:id` returns the current status from `statusStore` (already in place via `ResultStore` / `ProcessManager` — extend with the new status values).

#### B7 — Update types

**File**: `orchestrator/api/src/types/index.ts`

```typescript
export type BacktestStatus =
  | 'PENDING'
  | 'DOWNLOADING_DATA'    // new
  | 'RUNNING'
  | 'COMPLETE'
  | 'FAILED';
```

#### B8 — Delete `MarketDataResolver`

Delete `MarketDataResolver.ts` and `MarketDataResolver.test.ts`. Update all import sites.

---

### Phase C — Frontend: DOWNLOADING_DATA State

**Scope**: Minimal change — display the new status without architectural changes.

#### C1 — Update `backtest-api.ts`

**File**: `frontend/src/services/backtest-api.ts`

The `getStatus()` helper already maps API responses to frontend states. Add mapping:
```typescript
case 'DOWNLOADING_DATA': return 'downloading';
```

#### C2 — Display downloading message

In the status component (wherever `RUNNING` / `PENDING` are rendered), add a case for `'downloading'`:
```
"Downloading missing market data… this may take a moment for large date ranges."
```

Use an animated spinner identical to the existing `RUNNING` state spinner — no new component needed.

---

### Phase D — Schema Migration

#### D1 — DDL script

Create `orchestrator/api/migrations/001_market_data.sql`:

```sql
CREATE DATABASE IF NOT EXISTS dca_bot;

CREATE TABLE IF NOT EXISTS dca_bot.market_data (
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

This script is run once manually (see [quickstart.md](quickstart.md)). No automated migration runner is introduced in this feature.

---

## Testing Strategy

### Go Engine Tests

| Test file | What it tests |
|-----------|---------------|
| `clickhouse_loader_test.go` | `ClickHouseCandleLoader` with mock `driver.Rows`; verifies `NextCandle()` returns rows in order; `Close()` releases resources |
| `orchestrator_test.go` (mod) | Inject `MockCandleLoader` returning fixed candles; verify same event output as before |
| `integration_test.go` (mod) | Use `MockCandleLoader` — no live CH required for unit integration tests |

BDD acceptance test `T-US1-AC1` (User Story 1, Acceptance Scenario 1): covered by the Node.js integration test (Phase B tests + E2E).

### Node.js API Tests

| Test file | What it tests |
|-----------|---------------|
| `GapResolver.test.ts` | Mock CH client; test `hasGap: false` and `hasGap: true` paths |
| `BinanceDownloader.test.ts` | Stub ccxt exchange; assert pagination logic and `insertBatch` call count |
| `ClickHouseWriter.test.ts` | Assert batch size enforcement; mock CH client insert |
| `backtest.routes.test.ts` (mod) | Assert `DOWNLOADING_DATA` transition in response sequence |

### BDD Scenarios Covered

| Spec scenario | Test location |
|---------------|---------------|
| US1-AC1: no data → download → engine starts | `backtest.routes.test.ts` integration test |
| US1-AC2: partial gap → only missing range downloaded | `GapResolver.test.ts` + `BinanceDownloader.test.ts` |
| US1-AC3: full coverage → no download | `GapResolver.test.ts` |
| US1-AC4: multi-page pagination | `BinanceDownloader.test.ts` |
| US1-AC5: overlap deduplication | ClickHouse `FINAL` query test / manual verification |
| US2-AC1: memory-flat streaming | Go engine manual test — run 3-year backtest, observe process memory |
| US2-AC2: Go owns its own CH connection | Architecture enforced by code structure; verified in `main.go` code review |
| US2-AC3: ascending timestamp order | `clickhouse_loader_test.go` — ORDER BY clause test |
| US3-AC1–4: UI status transitions | `backtest.routes.test.ts` |

---

## Dependency Graph (implementation order)

```
D1 (DDL) → B2 (CH client) → B3 (CH writer) → B4 (Downloader)
                                             → B5 (GapResolver)
                          → B6 (routes) ← B3, B4, B5
                          → B7 (types)  ← B6
                          → B8 (delete MarketDataResolver) ← B6
A2 (interface) → A3 (CH loader) → A4 (orchestrator refactor) → A5 (main.go) → A6 (delete CSV)
C1, C2 ← B7 (types)
```

No circular dependencies. Phase D and Phase A are independent of Phase B/C and can be developed in parallel.

