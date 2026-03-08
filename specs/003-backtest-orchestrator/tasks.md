# Tasks: Backtest Orchestrator

**Input**: Design documents from `/specs/003-backtest-orchestrator/`
**Prerequisites**: plan.md (Go 1.21+, shopspring/decimal, encoding/csv), spec.md (8 user story acceptance scenarios), data-model.md (Candle, Event, EventBus), contracts/orchestrator.go (public API)

**Architecture**: `core-engine/application/orchestrator/` with native PSM import (no IPC/gRPC)  
**Performance Target**: <10 seconds for 250,000 candles; <40µs per candle  
**Testing Strategy**: Test-Driven Development (TDD) - write tests FIRST, ensure they FAIL before implementation  
**Green Light Protocol**: All tests must pass before any commit; no feature work while tests fail

---

## Phase 1: Setup & Project Structure

**Purpose**: Initialize Go module, create directory structure, set up testing infrastructure

- [ ] T001 [core-engine] Create `core-engine/application/orchestrator/` directory structure with subdirectories: `orchestrator/`, `tests/`
- [ ] T002 [core-engine] Initialize `core-engine/application/orchestrator/go.mod` with PSM dependency and shopspring/decimal import
- [ ] T003 [P] [core-engine] Create `orchestrator/types.go` with Candle, Event, EventType, BacktestRun structs (copy from contracts/orchestrator.go)
- [ ] T004 [P] [core-engine] Create `orchestrator/config.go` with OrchestratorConfig struct
- [ ] T005 [P] [core-engine] Create `orchestrator/errors.go` with ErrMalformedCSV, ErrInvalidCandle, ErrPSMProcessing error types

---

## Phase 2: Event Bus (Foundation - BLOCKS All User Stories)

**Purpose**: Implement in-memory, thread-safe Event Bus before any user story work begins

**⚠️ CRITICAL**: Phase 2 MUST complete before user stories begin

### Tests for Event Bus (TDD - Write FIRST, ensure FAIL)

- [ ] T006 [P] [core-engine] Unit test: Event Bus append and retrieval in `orchestrator/tests/event_bus_test.go`
  - Test case: Append 10 events, verify GetAllEvents() returns all 10 in order
  - Test case: GetAllEvents() on empty bus returns empty slice
  - Test case: Concurrent reads during single-threaded append (no race condition)

- [ ] T007 [P] [core-engine] Unit test: Event Bus filtering by type in `orchestrator/tests/event_bus_test.go`
  - Test case: GetEventsByType(EventTypeBuyOrderExecuted) returns only buy order events
  - Test case: GetEventsByType returns empty slice if no events of that type

- [ ] T008 [P] [core-engine] Unit test: Event Bus time-range queries in `orchestrator/tests/event_bus_test.go`
  - Test case: GetEventsByTimeRange(start, end) returns events within window
  - Test case: Events outside window are excluded

### Implementation for Event Bus

- [ ] T009 [core-engine] Create `orchestrator/event_bus.go` with EventBus struct and methods:
  - `NewEventBus(preallocSize int) *EventBus` (pre-allocate for performance)
  - `Append(e Event) error` (thread-safe append)
  - `GetAllEvents() []Event`
  - `GetEventsByType(eventType EventType) []Event`
  - `GetEventsByTimeRange(start, end time.Time) []Event`
  - Use sync.RWMutex for thread-safe concurrent reads

- [ ] T010 [core-engine] Unit test: Event Bus memory safety in `orchestrator/tests/event_bus_test.go`
  - Test case: No memory leaks on large event counts (benchmark 1M events)
  - Test case: Event slice remains correct after many appends
  - Use `go test -race` to verify no data races

**Checkpoint**: Event Bus complete and fully tested - ready for orchestrator to use

---

## Phase 3: CSV Loader (High-Performance Data Adapter)

**Purpose**: Implement streaming OHLCV CSV parser with performance guarantee

### Tests for CSV Loader (TDD - Write FIRST, ensure FAIL)

