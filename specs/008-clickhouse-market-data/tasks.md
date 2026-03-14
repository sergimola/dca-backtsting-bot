# Tasks: Auto-Downloader & ClickHouse Migration

**Input**: Design documents from `/specs/008-clickhouse-market-data/`  
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/ ✅

**Feature Branch**: `008-clickhouse-market-data`  
**Total Tasks**: 30 | **Phases**: 6

**Constitution Gates** (must stay green throughout):
- ClickHouse batch minimum: ≥1,000 rows per INSERT — no single-row inserts
- Go engine independence: engine connects to CH directly; API never relays candle data
- COUNT(*) gap math: no MIN/MAX-only gap detection — swiss cheese prohibition
- Open-candle discard before every insert
- 250ms sleep + `enableRateLimit: true` on every paginated fetch
- Green Light Protocol: all tests green before merge

---

## Phase 1: Setup

**Purpose**: Add new dependencies and create the schema migration artifact. All three tasks are fully independent and can run simultaneously.

- [X] T001 [P] Add `github.com/ClickHouse/clickhouse-go/v2@v2.43.0` to `core-engine/go.mod` via `go get`; verify the workspace `core-engine/go.work` resolves the new transitive dependencies
- [X] T002 [P] Install `@clickhouse/client-node` and `ccxt` in `orchestrator/api/package.json` via `npm install @clickhouse/client-node ccxt`; commit the updated `package-lock.json`
- [X] T003 [P] Create `orchestrator/api/migrations/001_market_data.sql` with the `CREATE DATABASE IF NOT EXISTS dca_bot` and `CREATE TABLE IF NOT EXISTS dca_bot.market_data (...) ENGINE = ReplacingMergeTree() ORDER BY (symbol, timestamp)` DDL per data-model.md

---

## Phase 2: Foundational

**Purpose**: Shared type definitions and infrastructure singletons that block all user-story phases.

**⚠️ CRITICAL**: No user-story implementation can begin until T004, T005, and T006 are complete.

- [X] T004 [P] Add `CandleLoader` interface (`NextCandle() (*Candle, error)`, `Close() error`) and `ClickHouseConfig` struct (`Addr`, `Database`, `User`, `Password` string fields) to `core-engine/application/orchestrator/types.go`
- [X] T005 [P] Create `orchestrator/api/src/services/ClickHouseClient.ts` — singleton `chClient` built with `createClient()` from `@clickhouse/client-node`, reading `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE` env vars; export a `pingClickHouse()` async helper used at server startup
- [X] T006 [P] Add `'DOWNLOADING_DATA'` to the `BacktestStatus` union type in `orchestrator/api/src/types/index.ts`; verify all exhaustive switch statements in the codebase still compile

**Checkpoint**: Foundation complete — all three phases (US1, US2, US3) can proceed independently.

---

## Phase 3: User Story 1 — Auto-Download on Gap Detection (Priority: P1) 🎯 MVP

**Goal**: When a user submits a backtest for a symbol/range not fully in the database, the system automatically fetches the missing candles from Binance, bulk-inserts them into ClickHouse, and only then starts the engine — with no CSV file involvement.

**Independent Test**: Start with an empty `market_data` table. `POST /backtest` for any symbol and 30-day range. The request must complete successfully and the `market_data` table must contain ≥43,200 rows for that symbol afterwards.

### Tests for User Story 1

