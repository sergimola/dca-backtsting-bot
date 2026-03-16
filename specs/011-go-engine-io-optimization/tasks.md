# Tasks: Go Engine I/O Optimization

**Input**: Design documents from `/specs/011-go-engine-io-optimization/`
**Branch**: `011-go-engine-io-optimization`
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/ ✅

**Green Light Protocol**: All existing `go test ./...` and Jest tests must remain green throughout
implementation. New tests (listed below) must fail before implementation and pass after. No merges
while tests are failing.

**Domain Boundaries**:
- `[core-engine]` → `core-engine/` (Go) — pure simulation math, CLI, event processing
- `[orchestrator]` → `orchestrator/api/` (TypeScript) — API, DB, worker, streaming

---

## Phase 1: Setup — Go Struct Definitions & CLI Infrastructure

**Purpose**: Define all new Go types and wire CLI flags. Every subsequent Go task depends on
these types being correct — changing them later cascades. No runtime behaviour changes yet.

- [X] T001 [core-engine] Define `ProgressPayload`, `PnlSummaryOutput`, `TradeEventOutput`, `SafetyOrderUsageEntry`, and `EngineResultPayload` structs with exact JSON tags in `core-engine/cmd/engine/main.go` (replace `BacktestOutput` struct declaration only — do not remove `convertBacktestToOutput` yet)
- [X] T002 [core-engine] Add `configureSlog(levelStr string)` function in `core-engine/cmd/engine/main.go` implementing `slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})` with switch for `DEBUG`/`INFO`/`WARN`/`ERROR`; default `INFO`
- [X] T003 [core-engine] Add `--log-level` and `--progress-interval-ms` CLI flags via `flag.Parse()` at the top of `main()` in `core-engine/cmd/engine/main.go`, placed before the `json.NewDecoder(os.Stdin).Decode()` call; validate `--progress-interval-ms > 0`, default to 250 with WARN if invalid; call `configureSlog(*logLevel)` immediately after flag parsing
- [X] T004 [core-engine] Add `Count() (int64, error)` method to the `CandleLoader` interface in `core-engine/application/orchestrator/types.go`
- [X] T005 [core-engine] Implement `Count()` on `ClickHouseCandleLoader` in `core-engine/application/orchestrator/clickhouse_loader.go`: `SELECT count(*) FROM ohlcv WHERE symbol = ? AND timestamp >= ? AND timestamp < ?`; return `(int64, error)`

**Checkpoint**: `go build ./cmd/engine/...` must succeed with the new types and flags in place

---

## Phase 2: Foundational — In-Process Aggregation (Go)

**Purpose**: The new `aggregator.go` must exist and be independently testable before the hot-loop
or result-emission tasks can depend on it. This is a pure function file with no I/O side effects.

- [X] T006 [core-engine] Create `core-engine/cmd/engine/aggregator.go` with `aggregateBacktestEvents(events []orchestrator.Event, accountBalance decimal.Decimal) aggregationResult` — port `ResultAggregator.aggregateGoEvents()` exactly: walk `PositionOpened` (entryFees), `BuyOrderExecuted` (tradingFees, safetyCounts), `SellOrderExecuted` (tradingFees), `PositionClosed` (realizedPnl, peak-equity drawdown tracking); compute `roi`, `maxDrawdown`, `totalFees` using `decimal.Decimal` throughout; convert to `float64` only when constructing `PnlSummaryOutput` fields
- [X] T007 [core-engine] Add `buildTradeEvents(events []orchestrator.Event) []TradeEventOutput` to `core-engine/cmd/engine/aggregator.go` — port `processGoEventsForFrontend()` exactly: increment `tradeCounter` on `PositionOpened` (emit `ENTRY` event using `configuredOrders[0]`); emit `SAFETY_ORDER` on `BuyOrderExecuted`; hold pointer to last EXIT on `PositionClosed` (emit `EXIT` event with `Fee: 0` initially); patch `lastExitEvent.Fee` from next `SellOrderExecuted` event; skip all other event types
- [X] T008 [core-engine] Add `buildSafetyOrderUsage(counts map[int]int) []SafetyOrderUsageEntry` to `core-engine/cmd/engine/aggregator.go` — sort map keys ascending, convert each to `SafetyOrderUsageEntry{Level: strconv.Itoa(k+1), Count: v}`
- [X] T009 [P] [core-engine] Write unit tests in `core-engine/cmd/engine/aggregator_test.go`:
  - `TestAggregateBacktestEvents_RoiCalc` — ROI = realizedPnl / accountBalance × 100
  - `TestAggregateBacktestEvents_MaxDrawdown` — peak tracked across multiple trades
  - `TestAggregateBacktestEvents_TotalFees` — entryFee + tradingFees + sellFees summed correctly
  - `TestAggregateBacktestEvents_SafetyOrderCounts` — soIndex = orderNumber - 1; counts increment
  - `TestBuildTradeEvents_EntryAndSafetyOrder` — ENTRY/SAFETY_ORDER fields correct
  - `TestBuildTradeEvents_ExitFeePatchedFromSellOrder` — EXIT.fee patched from next SellOrderExecuted
  - `TestBuildTradeEvents_MultipleTradesSequentialIds` — trade_id "1","2","3" per PositionOpened
  - `TestBuildSafetyOrderUsage_SortedAscending` — levels appear as "1","2",... sorted