- [ ] T011 [P] [core-engine] Unit test: CSV header parsing and validation in `orchestrator/tests/csv_loader_test.go`
  - Test case: Valid CSV with correct headers (symbol,timestamp,open,high,low,close,volume)
  - Test case: Invalid CSV (missing CLOSE column) returns error
  - Test case: Empty CSV file loads without error

- [ ] T012 [P] [core-engine] Unit test: CSV row parsing into Candle structs in `orchestrator/tests/csv_loader_test.go`
  - Test case: Single candle row parses correctly with Decimal precision
  - Test case: Multiple candles parse in order
  - Test case: Malformed row (invalid Decimal value) returns error with row index

- [ ] T013 [P] [core-engine] Unit test: CSV data validation (OHLCV invariants) in `orchestrator/tests/csv_loader_test.go`
  - Test case: High >= Low invariant enforced
  - Test case: Open, High, Close, Low all positive
  - Test case: Timestamp monotonically increasing

- [ ] T014 [core-engine] **Benchmark**: CSV parsing performance in `orchestrator/tests/csv_loader_bench_test.go`
  - Benchmark: Load 250,000 candles from CSV file
  - Target: Complete in <5 seconds (buffer well below 10s orchestrator total)
  - Output: `go test -bench=BenchmarkLoadCandles -v` shows ops/sec
  - Requirement: At least 50,000 candles/second throughput (~20µs per candle)
  - Call out: If benchmark fails, add pprof profiling to identify bottleneck

- [ ] T015 [P] [core-engine] Unit test: Empty and edge-case CSV files in `orchestrator/tests/csv_loader_test.go`
  - Test case: Empty CSV (only header) returns zero candles
  - Test case: Single candle CSV parses correctly
  - Test case: Very large CSV (simulated) doesn't cause memory issues

### Implementation for CSV Loader

- [ ] T016 [core-engine] Create `orchestrator/csv_loader.go` with CSVLoader struct:
  - `NewCSVLoader(filePath string) (*CSVLoader, error)` - validate file exists
  - `NextCandle() (*Candle, error)` - streaming iterator pattern
  - `Close() error` - clean up file handle
  - Use `encoding/csv.Reader` with buffered I/O (1 MB buffer)
  - Pre-allocate Candle struct to avoid allocations in hot path

- [ ] T017 [core-engine] Implement high-performance decimal parsing in `orchestrator/csv_loader.go`
  - Parse OHLCV values using `shopspring/decimal.NewFromString()`
  - Cache column indices (no repeated string lookups per row)
  - Error handling: return ParseError with row number and column name

- [ ] T018 [P] [core-engine] Implement CSV validation logic in `orchestrator/csv_loader.go`
  - Validate OHLCV invariants: High >= Low >= Open, High >= Close (catch data errors early)
  - Validate timestamps are monotonically increasing
  - Validate all prices/volumes are non-negative

**Checkpoint**: CSV Loader proven to parse 250K candles in <5 seconds - ready for orchestrator

---

## Phase 3: The Orchestrator Loop (Core Coordination)

**Purpose**: Implement the main backtest loop: load data → instantiate PSM → feed candles → capture events

### Tests for Orchestrator (TDD - Write FIRST, ensure FAIL)

- [ ] T019 [P] [core-engine] Unit test: Orchestrator initialization in `orchestrator/tests/orchestrator_test.go`
  - Test case: Create orchestrator with valid PSM config - initializes without error
  - Test case: PSM is instantiated and ready to accept candles
  - Test case: EventBus is empty before backtest starts

- [ ] T020 [core-engine] Acceptance test: P1/S1 - Valid CSV data loads and PSM initializes in `orchestrator/tests/orchestrator_test.go`
  - **Given** a valid CSV file with 100 candles
  - **When** Orchestrator.RunBacktest() is called
  - **Then** all 100 candles are processed in order AND EventBus has captured events
  - Assert: CandleCount == 100, EventCount > 0, no events are lost or reordered

- [ ] T021 [core-engine] Acceptance test: P1/S2 - Candles fed sequentially in `orchestrator/tests/orchestrator_test.go`
  - **Given** a CSV with 5 candles
  - **When** ProcessCandle() is called for each
  - **Then** events are captured in exact PSM emission order
  - Assert: event[0].Timestamp <= event[1].Timestamp, no gaps