- [X] T007 [P] [US1] Write `orchestrator/api/src/services/GapResolver.test.ts` — mock `chClient.query()`; assert: full coverage returns `{ hasGap: false }`; `actualCount < expectedCount` returns `{ hasGap: true }`; empty table (`actualCount = 0`) returns `{ hasGap: true }`; verify `expectedCount = floor((end - start) / 60_000) + 1` formula
- [X] T008 [P] [US1] Write `orchestrator/api/src/services/ClickHouseWriter.test.ts` — mock `chClient.insert()`; assert: empty-array call throws; batch of 1,000 rows calls `insert` exactly once with `format: 'JSONEachRow'`; batch of 2,500 rows (two separate calls from caller) each trigger one `insert`
- [X] T009 [P] [US1] Write `orchestrator/api/src/services/BinanceDownloader.test.ts` — stub `exchange.fetchOHLCV()`; assert: single full page (1,000 candles) → 1× `insertBatch`; two pages (1,000 + 400) → 2× `insertBatch`; empty first response → 0× `insertBatch`; open-candle (last ts === current minute floor) is stripped before `insertBatch`; `sleep(250)` is called between pages
- [X] T010 [P] [US1] Update `orchestrator/api/src/routes/backtest.routes.test.ts` — add integration assertions: gap-detected path transitions status `PENDING → DOWNLOADING_DATA → RUNNING → COMPLETE`; no-gap path never sets `DOWNLOADING_DATA`; download-failure path transitions to `FAILED` with a message distinguishing data-fetch failure from engine failure

### Implementation for User Story 1

- [X] T011 [P] [US1] Implement `orchestrator/api/src/services/ClickHouseWriter.ts` — `insertBatch(rows: OHLCVRow[]): Promise<void>` calls `chClient.insert<OHLCVRow>({ table: 'market_data', values: rows, format: 'JSONEachRow' })`; throw `Error('insertBatch called with empty array')` as internal guard
- [X] T012 [P] [US1] Implement `orchestrator/api/src/services/GapResolver.ts` — `check(symbol, startDate, endDate): Promise<GapResult>` runs `SELECT toUInt64(COUNT(*)) AS cnt FROM market_data FINAL WHERE symbol = {symbol:String} AND timestamp >= {start:DateTime64(3)} AND timestamp <= {end:DateTime64(3)}`; computes `expectedCount`; returns `{ hasGap, expectedCount, actualCount }`
- [X] T013 [US1] Implement `orchestrator/api/src/services/BinanceDownloader.ts` — paginated `fetchOHLCV('1m', since, 1000)` loop; `sleep(250)` between pages; open-candle discard (`if lastCandleTs >= Math.floor(Date.now() / 60_000) * 60_000 → pop()`); map each page to `OHLCVRow[]`; call `writer.insertBatch(batch)` per page; return total candle count stored (depends on T011)
- [X] T014 [US1] Update `orchestrator/api/src/services/BacktestService.ts` — remove `market_data_csv_path` from the engine request payload; add `clickhouse_addr` (from `CLICKHOUSE_HOST:CLICKHOUSE_NATIVE_PORT`), `clickhouse_db`, `clickhouse_user`, `clickhouse_password` fields sourced from env vars
- [X] T015 [US1] Refactor `orchestrator/api/src/routes/backtest.routes.ts` — replace `MarketDataResolver` with `GapResolver`; inject `BinanceDownloader` and `ClickHouseWriter`; implement async status flow: set `PENDING` → `gapResolver.check()` → if gap: set `DOWNLOADING_DATA`, `await downloader.downloadAndStore()` → set `RUNNING` → `await backtestService.execute()` → set `COMPLETE`; wrap each stage in try/catch → set `FAILED` with stage-specific error message (depends on T012, T013, T014)
- [X] T016 [US1] Delete `orchestrator/api/src/services/MarketDataResolver.ts` and `orchestrator/api/src/services/MarketDataResolver.test.ts`; update all `import` statements across the codebase that referenced `MarketDataResolver` to point to `GapResolver` (depends on T015)

**Checkpoint**: US1 fully functional — submit backtest with empty DB, data auto-downloads, engine runs, results returned.

---

## Phase 4: User Story 2 — Memory-Flat Streaming for Large Backtests (Priority: P1)

**Goal**: The Go engine queries ClickHouse directly over its own native TCP connection and streams candle rows one-by-one into the backtest loop — never loading all rows into memory — replacing the CSV loader entirely.

**Independent Test**: Build and run the engine against a 3-year CH dataset. Monitor process memory with `go tool pprof` or system monitor — heap must not grow proportionally with candle count. Engine must exit 0.

