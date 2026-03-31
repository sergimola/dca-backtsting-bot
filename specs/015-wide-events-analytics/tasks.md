# Tasks: Wide Events Analytics Engine (ClickHouse Observability)

**Feature**: `015-wide-events-analytics`  
**Input**: [plan.md](plan.md) · [spec.md](spec.md) · [data-model.md](data-model.md) · [contracts/jsonl-wide-event-contract.md](contracts/jsonl-wide-event-contract.md)

**Total tasks**: 30  
**Parallel opportunities**: 17 tasks marked [P]  
**MVP scope**: Phase 3 (US1) — enricher infrastructure working end-to-end with a `.jsonl` file on disk

---

## Phase 1: Setup

**Purpose**: Extend existing config and result types to carry wide-event fields without touching live logic

- [x] T001 Add `WideEventOutputDir string` field to `OrchestratorConfig` in `core-engine/application/orchestrator/config.go`
- [x] T002 [P] Add `WideEventFilePath string` and `WideEventStallDuration time.Duration` to `BacktestRun` in `core-engine/application/orchestrator/types.go`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: `WideDecimal` wrapper and `WideEvent` struct must exist and serialize correctly before any user story can be implemented or tested

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Implement `WideDecimal` type over `decimal.Decimal` with `MarshalJSON()` using `StringFixed(8)` producing quoted 8dp strings (e.g. `"49.09800000"`) in `core-engine/application/orchestrator/wide_event.go`
- [x] T004 Implement `WideEvent` struct with all 28 fields (zero pointer types), JSON tags matching the JSONL contract field names, and six dimension groups (Identity, Market, Portfolio, Position, Analytics, Action) with `schema_version int` field in `core-engine/application/orchestrator/wide_event.go`
- [x] T005 [P] Write table-driven unit tests for `WideEvent` zero-value serialization: verify no JSON null anywhere on a zero-value struct, all decimal fields produce `"0.00000000"`, all string fields produce `""` in `core-engine/application/orchestrator/wide_event_test.go`
- [x] T006 [P] Write canonical math proof unit tests: `average_entry=100`, `candle_low=54.50` → `current_drawdown_pct="-45.50000000"`; `position_quantity=2.5`, `candle_close=60` → `unrealized_pnl="-100.00000000"` in `core-engine/application/orchestrator/wide_event_test.go`

**Checkpoint**: `go test ./application/orchestrator/... -run TestWideEvent` must be green before proceeding

---

## Phase 3: User Story 1 — Non-Blocking Wide Event Emission (Priority: P1) 🎯 MVP

**Goal**: `WideEventEnricher` writes all events to a `.jsonl` file via a lossless back-pressure channel. The PSM loop never drops events; stall duration is measured and logged.

**Independent Test**: Write 100 `WideEvent`s via `Emit()`, call `Close()`, read back the `.jsonl` file — assert 100 lines, each parseable as a `WideEvent` with correct fields.