- [ ] T022 [core-engine] Acceptance test: P1/S3 - Events captured with full fidelity in `orchestrator/tests/orchestrator_test.go`
  - **Given** PSM processes 3 candles that trigger buy orders
  - **When** events are captured by EventBus
  - **Then** every event has correct Decimal price (no float conversion), timestamp, and type
  - Assert: Event.Data contains exact Decimal values from PSM output

- [ ] T023 [core-engine] Acceptance test: P1/S4 - Deterministic execution in `orchestrator/tests/orchestrator_test.go`
  - **Given** same CSV and PSM config
  - **When** RunBacktest() executed twice
  - **Then** both runs produce identical event sequences (exact same events, same order)
  - Assert: run1.Events == run2.Events (deep equality)

- [ ] T024 [P] [core-engine] Acceptance test: P2/S1 - Empty CSV edge case in `orchestrator/tests/orchestrator_test.go`
  - **Given** an empty CSV file (only header)
  - **When** RunBacktest() executes
  - **Then** PSM initialized, no candles processed, EventBus remains empty
  - Assert: CandleCount == 0, EventCount == 0, no errors

- [ ] T025 [P] [core-engine] Acceptance test: P2/S2 - Single candle edge case in `orchestrator/tests/orchestrator_test.go`
  - **Given** CSV with 1 candle
  - **When** RunBacktest() executes
  - **Then** candle processed exactly once, any resulting events captured
  - Assert: CandleCount == 1, EventCount >= 0 (depends on PSM logic)

- [ ] T026 [core-engine] Acceptance test: P3/S1 - Large backtest (250K candles) in `orchestrator/tests/orchestrator_test.go`
  - **Given** CSV with 250,000 candles
  - **When** RunBacktest() executes
  - **Then** all candles processed without skips/duplicates, completes in under 10 seconds
  - Assert: CandleCount == 250000, total_time < 10 seconds, no memory leaks
  - Benchmark output: `go test -bench=BenchmarkRunBacktest_250K -v`

- [ ] T027 [P] [core-engine] Acceptance test: P3/S2 - Event Bus scales to thousands of events in `orchestrator/tests/orchestrator_test.go`
  - **Given** large backtest with 10,000+ events captured
  - **When** EventBus is queried for all events
  - **Then** all events retrievable in chronological order, no data loss
  - Assert: len(EventBus.GetAllEvents()) == EventCount, no duplicates, all unique timestamps present

- [ ] T028 [P] [core-engine] Unit test: Error handling - malformed CSV in `orchestrator/tests/orchestrator_test.go`
  - Test case: Missing CLOSE column returns ErrMalformedCSV
  - Test case: Invalid Decimal value returns ErrInvalidCandle with row number
  - Test case: PSM.ProcessCandle() returns error → caught and returned to caller

### Implementation for Orchestrator

- [ ] T029 [core-engine] Create `orchestrator/orchestrator.go` with main Orchestrator struct:
  - `struct Orchestrator { config OrchestratorConfig, psm *position.PositionStateMachine, eventBus *EventBus }`
  - `New(ctx context.Context, cfg OrchestratorConfig) (*Orchestrator, error)` - initialize PSM and EventBus
  - `RunBacktest(ctx context.Context) (*BacktestRun, error)` - main orchestration loop

- [ ] T030 [core-engine] Implement RunBacktest() main loop in `orchestrator/orchestrator.go`
  - Open CSV file using CSVLoader
  - Pre-allocate EventBus based on EstimatedCandleCount (if provided)
  - For each candle from CSV (streaming):
    - Call PSM.ProcessCandle(candle)
    - Capture returned events, append to EventBus
    - Track CandleCount and EventCount
  - Close CSV file on success or error
  - Return BacktestRun with final counts and EventBus
  - Handle ctx cancellation (context.DeadlineExceeded)