### Tests for User Story 2

- [X] T017 [P] [US2] Write `core-engine/application/orchestrator/clickhouse_loader_test.go` — define `MockCandleLoader` implementing `CandleLoader` with a pre-loaded `[]*Candle` slice; test: `NextCandle()` returns candles in insertion order; after last candle returns `(nil, nil)`; `Close()` sets internal flag (no panic on double-close); verify ascending timestamp invariant
- [X] T018 [P] [US2] Update `core-engine/application/orchestrator/orchestrator_test.go` — replace all `io.Reader` / `CSVLoader` test fixtures with `MockCandleLoader`; verify that injecting the same candle sequence produces identical event output as the CSV tests did
- [X] T019 [US2] Update `core-engine/application/orchestrator/integration_test.go` — replace CSV file path fixture with `MockCandleLoader` injection; ensure all existing integration scenarios still pass (depends on T017)

### Implementation for User Story 2

- [X] T020 [US2] Implement `core-engine/application/orchestrator/clickhouse_loader.go` — `ClickHouseCandleLoader` struct (holds `driver.Conn`, `driver.Rows`, context, cancel); `NewClickHouseCandleLoader(ctx, ClickHouseConfig, symbol, startDate, endDate string)` opens native connection via `clickhouse.Open(&clickhouse.Options{Addr: [cfg.Addr], Auth: ..., BlockBufferSize: 10})` and executes `SELECT symbol, timestamp, open, high, low, close, volume FROM market_data FINAL WHERE symbol = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC`; `NextCandle()` calls `rows.Next()` / `rows.Scan()` returning one `*Candle` per call or `(nil, nil)` at EOF; `Close()` calls `rows.Close()` then `conn.Close()` (depends on T001, T004)
- [X] T021 [US2] Refactor `core-engine/application/orchestrator/orchestrator.go` — change `RunBacktest(csvReader io.Reader)` signature to `RunBacktest(loader CandleLoader)`; replace `NewCSVLoader(csvReader)` call and all `csvLoader.*` references with `loader.NextCandle()` and `loader.Close()`; remove `io` import if no longer used (depends on T020)
- [X] T022 [US2] Update `core-engine/application/orchestrator/config.go` — remove `DataSourcePath string` field from `OrchestratorConfig`; remove any references to it in the constructor or validation (depends on T021)
- [X] T023 [US2] Update `core-engine/cmd/engine/main.go` — remove `MarketDataCSVPath` from `EngineRequest` struct; add `ClickhouseAddr`, `ClickhouseDb`, `ClickhouseUser`, `ClickhousePassword string` fields; validate `ClickhouseAddr` and `ClickhouseDb` are non-empty (exit 1 + stderr JSON on failure); replace `os.Open(request.MarketDataCSVPath)` with `NewClickHouseCandleLoader(ctx, chConfig, symbol, start, end)`; pass loader to `orch.RunBacktest(loader)` (depends on T020, T021, T022)
- [X] T024 [US2] Delete `core-engine/application/orchestrator/csv_loader.go`, `core-engine/application/orchestrator/csv_loader_test.go`, and `core-engine/application/orchestrator/csv_loader_bench_test.go`; remove unused `encoding/csv` import from any remaining files; confirm `go build ./...` passes with no references to deleted symbols (depends on T021, T023)

**Checkpoint**: US2 fully functional — engine binary accepts CH connection params via stdin, streams rows without OOM, exits cleanly.

---

## Phase 5: User Story 3 — Visible Download Progress in the UI (Priority: P2)

**Goal**: The frontend displays a distinct "Downloading missing market data…" message during the `DOWNLOADING_DATA` phase so users never perceive the system as frozen during large historical fetches.

**Independent Test**: Submit a backtest for a large missing range. The status polling display must cycle visibly through `PENDING` → `DOWNLOADING_DATA` (with the download message) → `RUNNING` → `COMPLETE` without any error state appearing mid-download.