**Checkpoint**: `go test ./cmd/engine/...` must show all T009 tests passing

---

## Phase 3: User Story 2 — High-Throughput Silent Execution (Priority: P2) ⚡ Dependency

> **US2 is implemented before US1** because it is the prerequisite: the hot-loop I/O must be
> removed before the progress ticker delivers value. US1 progress streaming requires a clean hot
> loop to measure.

**Goal**: Replace all `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]...")` calls in the hot loop with
`slog.Debug(...)`. At `--log-level INFO`, stdout and stderr are silent during candle processing.

**Independent Test**: Build the binary, run against a 10,000-candle fixture with `--log-level INFO`,
measure `time.Now()` before and after. Count stdout lines = progress ticks + 1. Assert zero stderr
output (no hot-loop writes). Assert candle throughput ≥ 500,000/second after this phase.

### Implementation for User Story 2

- [X] T010 [core-engine] [US2] Replace all `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]...")` calls in `core-engine/application/orchestrator/orchestrator.go` with `slog.Debug(...)`, `slog.Warn(...)`, or `slog.Error(...)` per the call-specific log level in plan.md CG-3 table; remove the `fmt` import if no other callers remain
- [X] T011 [core-engine] [US2] Replace all `fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG]...")` calls in `core-engine/cmd/engine/main.go` (outside of fatal error paths) with `slog.Debug(...)` calls per plan.md CG-3 table; retain `fmt.Fprintf(os.Stderr, "Failed to...")` lines that guard `os.Exit(1)` paths
- [X] T012 [P] [core-engine] [US2] Write unit tests in `core-engine/cmd/engine/main_test.go`:
  - `TestLogLevelFlag_InfoProducesNoDebugOnStderr` — run binary with `--log-level INFO`; assert stderr is empty on clean completion
  - `TestLogLevelFlag_DebugProducesEntriesOnStderr` — run binary with `--log-level DEBUG`; assert stderr contains at least one slog text line

**Checkpoint**: `go test ./...` green; `go build ./cmd/engine/...` succeeds; running binary at INFO produces zero stderr lines for candle processing

---

## Phase 4: User Story 1 — Live Progress During Long-Running Backtests (Priority: P1) 📊

**Goal**: The engine emits `{"type":"progress",...}` NDJSON lines to stdout at the configured
interval while the simulation runs. Each line carries percent, current date, price, realized PnL
and candles-per-second.

**Independent Test**: Build the binary, run against a >10,000-candle fixture with
`--progress-interval-ms 250`. Capture stdout; verify that multiple lines with `"type":"progress"`
appear before the final `"type":"result"` line. All eight required fields must be present and
typed correctly.

### Implementation for User Story 1