- [ ] T031 [core-engine] Implement GetEventBus() and GetRun() accessor methods in `orchestrator/orchestrator.go`
  - `GetEventBus() *EventBus` - return EventBus for post-backtest queries
  - `GetRun() *BacktestRun` - return current run snapshot

- [ ] T032 [core-engine] Implement error handling and recovery in `orchestrator/orchestrator.go`
  - Handle CSV parsing errors: return ErrMalformedCSV with row number/column
  - Handle PSM errors: return ErrPSMProcessing with candle index
  - Partial event capture: if error mid-backtest, return partial results (events up to error)
  - Graceful shutdown on context cancellation

**Checkpoint**: Full backtest orchestrator loop complete - all acceptance tests passing

---

## Phase 4: Integration Tests & Performance Validation

**Purpose**: End-to-end tests, performance profiling, and benchmark validation

### Tests for Integration & Performance

- [ ] T033 [P] [core-engine] Integration test: Full backtest workflow in `orchestrator/tests/integration_test.go`
  - Setup: Create `testdata/integration_100_candles.csv` with realistic BTCUSDT data
  - Create orchestrator instance
  - Run full backtest
  - Query EventBus for different event types
  - Assert: specific buy orders, take-profit hits, liquidations (if applicable)

- [ ] T034 [P] [core-engine] Integration test: Edge-case CSV files in `orchestrator/tests/integration_test.go`
  - `testdata/empty.csv` - empty file, verify empty EventBus
  - `testdata/single_candle.csv` - one candle, verify processed
  - `testdata/malformed.csv` - missing columns, verify error
  - Assert: each scenario behaves as expected

- [ ] T035 [core-engine] **Performance profile & optimization** in `orchestrator/tests/orchestrator_prof_test.go`
  - Run pprof on 250K candles backtest: `go test -cpuprofile=cpu.prof -bench=BenchmarkRunBacktest_250K`
  - Analyze `go tool pprof cpu.prof` to identify hot spots
  - If throughput < 25K candles/second (40µs per candle):
    - Reduce allocations in candle loop
    - Profile memory allocations: `go test -memprofile=mem.prof`
    - Consider pre-allocation of Decimal values (if PSM requires new instances)

- [ ] T036 [core-engine] **Benchmark: CSV Loader vs Orchestrator Loop trade-off** in `orchestrator/tests/benchmarks_test.go`
  - Benchmark PSM.ProcessCandle() time (get baseline from PSM tests)
  - Benchmark orchestrator loop time (candle → PSM → EventBus)
  - Overhead analysis: (orchestrator_time - psm_time) / orchestrator_time × 100%
  - Target: <10% overhead (most time spent in PSM, not orchestration)

- [ ] T037 [P] [core-engine] Unit test: Memory efficiency check in `orchestrator/tests/orchestrator_test.go`
  - Run two sequential 250K backtests
  - Verify memory returned to OS (no leaks)
  - Use `runtime.ReadMemStats()` before/after backtest
  - Assert: Allocation delta is proportional to event count (not runaway)

- [ ] T038 [core-engine] **Documentation & Quickstart validation** in `orchestrator/tests/quickstart_test.go`
  - Execute examples from [quickstart.md](../quickstart.md)
  - Create orchestrator as shown
  - Run backtest as shown
  - Query EventBus as shown
  - Assert: All examples compile and produce expected outputs

### Implementation for Integration

- [ ] T039 [P] [core-engine] Create test data directory and realistic CSV files in `orchestrator/tests/testdata/`
  - `integration_100_candles.csv` - 100 rows of realistic BTCUSDT OHLCV data
  - `empty.csv` - empty (header only)
  - `single_candle.csv` - 1 data row
  - `malformed.csv` - missing CLOSE column (test error handling)
  - `large_250k.csv` - (optional: generated dynamically by benchmark) or simulated

- [ ] T040 [P] [core-engine] Create test helper functions in `orchestrator/tests/test_helpers.go`
  - `MakePSMConfig() position.Config` - valid config for testing
  - `MakeSampleCandle() *Candle` - quick candle factory
  - `LoadTestCSV(filePath string) []*Candle` - load CSV for comparison
  - `AssertEventsEqual(t *testing.T, got, want []Event)` - deep event comparison

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final polish, documentation, and quality assurance