- [x] T007 Implement `WideEventEnricher` struct with `ch chan WideEvent` (cap 65,536), `done chan struct{}`, `*os.File`, `bufio.Writer` (256 KiB), `stallTime time.Duration`, and `stallMu sync.Mutex` in `core-engine/application/orchestrator/wide_event_enricher.go`
- [x] T008 Implement `NewWideEventEnricher(outputDir, runID string) (*WideEventEnricher, error)`: `os.MkdirAll`, `os.Create`, start `worker()` goroutine in `core-engine/application/orchestrator/wide_event_enricher.go`
- [x] T009 Implement `Emit(event WideEvent)` with blocking channel send and stall-time accumulation in `core-engine/application/orchestrator/wide_event_enricher.go`
- [x] T010 Implement `worker()` goroutine: `for range ch` drain loop, `json.Marshal` + `bw.Write` + `bw.WriteByte('\n')`, close `done` on exit in `core-engine/application/orchestrator/wide_event_enricher.go`
- [x] T011 Implement `Close() (time.Duration, error)`: sequence — `close(ch)` → `<-done` → `bw.Flush()` → `file.Sync()` → `file.Close()` → return `stallTime` in `core-engine/application/orchestrator/wide_event_enricher.go`
- [x] T012 Implement `OutputPath() string` accessor on `WideEventEnricher` in `core-engine/application/orchestrator/wide_event_enricher.go`
- [x] T013 [P] [US1] Unit test: write 100 events → `Close()` → read file → assert 100 lines, each parses to `WideEvent`, `schema_version==1` on every line in `core-engine/application/orchestrator/wide_event_enricher_test.go`
- [x] T014 [P] [US1] Unit test: verify lossless delivery — write events equal to channel capacity; assert all events appear in the file after `Close()` with zero events missing in `core-engine/application/orchestrator/wide_event_enricher_test.go`
- [x] T015 [US1] Wire enricher init into `NewOrchestrator()`: when `config.WideEventOutputDir != ""` call `NewWideEventEnricher` and assign to `orch.enricher` field in `core-engine/application/orchestrator/orchestrator.go`
- [x] T016 [US1] Wire enricher teardown into `RunBacktest()` return path: call `enricher.Close()`, assign `WideEventFilePath` and `WideEventStallDuration` on `BacktestRun`, log stall warning if `stallDur > 0` in `core-engine/application/orchestrator/orchestrator.go`
- [x] T017 [P] [US1] Add `--wide-event-dir` CLI flag and pass it as `WideEventOutputDir` in `OrchestratorConfig` in `core-engine/cmd/engine/main.go`
- [x] T018 [P] [US1] Add `wide_event_file` and `wide_event_stall_duration_ms` fields to the engine stdout JSON result object in `core-engine/cmd/engine/main.go`

**Checkpoint**: `go test ./application/orchestrator/... -run TestWideEventEnricher` green; running the engine with `--wide-event-dir /tmp/we` produces a `.jsonl` file

---

## Phase 4: User Story 2 — Deep Drawdown Visibility on Every Minute (Priority: P1)

**Goal**: One `price_changed` wide event is emitted per candle, carrying live `unrealized_pnl` and `current_drawdown_pct` computed via `decimal.Decimal` arithmetic. Sentinel defaults replace missing position fields rather than JSON null.

**Independent Test**: Feed one candle with `average_entry_price=100`, `candle_low=54.50`, `candle_close=60.00` to the enricher path — assert emitted event has `current_drawdown_pct="-45.50000000"` and `unrealized_pnl` is non-zero.

- [x] T019 [US2] Implement `emitCandleWideEvent(candle *Candle, symbol string)` on `*Orchestrator`: read `orch.position`, `orch.runningBalance`, `orch.globalCandleCount`; compute `unrealized_pnl=(close−avg)×qty` and `current_drawdown_pct=(low−avg)/avg×100` using `decimal.Decimal`; guard division by `AverageEntryPrice.IsZero()`; emit to `orch.enricher` in `core-engine/application/orchestrator/orchestrator.go`
- [x] T020 [US2] Call `emitCandleWideEvent` once per candle in `RunBacktest()` main loop, after the PSM processing block and regardless of whether any PSM events fired, but only when `orch.enricher != nil` in `core-engine/application/orchestrator/orchestrator.go`
- [x] T021 [P] [US2] Unit test: canonical drawdown — `average_entry=100`, `candle_low=54.50`, `candle_close=60.00` → wide event `current_drawdown_pct="-45.50000000"`, `unrealized_pnl="-100.00000000"` in `core-engine/application/orchestrator/orchestrator_test.go`
- [x] T022 [P] [US2] Unit test: no-position sentinel values — price_changed with no active position emits `trade_id=""`, `average_entry_price="0.00000000"`, `unrealized_pnl="0.00000000"`, `current_drawdown_pct="0.00000000"`, zero JSON null fields in `core-engine/application/orchestrator/orchestrator_test.go`
- [x] T023 [P] [US2] Unit test: 1,000 consecutive candles with no fills → `.jsonl` file has 1,000 lines all with `event_type="price_changed"` and monotonically increasing `global_candle_count` in `core-engine/application/orchestrator/orchestrator_test.go`