- [X] T013 [core-engine] [US1] Add `progressState` struct to `core-engine/cmd/engine/main.go` with fields: `processedCandles atomic.Int64`, `lastTickCandles atomic.Int64`, `totalCandles int64` (immutable), `mu sync.Mutex`, `currentDate time.Time`, `currentPrice decimal.Decimal`, `realizedPnl decimal.Decimal`
- [X] T014 [core-engine] [US1] Add `startProgressTicker(ctx context.Context, state *progressState, intervalMs int, out io.Writer) func()` in `core-engine/cmd/engine/main.go`: start a `time.Ticker`; on each tick, atomically read `processedCandles`, compute `cps` from `lastTickCandles` delta, compute `percent` (capped at 99), lock `mu` to read `currentDate`/`currentPrice`/`realizedPnl`, encode `ProgressPayload` via `json.NewEncoder(out).Encode(pkt)`; return a stop function that cancels the context; goroutine exits on `ctx.Done()`
- [X] T015 [core-engine] [US1] Wire progress state into `main()` in `core-engine/cmd/engine/main.go`: after creating `loader`, call `loader.Count()` to obtain `totalCandles` (warn and fall back to `orchConfig.EstimatedCandleCount` on error); set `orchConfig.ProgressCallback` to update `state.processedCandles`, `state.currentDate`, and `state.currentPrice` from the callback's candle context; call `startProgressTicker` to launch the goroutine; cancel the ticker and drain one interval before encoding the final result line
- [X] T016 [core-engine] [US1] Replace `convertBacktestToOutput()` and the old `BacktestOutput` JSON encode in `main()` with the new aggregation pipeline: call `aggregateBacktestEvents(allEvents, cfg.AccountBalance())`, `buildTradeEvents(allEvents)`, `buildSafetyOrderUsage(counts)`, assemble `EngineResultPayload{Type:"result", ...}`, encode via `json.NewEncoder(os.Stdout).Encode(payload)`
- [X] T017 [P] [core-engine] [US1] Extend `core-engine/cmd/engine/main_test.go`:
  - `TestProgressIntervalMs_ValidInterval_TicksFire` — run binary with `--progress-interval-ms 100` against small fixture; assert ≥1 progress line appears on stdout before result line
  - `TestProgressIntervalMs_InvalidZero_DefaultsTo250` — run binary with `--progress-interval-ms 0`; assert WARN on stderr and execution completes normally

**Checkpoint**: Binary emits sequential progress lines followed by exactly one result line; `go test ./cmd/engine/...` all green

---

## Phase 5: User Story 4 — Operator Diagnostics via Structured Logging (Priority: P4) 🔍

**Goal**: `--log-level DEBUG` emits structured slog entries for candle events, position opens,
safety order triggers, and position closes. `--log-level INFO` is completely silent on stderr.

> **Note**: Most of the heavy lifting was done in Phase 3 (T010, T011). This phase wires up the
> remaining diagnostic entries that require access to PSM event detail, not just hot-loop counters.

**Independent Test**: Run binary with `--log-level DEBUG` on a very small fixture (3–5 candles,
known config that triggers a safety order). Assert stderr contains structured entries for:
candle processing, position open, safety order trigger, and position close. Then run same fixture
with `--log-level INFO` and assert stderr is empty.

### Implementation for User Story 4

- [X] T018 [core-engine] [US4] Verify and complete `slog.Debug` coverage in `core-engine/application/orchestrator/orchestrator.go`: ensure entries exist for first-candle symbol check, position open (tradeID + entry price), safety-order trigger (candle timestamp + triggered price + order number), and position close (closing price + profit); add any missing entries per FR-004
- [X] T019 [core-engine] [US4] Verify and complete `slog.Debug` coverage in `core-engine/cmd/engine/main.go` `buildConfigFromRequest()`: ensure entries exist for decoded SDD params, parsed decimal values, and config sequence computation; add any missing entries per FR-004
- [X] T020 [P] [core-engine] [US4] Extend `core-engine/cmd/engine/main_test.go`:
  - `TestLogLevelWarn_OnlyWarnsAppear` — run with `--log-level WARN` on a fixture that triggers a known warning; assert stderr contains WARN but no DEBUG entries

**Checkpoint**: All four log-level variants testable; `go test ./...` green; `go build` succeeds

---

## Phase 6: Drizzle DB Migration & Repository (Orchestrator)

**Purpose**: Foundational orchestrator change — add `progress` and `current_metrics` columns
to Postgres. All orchestrator user story work depends on these columns existing.

**⚠️ Must be implemented before Phase 7 and Phase 8**