- [ ] T041 [P] [core-engine] Code cleanup and style in `orchestrator/`
  - Run `gofmt` and `goimports` on all Go files
  - Check for unused variables/imports: `go vet ./...`
  - Address any linter warnings

- [ ] T042 [P] [core-engine] Add package documentation in `orchestrator/doc.go`
  - Document the orchestrator package
  - Explain architecture: CSV → CSVLoader → Candle → PSM → Event → EventBus
  - Explain performance targets and design decisions

- [ ] T043 [core-engine] Verify all acceptance scenarios covered in `orchestrator/tests/`
  - Acceptance test count: should be ≥8 (4×P1, 2×P2, 2×P3)
  - Each test has clear Given/When/Then structure
  - Each test asserts specific BDD criteria from spec.md

- [ ] T044 [P] [core-engine] Final performance validation in `orchestrator/tests/`
  - Run all benchmarks: `go test -bench=. -benchmem`
  - CSV Loader: >50K candles/sec ✓
  - Orchestrator Loop: <10 sec for 250K candles ✓
  - Memory overhead: <50% above event count size ✓

- [ ] T045 [core-engine] Create quickstart example binary in `orchestrator/examples/backtest_cli.go` (optional)
  - CLI tool to run orchestrator from command line
  - Usage: `./backtest_cli -config config.json -data data.csv`
  - Output: prints backtest results and event summary

- [ ] T046 [P] [core-engine] Update [quickstart.md](../quickstart.md) with final API and examples
  - Confirm all code examples compile and run
  - Update any references to internal implementation details
  - Add "Troubleshooting" section for common errors

- [ ] T047 [core-engine] Green Light Protocol final check
  - Run `go test ./... -race -v` - all tests pass, no races
  - Check test coverage: `go test -cover ./...` (aim for >80%)
  - No failing tests allowed before commit to main branch

**Checkpoint**: All user stories complete, tested, and ready for merge

---

## Dependencies & Execution Order

### Phase Dependencies (CRITICAL)

1. **Phase 1 (Setup)**: No dependencies
2. **Phase 2 (Event Bus)**: Depends on Phase 1 ✅ Must complete before Phase 3
3. **Phase 3 (CSV Loader + Orchestrator Loop)**: Depends on Phase 2 ✅ Must complete before integration
4. **Phase 4 (Integration & Performance)**: Depends on Phases 1-3
5. **Phase 5 (Polish)**: Depends on all previous phases

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Phase 3 implementation
  - Tasks T020-T023 (main orchestrator acceptance tests)
  - Delivered: Full backtest with 100+ candles and event capture

- **User Story 2 (P2)**: Can start after Phase 3 implementation
  - Tasks T024-T025 (edge case tests; empty and single candle)
  - Can be implemented in parallel with US1 (different test fixtures)

- **User Story 3 (P3)**: Can start after Phase 3 implementation + T026 (large dataset benchmark)
  - Tasks T026-T027 (performance and scalability)
  - Depends on CSV Loader benchmark passing (T014)

### Within Phase 3: Parallel Opportunities

After Phase 2 complete:
- T011-T015: CSV Loader tests (TDD) can all be written before T016 implementation
- T019-T028: Orchestrator tests (TDD) can be written before T029 implementation
- **Then sequentially**: Implement T016-T018, then T029-T032

### Parallel Across Stories (After Phase 3)

Once Phase 3 complete:
- Developer A: Finalize P1 story tests & implementation
- Developer B: Finalize P2 story tests & implementation
- Developer C: Finalize P3 story benchmarks & validation
- **All can run in parallel** because they use isolated test fixtures

---

## Parallel Example: Test-First Development Flow

### Phase 2: Event Bus (Example of parallel TDD)