**Checkpoint**: Full 1-minute drawdown curve reconstructable from `.jsonl` output; `go test ./application/orchestrator/...` green

---

## Phase 5: User Story 3 — Order Fill Wide Events with Complete Action Context (Priority: P2)

**Goal**: Every PSM fill event (`order.buy.executed`, `order.sell.executed`, `trade.opened`, `trade.closed`) produces an additional wide event with filled action fields alongside the per-candle `price_changed` event.

**Independent Test**: Backtest that triggers 3 DCA buys and 1 take-profit → assert 4 fill wide events: `order_number` 1→2→3 on buys, `realized_pnl` and `close_reason="take_profit"` on the close.

- [x] T024 [US3] Implement `emitFillWideEvent(candle *Candle, symbol string, psmEvent position.Event)` on `*Orchestrator`: map PSM event type to wide `event_type` string; extract `action_price`, `action_quantity`, `action_fee`, `order_number` from `BuyOrderExecutedEvent`; extract `realized_pnl`, `close_reason` from `TradeClosedEvent`; emit to `orch.enricher` in `core-engine/application/orchestrator/orchestrator.go`
- [x] T025 [US3] Wire `emitFillWideEvent` into the PSM event processing loop in `RunBacktest()` — call once per PSM event for `trade.opened`, `order.buy.executed`, `order.sell.executed`, `trade.closed` event types in `core-engine/application/orchestrator/orchestrator.go`
- [x] T026 [P] [US3] Unit test: DCA buy fill at order_number=2 → wide event has `event_type="order_filled"`, `order_number=2`, `action_price`, `action_quantity`, `action_fee` all populated with exact decimal values in `core-engine/application/orchestrator/orchestrator_test.go`
- [x] T027 [P] [US3] Unit test: take-profit close → wide event has `event_type="position_closed"`, `realized_pnl` populated, `close_reason="take_profit"`, all position fields reflect snapshot at close in `core-engine/application/orchestrator/orchestrator_test.go`

**Checkpoint**: Fill events appear in `.jsonl` output interleaved with `price_changed` events; `go test ./application/orchestrator/...` green

---

## Phase 6: User Story 4 — Relational Boundary: No Config Duplication (Priority: P2)

**Goal**: Structural proof that the `WideEvent` schema contains no backtest config fields. Satisfied by the struct definition; validated by an explicit key-enumeration test.

**Independent Test**: Enumerate all JSON keys emitted by any `WideEvent` — assert none are in the set `{amount_scale, multiplier, take_profit_pct, stop_loss_pct, initial_investment, price_drop_percentage, num_safety_orders}`.

- [x] T028 [P] [US4] Unit test: serialize a fully-populated `WideEvent` to JSON, enumerate all keys, assert forbidden config field names are absent in `core-engine/application/orchestrator/wide_event_test.go`

**Checkpoint**: Test green; no config fields in emitted schema

---

## Phase 7: User Story 5 — Bulk ClickHouse Ingestion Without Small Writes (Priority: P3)

**Goal**: `WideEventIngester` class: empty-file guard → schema_version check → `ALTER TABLE DROP PARTITION` → single streaming `INSERT` via `fs.createReadStream()`. Node.js backtest service calls it after the engine binary exits.

**Independent Test**: Mock `chClient`; supply a valid 3-line `.jsonl` fixture file; assert `DROP PARTITION` is called before `insert`, `insert` receives a `ReadStream`, `rowsInserted` matches written_rows.

- [x] T029 [US5] Implement `WideEventIngester` class in `orchestrator/api/src/services/WideEventIngester.ts`: `ingest(runId, filePath)` — stat check → first-line schema_version parse → `chClient.command(DROP PARTITION)` → `chClient.insert({ values: createReadStream(filePath), format: 'JSONEachRow' })` → return `IngestResult`
- [x] T030 [P] [US5] Unit tests (mocked `chClient`) in `orchestrator/api/src/services/WideEventIngester.test.ts`:
  - Empty file → `{rowsInserted: 0}`, no ClickHouse calls
  - `schema_version !== 1` → throws before any ClickHouse calls
  - Valid file → `DROP PARTITION` called before `insert`; `insert` receives a `ReadStream`
  - `DROP PARTITION` query string contains the correct `runId`