- [X] T021 [orchestrator] Generate Drizzle migration: add `progress: integer('progress').notNull().default(0)` and `currentMetrics: jsonb('current_metrics').$type<ProgressLine | null>()` to the `backtests` table in `orchestrator/api/src/db/schema.ts`; run `npm run db:generate` to produce `orchestrator/api/drizzle/0002_*.sql`; verify the generated SQL contains `ADD COLUMN "progress" integer NOT NULL DEFAULT 0` and `ADD COLUMN "current_metrics" jsonb`
- [X] T022 [orchestrator] Run migration against local Postgres: `npm run db:migrate`; verify `\d backtests` shows both new columns
- [X] T023 [orchestrator] Add `updateProgress(id: string, percent: number, metrics?: ProgressLine): Promise<void>` to `orchestrator/api/src/services/BacktestJobRepository.ts` using `db.update(backtests).set({ progress: Math.max(0, Math.min(100, Math.floor(percent))), ...(metrics ? { currentMetrics: metrics } : {}), updatedAt: new Date() }).where(eq(backtests.id, id))`
- [X] T024 [orchestrator] Update `claimNext()` raw SQL result mapping in `orchestrator/api/src/services/BacktestJobRepository.ts` to include `progress: (row['progress'] as number) ?? 0` and `currentMetrics: (row['current_metrics'] as ProgressLine | null) ?? null`; update the `BacktestRow` return type accordingly
- [X] T025 [P] [orchestrator] Write unit tests for repository changes in `orchestrator/api/tests/` (or adjacent `__tests__`):
  - `BacktestJobRepository.updateProgress writes progress and current_metrics` — assert DB update called with floored percent
  - `BacktestJobRepository.claimNext includes progress and currentMetrics fields` — assert camelCase mapping correct

**Checkpoint**: `npm run db:migrate` succeeds; `npm test` green for repository tests

---

## Phase 7: User Story 3 — BacktestService readline Refactor (Priority: P3) 🔄

**Goal**: Replace `stdoutBuffer` string accumulation in `BacktestService.executeInternal()` with a
`readline` interface. Route `type === "progress"` lines to an optional `progressHandler` callback.
Route `type === "result"` to capture the final payload. Update `BacktestExecutionResult` type.

**Independent Test**: Run `BacktestService` against a mock engine process that emits 2 progress
lines then a result line. Assert that: `progressHandler` was called twice, the returned
`BacktestExecutionResult` has correct `pnlSummary`/`tradeEvents`/`safetyOrderUsage` fields, and
non-JSON stdout lines are discarded without throwing.

### Implementation for User Story 3

- [X] T026 [orchestrator] [US3] Update `orchestrator/api/src/types/index.ts`: add `ProgressLine`, `SafetyOrderUsageEntry` interfaces; replace old `BacktestExecutionResult` with new shape `{ pnlSummary: StoredPnlSummary; tradeEvents: StoredTradeEvent[]; safetyOrderUsage: SafetyOrderUsageEntry[]; engineExecutionTimeMs: number; candleCount: number; eventCount: number }` (keep `BacktestExecuteOptions` with `progressHandler?: (line: ProgressLine) => Promise<void>`)
- [X] T027 [orchestrator] [US3] Refactor `executeInternal()` in `orchestrator/api/src/services/BacktestService.ts`: remove `stdoutBuffer` string and `child.stdout.on('data', ...)` accumulation; replace with `readline.createInterface({ input: child.stdout!, crlfDelay: Infinity, terminal: false })`; on each `rl.on('line', ...)`: parse JSON, route `type === "progress"` to `options?.progressHandler` (fire-and-forget with `.catch(console.warn)`), capture `type === "result"` as `resultLine`; in `child.on('exit', ...)`: close the readline interface, resolve with `mapResultLine(resultLine)` if `exitCode === 0` and result was received, reject with `ProcessError` otherwise
- [X] T028 [orchestrator] [US3] Add `mapResultLine(line: EngineResultLine): BacktestExecutionResult` helper in `orchestrator/api/src/services/BacktestService.ts` mapping `line.pnlSummary → pnlSummary`, `line.tradeEvents → tradeEvents`, `line.safetyOrderUsage → safetyOrderUsage`, `line.executionTimeMs → engineExecutionTimeMs`, `line.candleCount → candleCount`, `line.eventCount → eventCount`
- [X] T029 [orchestrator] [US3] Update engine spawn args in `BacktestService.ts` to include `--log-level` (from `process.env.ENGINE_LOG_LEVEL ?? 'INFO'`) and `--progress-interval-ms` (from `process.env.ENGINE_PROGRESS_INTERVAL_MS ?? '250'`) flags before other positional args
- [X] T030 [P] [orchestrator] [US3] Write unit tests for `BacktestService` readline behaviour:
  - `progress lines invoke progressHandler` — mock process emits 2 progress lines + result; assert handler called twice
  - `result line resolves with BacktestExecutionResult` — assert all mapped fields correct
  - `non-JSON stdout line discarded without crash` — service resolves normally
  - `exit without result line rejects with ProcessError` — correct error type and message