- [X] T025 [P] [US3] Update `frontend/src/services/backtest-api.ts` — add `case 'DOWNLOADING_DATA': return 'downloading'` to the `getStatus()` status-mapping logic so the frontend polling reacts to the new API state; verify TypeScript compilation passes
- [X] T026 [US3] Update the backtest status display component (`frontend/src/components/` or `frontend/src/pages/`) — add a `'downloading'` case that renders "Downloading missing market data… this may take a moment for large date ranges." with the same animated spinner used for `'running'`; no new component needed (depends on T025)

**Checkpoint**: All three user stories independently functional and testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T027 Build Go engine binary (`go build -o ../orchestrator/api/core-engine.exe ./cmd/engine/main.go` from `core-engine/`) and run full Go test suite (`go test ./...`); all tests must be green before this task is marked complete
- [X] T028 [P] Run `npm test` in `orchestrator/api/` — all 4 new test files (T007–T010) plus all existing tests must pass; zero failures permitted (Green Light Protocol)
- [X] T029 [P] Run `npm test` in `frontend/` — verify no regressions from `backtest-api.ts` changes; all existing snapshot and unit tests must remain green
- [X] T030 Follow `specs/008-clickhouse-market-data/quickstart.md` end-to-end: start Docker CH → run DDL (`orchestrator/api/migrations/001_market_data.sql`) → `POST /backtest` for a 30-day range with empty DB → verify `market_data` table populated → `POST /backtest` same range again → verify no second download triggered → confirm UI shows each status transition

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately; all three tasks run in parallel
- **Phase 2 (Foundational)**: Needs Phase 1 complete (T002 → T005/T006; T001 → T004)
- **Phase 3 (US1)** and **Phase 4 (US2)**: Both need Phase 2 complete — can proceed in parallel with each other (entirely different codebases: Node.js vs Go)
- **Phase 5 (US3)**: Needs T006 complete (type definition) and T015 complete (routes emit the new status); can start C-tasks as soon as T006 is done
- **Phase 6 (Polish)**: Needs Phases 3, 4, and 5 complete

### User Story Dependencies

| Story | Depends On | Independently Testable |
|-------|-----------|----------------------|
| **US1 (P1)** — Gap detection + download | T004, T005, T006 (Phase 2) | Yes — mock engine subprocess; verify DB populated |
| **US2 (P1)** — CH streaming in Go engine | T004 (Phase 2) | Yes — compile engine binary, point at CH with test data |
| **US3 (P2)** — UI download status | T006 (Phase 2), T015 (US1 routes) | Yes — verify status polling with mocked route |

### Parallel Opportunities Per Story

**US1** (Phase 3):
- T007, T008, T009, T010 all write to different files — run in parallel
- T011 and T012 write to different files — run in parallel
- T013 needs T011 ✗
- T014 is independent of T011-T013 — parallel with any of them

**US2** (Phase 4):
- T017 and T018 write to different files — run in parallel
- T019 needs T017 ✗
- T020 can start as soon as T004 and T001 are done, independent of US1 work
- T021, T022 need T020 ✗

**US1 + US2 as a whole** — entire Phase 3 and Phase 4 can execute in parallel since they live in completely separate repos (`orchestrator/api/` vs `core-engine/`).

### Implementation Strategy

**MVP scope**: Complete Phase 1 + Phase 2 + Phase 3 (US1) first. This delivers the auto-download capability with a functional engine binary (unchanged except the stdin contract — update just T014 in the Node side to pass CH params, and T023 + T020 on the Go side to accept them). US2 (streaming) is the engine-internal improvement that makes large backtests memory-safe. US3 (UI) is the UX polish layer.

**Suggested delivery order**:
1. Phases 1–2 (30 min) → foundation
2. Phase 4 US2 Go engine work (T017–T024) — can be done by one developer  
3. Phase 3 US1 Node API work (T007–T016) — in parallel on another dev or sequentially
4. Phase 5 US3 frontend (T025–T026) — quick, after T015 is done
5. Phase 6 Polish (T027–T030) — validation gate before merge