- [x] T031 [US5] Wire `WideEventIngester.ingest()` call into the Node.js backtest job handler: read `wide_event_file` from engine stdout JSON result, call `ingester.ingest(runId, filePath)` after engine binary exits in `orchestrator/api/src/services/BacktestService.ts`

**Checkpoint**: `npx jest WideEventIngester` green; ingestion triggered automatically after each engine run

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Integration validation across both layers; end-to-end correctness

- [x] T032 [P] Integration test: run a fixture backtest with enricher enabled, assert `.jsonl` line count equals `BacktestRun.EventCount` reported by engine, assert each line is valid JSON with `schema_version=1` in `core-engine/application/orchestrator/integration_test.go`
- [x] T033 [P] Integration test (requires Docker ClickHouse): call `WideEventIngester.ingest()` against live ClickHouse with a 1,000-line fixture file; assert `SELECT count() FROM wide_events WHERE run_id = ?` returns 1,000; re-run ingest (idempotency test) and assert count is still 1,000 in `orchestrator/api/src/integration/wide-events-ingestion.integration.test.ts`

**Checkpoint**: `go test ./...` and `npx jest` all green; quickstart.md walkthrough succeeds end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)        → no dependencies, start immediately
Phase 2 (Foundational) → requires Phase 1 complete — BLOCKS all user stories
Phase 3 (US1)          → requires Phase 2 complete
Phase 4 (US2)          → requires Phase 3 complete (needs enricher wired into orchestrator)
Phase 5 (US3)          → requires Phase 4 complete (emitFillWideEvent builds on emitCandleWideEvent setup)
Phase 6 (US4)          → requires Phase 2 only (struct test; independent of US1–US3)
Phase 7 (US5)          → requires Phase 1 only (types used in BacktestService); independent of Go phases
Phase 8 (Polish)       → requires all Phases 3–7 complete
```

### User Story Dependencies

- **US1 (P1)**: Start after Phase 2. No dependency on other user stories. MVP increment.
- **US2 (P1)**: Start after US1 enricher is wired into the orchestrator (`orch.enricher` field exists).
- **US3 (P2)**: Start after US2 (`emitCandleWideEvent` pattern established; can add `emitFillWideEvent` in parallel file edits).
- **US4 (P2)**: Start after Phase 2 (`WideEvent` struct defined). Fully independent of US1–US3.
- **US5 (P3)**: Start after Phase 1 (`BacktestRun` types extended for `wide_event_file` field). Fully independent of all Go phases.

### Parallel Opportunities (per phase)

| Phase | Parallelizable tasks |
|-------|---------------------|
| Phase 1 | T001, T002 |
| Phase 2 | T005, T006 (after T003+T004) |
| Phase 3 | T013, T014 (after T007–T012); T017, T018 (after T015) |
| Phase 4 | T021, T022, T023 (after T019+T020) |
| Phase 5 | T026, T027 (after T024+T025) |
| Phase 6 | T028 (after Phase 2) — completely parallel with Phases 3–5 |
| Phase 7 | T029–T031 parallel with Phases 3–6 (different codebase layer) |
| Phase 8 | T032, T033 parallel with each other |

### Implementation Strategy

1. **MVP first**: Complete Phase 1 → 2 → 3 in sequence. At the end of Phase 3, the engine can produce a valid `.jsonl` file and the feature is minimally demonstrable.
2. **Incremental delivery**: Phase 4 adds drawdown analytics. Phase 5 adds fill events. Both extend the same hot-path call site with new helper methods.
3. **Independent parallel track**: Node.js ingester (Phase 7) can be developed concurrently with all Go phases by a different developer.
4. **Validation last**: Phase 8 integration tests require a working end-to-end stack (Docker Compose up).