**Checkpoint**: `npm test` green for BacktestService tests; `BacktestExecutionResult` type consumers still compile

---

## Phase 8: User Story 3 — BackgroundWorker Plumbing (Priority: P3) 🔁

**Goal**: Wire the `progressHandler` through `BackgroundWorker.processJob()`. Remove the
`ResultAggregator` aggregation call. Remove the `processGoEventsForFrontend` call. Pass the full
structured `BacktestExecutionResult` directly to `markCompleted`.

**Independent Test**: Spy on `service.execute()`; assert it was called with a `progressHandler`
function. Spy on `repo.updateProgress()`; assert it was called for each progress line. Assert
`aggregator.aggregateGoEvents()` is never called. Assert `markCompleted` receives the fields from
the engine result directly (no aggregation pass).

### Implementation for User Story 3 (continued)

- [X] T031 [orchestrator] [US3] Update `processJob()` in `orchestrator/api/src/services/BackgroundWorker.ts`: record `const claimStartTime = Date.now()` at job-claim; pass `progressHandler: async (line: ProgressLine) => { await this.repo.updateProgress(id, line.percent, line); }` as the second argument to `this.service.execute()`; remove the `this.aggregator.aggregateGoEvents(...)` call; remove the `processGoEventsForFrontend(...)` call
- [X] T032 [orchestrator] [US3] Update `markCompleted` call in `BackgroundWorker.ts`: pass `execResult.pnlSummary`, `execResult.tradeEvents`, `execResult.safetyOrderUsage`, and `Date.now() - claimStartTime` (worker wall-clock time) as the `executionTimeMs` argument to `repo.markCompleted()`
- [X] T033 [orchestrator] [US3] Update the `markCompleted()` signature in `orchestrator/api/src/services/BacktestJobRepository.ts` to accept `safetyOrders: SafetyOrderUsageEntry[]` (replacing any loose `any[]` type) and verify it persists to the `safety_orders` jsonb column correctly
- [X] T034 [P] [orchestrator] [US3] Write unit tests for `BackgroundWorker` changes:
  - `processJob passes progressHandler to service.execute` — spy confirms handler passed
  - `processJob calls markCompleted with engine result data` — direct passthrough; no aggregator
  - `processJob calls markFailed on engine exit without result line` — error path covered

**Checkpoint**: Full end-to-end integration path exercised; `npm test` all green

---

## Phase 9: Polish & Integration Verification

**Purpose**: Confirm the complete pipeline works end-to-end; update any remaining callers that
depend on old types; ensure the integration test mock binary emits the new NDJSON format.

- [X] T035 [orchestrator] Update the mock engine binary (or in-process fake) used in `orchestrator/api/tests/integration/` to emit: 2–3 `{"type":"progress",...}` lines followed by one `{"type":"result",...}` line with the new `EngineResultPayload` shape; remove any test assertions that reference the old `{events, finalPosition}` blob format
- [X] T036 [orchestrator] Verify `GET /backtests/:id/status` route handler in `orchestrator/api/src/routes/` returns `progress` field from the `backtests` row; if it uses a `selectFields` subset, add `progress` and `currentMetrics` to the selection
- [X] T037 [P] [core-engine] Run `go test ./...` from `core-engine/` root; fix any compilation failures in files that reference the now-deleted `BacktestOutput` type or `convertBacktestToOutput()` function
- [X] T038 [P] [orchestrator] Run `npm test` from `orchestrator/api/`; fix any remaining type errors in files that imported old `BacktestExecutionResult` shape with `events: any[]`
- [X] T039 [core-engine] Build the Go binary and smoke-test the full pipeline locally: run `go build -o ../orchestrator/api/core-engine.exe ./cmd/engine/...` from `core-engine/`; start the API; submit a 1-month backtest via `POST /backtests`; poll `GET /backtests/:id/status` and confirm `progress` increments; wait for completion and confirm `summary`, `trades`, and `safety_orders` are populated correctly in Postgres