```bash
# Write all tests simultaneously (max parallelism)
Task T006: Write Event Bus append/retrieval tests
Task T007: Write Event Bus filtering tests
Task T008: Write Event Bus time-range tests
Task T010: Write race condition tests

# ENSURE ALL TESTS FAIL before implementation
go test ./orchestrator/tests/event_bus_test.go
# Expected: all fail (functions not yet implemented)

# Then implement all methods
Task T009: Implement EventBus struct and all methods

# VERIFY ALL TESTS PASS
go test ./orchestrator/tests/event_bus_test.go -race -v
# Expected: all pass, no races
```

### Phase 3: CSV Loader + Orchestrator Loop (Parallel TDD)

```bash
# Parallel: Write all tests for CSV Loader (max parallelism)
Task T011: CSV header parsing tests
Task T012: CSV row parsing tests
Task T013: CSV validation tests
Task T014: CSV performance benchmark
Task T015: CSV edge-case tests

# Parallel: Write all tests for Orchestrator Loop (max parallelism)
Task T019: Orchestrator initialization tests
Task T020-T028: Orchestrator acceptance + error handling tests

# ENSURE ALL TESTS FAIL before implementation
go test ./orchestrator/tests/ -v
# Expected: 15+ test functions fail

# Then implement sequentially:
Task T016-T018: CSV Loader implementation
Task T029-T032: Orchestrator implementation

# VERIFY ALL TESTS PASS
go test ./orchestrator/tests/ -race -v
# Expected: all pass, no races, benchmarks show >50K candles/sec and <10s for 250K
```

---

## Implementation Strategy

### MVP First: User Story 1 Only (P1)

**Minimum to deliver value**: Full backtest with 100+ candles, event capture

1. Phase 1: Setup ✓
2. Phase 2: Event Bus ✓
3. Phase 3: CSV Loader + Orchestrator Loop ✓
4. Phase 4: Integration tests (T033 only) ✓
5. **STOP and Validate**: Does P1 work independently?
   - Run T020-T023 (P1 acceptance tests)
   - All pass? → Deploy to users
   - Users can backtest and capture events

### Incremental Delivery

1. **Release 1**: P1 (Run Backtest + Event Capture) → Users run 100-candle tests
2. **Release 2**: P2 (Edge Cases) → Users can safely run empty/single-candle backtests
3. **Release 3**: P3 (Large Scale + Performance) → Users can backtest 1+ years of data in <10s

### Team Coordination

**Single Developer**:
- Complete phases in order: 1 → 2 → 3 → 4 → 5
- Focus on P1 first (MVP)
- Then add P2 (robustness)
- Then add P3 (performance)

**Multiple Developers (after Phase 2 complete)**:
- Developer A: P1 acceptance tests + implementation (T020-T023, T029-T031)
- Developer B: P2 edge cases + implementation (T024-T025)
- Developer C: P3 performance + benchmarks (T026-T027, T035-T037)
- **Merge when all tests pass** (Green Light Protocol)

---

## Critical Success Criteria (Must Achieve)

Before declaring feature COMPLETE:

- ✅ All 8 acceptance test scenarios PASS (P1: 4, P2: 2, P3: 2)
- ✅ No failing tests (Green Light Protocol enforced)
- ✅ No data race conditions (`go test -race` passes)
- ✅ CSV Loader throughput: >50,000 candles/second (benchmark T014)
- ✅ Orchestrator total time: <10 seconds for 250,000 candles (benchmark T026)
- ✅ Event capture fidelity: 100% (no lost events, no reordering)
- ✅ Deterministic execution: identical events on repeat runs (test T023)
- ✅ Memory efficiency: no leaks, proportional to event count (test T037)
- ✅ Code coverage: >80% (`go test -cover`)
- ✅ No infrastructure leakage: PSM domain unchanged (verify imports in plan.md)

---

## Notes

- `[P]` = Parallelizable (different files, no dependencies)
- `[core-engine]` = Go/Rust implementation (no framework, pure domain + infrastructure)
- All tests MUST fail before implementation (TDD discipline)
- All tasks include explicit file paths for clarity
- Benchmark thresholds (50K candles/sec, <10s total) are intentional (meets spec SC-004)
- Error test cases (T028) are CRITICAL for robustness
- Performance profiling (T035) is CRITICAL for meeting <10s target
- Memory tests (T037) prevent regressions on large backtests