**Checkpoint**: All tests green; smoke test passes; feature branch ready for PR

---

## Dependencies: Story Completion Order

```
Phase 1 (T001–T005)           # Go struct definitions — blocks everything else
    └── Phase 2 (T006–T009)   # aggregator.go — blocks T016 (result payload)
    └── Phase 3 (T010–T012)   # hot-loop slog refactor — blocks Phase 4 progress ticker
            └── Phase 4 (T013–T017)   # progress ticker — US1
            └── Phase 5 (T018–T020)   # debug logging completeness — US4

Phase 6 (T021–T025)           # DB migration — independent; blocks Phase 7/8 updateProgress calls
    └── Phase 7 (T026–T030)   # BacktestService readline — blocks Phase 8
            └── Phase 8 (T031–T034)   # BackgroundWorker plumbing — US3 complete

Phase 9 (T035–T039)           # Integration verification — after all phases
```

**Phases 1–5 (Go engine)** and **Phases 6–8 (TypeScript orchestrator)** can be worked in parallel
by different developers once Phase 1 is complete. The two tracks only need to synchronize at
integration smoke-test time (Phase 9).

---

## Parallel Execution Opportunities

Within each phase, tasks marked `[P]` can run simultaneously:

| Parallel Group | Tasks | What runs in parallel |
|---|---|---|
| Phase 2 | T009 | Tests can be written while T006/T007/T008 are implemented |
| Phase 3 | T012 | Log-level tests written while slog replacements are made |
| Phase 4 | T017 | Progress ticker tests written while T013–T016 are implemented |
| Phase 5 | T020 | WARN-level tests written while T018–T019 are verified |
| Phase 6 | T025 | Repository tests written while schema/migration are applied |
| Phase 7 | T030 | BacktestService tests written while readline refactor proceeds |
| Phase 8 | T034 | BackgroundWorker tests written while plumbing tasks proceed |
| Phase 9 | T037, T038 | Go and TS compile checks run simultaneously |

---

## Implementation Strategy

**MVP Scope (minimum to deliver value)**: Phases 1–4 complete. This delivers:
- Silent hot loop at INFO (US2 ✅)
- Progress lines streaming on stdout (US1 ✅)
- Final result payload with pre-aggregated data (US3 partial — engine side only)

**Full Delivery**: All phases. The Node.js streaming refactor (Phases 6–8) completes US3 and
enables the progress bar to advance in the UI.

**Suggested approach**:
1. One developer completes Phase 1 (structs + flags) — 1–2 hours
2. Branch: Phase 2 (aggregator.go, ~3 hours) runs alongside Phase 6 (DB migration, ~1 hour)
3. Phase 3 unlocks Phases 4 and 5 — both can be completed same session (~2 hours)
4. Phase 7 and 8 (~3 hours) after Phase 6 lands
5. Phase 9 smoke test once all branches merged

---

## Summary

| Metric | Value |
|---|---|
| Total tasks | 39 |
| Go engine tasks | 21 (T001–T020, T037, T039) |
| TypeScript orchestrator tasks | 18 (T021–T036, T038) |
| Tasks per US1 (progress streaming) | 5 implementation + 2 test = 7 |
| Tasks per US2 (silent hot loop) | 2 implementation + 1 test = 3 |
| Tasks per US3 (result payload + worker) | 8 implementation + 3 test = 11 |
| Tasks per US4 (structured logging) | 2 verification + 1 test = 3 |
| Foundational / setup tasks | 10 (Phases 1, 2, 6) |
| Polish / integration tasks | 5 (Phase 9) |
| Parallelizable tasks | 14 |
