---
description: "Implementation tasks for Feature 004 - API Layer HTTP Service"
---

# Tasks: API Layer - HTTP Service

**Input**: Design documents from `/specs/004-api-layer/`  
**Specification**: [spec.md](spec.md) (5 user stories, 20 functional requirements)  
**Implementation Plan**: [plan.md](plan.md) (3-phase roadmap with Phase 1 design completed)  
**Data Model**: [data-model.md](data-model.md) (6 core entities, request lifecycle state machine)  
**Contracts**: [contracts/](contracts/) (5 TypeScript interfaces with validation rules)  
**Quickstart**: [quickstart.md](quickstart.md) (development setup guide with mock binary)

---

## Overview

This task list implements Feature 004 - API Layer as a **Test-Driven Development (TDD) sequence** across 5 phases:

1. **Phase 1: Project Setup & Decimal Validation** — Initialize TypeScript/Node.js project scaffolding and implement DecimalValidator (foundation for all validation)
2. **Phase 2: The Subprocess Adapter & ndjson Streaming** — Write integration tests that mock Go binary output FIRST, then implement BacktestService with non-blocking subprocess management
3. **Phase 3: The Event Aggregator** — Implement EventBusParser and PnlSummary calculation with safety_order_usage_counts tracking
4. **Phase 4: Express HTTP Handlers & Error Mapping** — Implement all endpoints, request/response validation, error mapping, result persistence
5. **Phase 5: Integration Testing** — End-to-end BDD acceptance tests, concurrency chaos tests, load testing

**Critical Principle**: Each user story can be tested INDEPENDENTLY and DELIVERED INCREMENTALLY.

**User Stories**:
- **US1** (P1): Submit Backtest Configuration and Receive Results
- **US2** (P1): Handle Concurrent Backtest Requests
- **US3** (P1): Clear Error Messages for Configuration and Execution Failures
- **US4** (P2): Query Historical Backtest Results
- **US5** (P2): Monitor API Health and Execution Status

---

## Phase 1: Project Setup & Decimal Validation

**Purpose**: Initialize project structure and implement decimal validation (foundation for all subsequent work)

**Checkpoint**: After this phase, project compiles, linter passes, DecimalValidator has 100% test coverage

### ES-Module Project Structure

- [ ] T001 Create Express.js project in `orchestrator/api/` with TypeScript configuration in `orchestrator/api/tsconfig.json`
- [ ] T002 [P] Create source directory structure: `orchestrator/api/src/{types,services,routes,utils,middleware,config}`
- [ ] T003 [P] Setup package.json with dependencies: express@4.18+, typescript@5.1+, decimal.js, pino, ndjson, jest, ts-jest, supertest
- [ ] T004 [P] Configure TypeScript compiler targets (ESNext, module: ESNext, strict true, resolveJsonModule true)
- [ ] T005 [P] Setup .eslintrc.json with TypeScript rules and format on save configuration
- [ ] T006 Setup test configuration: `orchestrator/api/jest.config.js` with ts-jest preset and test match patterns

### TDD: Decimal Validation Tests → Implementation

- [ ] T007 [P] Write test file `orchestrator/api/src/utils/DecimalValidator.test.ts` with 15+ test cases covering:
  - ✅ Valid decimal strings: "100.50", "0.50000000", "1000.12345678"
  - ❌ Rejected floats: 100.5 (type error), "100.5" converted from float (precision check)
  - ❌ Rejected out-of-bounds: -100 (negative), "99999999.99999999" (exceeds 8 places)
  - ❌ Rejected invalid format: "abc", "100 50", empty string
  - Edge case: "0", "0.00000000", "0.00000001"
- [ ] T008 [P] Write test file `orchestrator/api/src/types/configuration.test.ts` with BacktestRequest validation tests covering:
  - ✅ Valid configuration acceptance with all required fields
  - ❌ Missing field rejection: no entry_price, no amounts, no sequences
  - ❌ Type mismatch rejection: amounts as object instead of array, leverage as number instead of string
  - ❌ Out-of-bounds rejection: sequences length != amounts length
  - ❌ Margin ratio validation: margin_ratio < 0, margin_ratio >= 1
- [ ] T009 Implement `orchestrator/api/src/utils/DecimalValidator.ts` with functions validateDecimal(value: any): string and validateDecimalArray(arr: any[]): string[]
- [ ] T010 Implement `orchestrator/api/src/types/configuration.ts` with BacktestRequest interface and validateBacktestRequest(req: unknown): BacktestRequest function (throws ValidationError on failure)
- [ ] T011 [P] Create configuration loader `orchestrator/api/src/config/AppConfig.ts` reading from environment: CORE_ENGINE_BINARY_PATH, MAX_WORKER_THREADS, TIMEOUT_MS, RESULTS_DIR, RESULTS_TTL_DAYS
- [ ] T012 [P] Setup base types file `orchestrator/api/src/types/index.ts` exporting: BacktestRequest, TradeEvent (union of 5 types from contracts), BacktestResult, PnlSummary, ErrorDetails, PositionState

**Tests**: Run `npm run test -- src/utils/DecimalValidator.test.ts src/types/configuration.test.ts` → All 25+ tests PASS

---

## Phase 2: The Subprocess Adapter & ndjson Streaming

**Purpose**: Implement non-blocking subprocess management with mocked Go binary tests FIRST (TDD discipline)

**Checkpoint**: After this phase, BacktestService spawns processes, handles stdin/stdout streaming, respects 30s timeout, but still uses mock binary for testing

### TDD: Mock Go Binary Integration Tests → BacktestService Implementation

- [ ] T013 [P] Create mock Go binary script `orchestrator/api/testdata/mock-core-engine.sh`:
  - Reads JSON from stdin (validated against BacktestRequest schema)
  - Outputs canonical ndjson Event Bus sequence (5+ complete events)
  - Example events: PositionOpenedEvent → 3x OrderFilledEvents → PositionClosedEvent
  - Supports --fail flag to simulate crash, --timeout flag for slow responses
  - File: `orchestrator/api/testdata/mock-core-engine.sh` (500+ lines)

- [ ] T014 Write integration test file `orchestrator/api/src/services/BacktestService.integration.test.ts` with mocked Go binary covering:
  - ✅ Valid configuration executes within 30 seconds, returns complete TradeEvent[] with 5+ events
  - ✅ Events in timestamp order: PositionOpened (ts=1000) → OrderFilled (ts=1100) → OrderFilled (ts=1200) → ... → PositionClosed (ts=2000)
  - ✅ Each event includes complete PositionState snapshot (quantity, leverage, status, timestamp)
  - ✅ Final event position state matches expected closing state
  - ❌ Process timeout at 30 seconds returns EXECUTION_TIMEOUT error
  - ❌ Process crash (signal 6, signal 11) returns EXECUTION_BINARY_CRASH error
  - ❌ Invalid JSON stdin returns CSV_PARSE_ERROR error
  - ✅ Memory limits enforced: process killed if heap > 512MB
  - ✅ stdout truncation handled gracefully (last partial JSON event skipped)
  - File: `orchestrator/api/src/services/BacktestService.integration.test.ts` (400+ lines)

- [ ] T015 [P] Create enum file `orchestrator/api/src/types/errors.ts` with error codes (see contracts/error-mapping.ts):
  - VALIDATION_MISSING_FIELD, VALIDATION_FLOAT_PRECISION, VALIDATION_OUT_OF_BOUNDS, VALIDATION_TYPE_ERROR
  - EXECUTION_BINARY_CRASH, EXECUTION_TIMEOUT, EXECUTION_OUT_OF_MEMORY, EXECUTION_SIGNAL_KILLED
  - BINARY_FILE_NOT_FOUND, BINARY_PERMISSION_DENIED
  - CSV_FILE_NOT_FOUND, CSV_PARSE_ERROR
  - STORAGE_WRITE_ERROR, STORAGE_RETRIEVE_ERROR, REQUEST_VALIDATION_FAILED, IDEMPOTENCY_KEY_INVALID
  - INTERNAL_SERVER_ERROR
  - Each error code includes http_status, message_template, and mapper function

- [ ] T016 Implement `orchestrator/api/src/services/BacktestService.ts` with class BacktestService:
  - **Constructor**: accepts AppConfig, logger, coreEngineBinaryPath
  - **Method**: async execute(request: BacktestRequest, timeoutMs: number = 30000): Promise<{ events: TradeEvent[], executionTimeMs: number }>
  - Spawns Core Engine binary as child_process.spawn()
  - Streams request to stdin as JSON: JSON.stringify(request) + newline
  - Reads stdout line-by-line (split2 ndjson parser), accumulates TradeEvent[]
  - Implements 30-second timeout via signal.timeout, sends SIGTERM on overage, waits 2s before SIGKILL
  - Captures stderr for error mapping (see ErrorMapper)
  - Returns complete TradeEvent[] in execution order, tracks executionTimeMs (high-resolution timer)
  - Throws ProcessError on non-zero exit code with stderr content
  - File: ~350 lines with comments

- [x] T017 [P] Implement ndjson event parser `orchestrator/api/src/utils/EventBusParser.ts` with function parseEventLine(line: string): TradeEvent: ✅
  - Parses JSON line into typed TradeEvent (PositionOpenedEvent | OrderFilledEvent | PositionClosedEvent | LiquidationEvent | GapDownEvent)
  - Validates event structure matches contract /contracts/trade-event.ts
  - Throws ParseError with line number if JSON invalid or schema mismatch
  - Recursively validates nested PositionState objects
  - File: ~200 lines with examples ✅

- [ ] T018 [P] Create error mapper `orchestrator/api/src/services/ErrorMapper.ts` with function mapSubprocessError(stderr: string, exitCode: number): ErrorDetails:
  - Maps Core Engine stderr patterns to error codes:
    - "timeout" (case-insensitive) → EXECUTION_TIMEOUT
    - "out of memory" → EXECUTION_OUT_OF_MEMORY
    - "No such file" → BINARY_FILE_NOT_FOUND
    - "permission denied" → BINARY_PERMISSION_DENIED
    - "CSV parse error" → CSV_PARSE_ERROR
    - "invalid configuration" → VALIDATION_TYPE_ERROR
    - Signal 15 (SIGTERM) → EXECUTION_TIMEOUT (we killed it due to timeout)
    - Signal 9 (SIGKILL) → EXECUTION_SIGNAL_KILLED
    - Non-zero exit → EXECUTION_BINARY_CRASH
  - Returns ErrorDetails with mapped code, user-friendly message from error code template, technical message (stderr content), truncated stderr (first 500 chars)
  - File: ~200 lines

- [ ] T019 [P] Implement worker pool `orchestrator/api/src/services/ProcessManager.ts` with class ProcessManager:
  - **Constructor**: maxWorkers = os.cpus().length (auto-detect CPU cores)
  - **Properties**: activeQueue (Queue<PendingBacktest>), workers (Worker[]), metrics (active_count, total_completed, errors)
  - **Method**: async enqueue(request: BacktestRequest): Promise<string> → returns requestId
  - **Method**: async getStatus(requestId: string): Promise<BacktestStatus> (pending/running/complete/failed)
  - Spawns worker threads (not child_process; Node.js Worker API) limited to maxWorkers
  - Dequeues from queue when worker becomes available
  - Enforces fair scheduling (FIFO)
  - Metrics tracked: queue depth, worker utilization, average execution time
  - File: ~300 lines

**Run Tests**:
- `npm run test -- src/services/BacktestService.integration.test.ts` → All 8+ scenarios PASS with mock binary
- `npm run test -- src/utils/EventBusParser.test.ts` → All parsing edge cases PASS
- `npm run test -- src/services/ErrorMapper.test.ts` → All 13 error codes map correctly

---

## Phase 3: The Event Aggregator

**Purpose**: Implement EventBusParser integration, PnlSummary calculation with safety_order_usage_counts tracking, and drawdown computation

**Checkpoint**: After this phase, complete Event Bus output sequences are accurately aggregated into PnlSummary with per-safety-order fill counts

### TDD: PnlSummary Calculation Tests → Implementation

- [x] T020 [P] Write test file `orchestrator/api/src/services/ResultAggregator.test.ts` with 25+ test cases covering:
  - ✅ Simple single-entry scenario: 1 PositionOpenedEvent → PositionClosedEvent → PnlSummary with no fills, total_pnl = -entry_fee
  - ✅ Multi-fill DCA scenario: PositionOpened → 3x OrderFilled at prices [100, 95, 90] → PositionClosed → PnlSummary.total_fills = 3, safety_order_usage_counts = { "0": 1, "1": 1, "2": 1 }
  - ✅ Liquidation scenario: PositionOpened → 2x OrderFilled → LiquidationEvent → PnlSummary includes liquidation_fee, status = LIQUIDATED
  - ✅ Gap-down event: PositionOpened → GapDownEvent (fills at limit prices) → PositionClosed → fills counted correctly (Gap-Down Paradox: respects limit prices, not opportunistic improvement)
  - ✅ Max drawdown calculation: Multiple fills with peak/trough tracking → max_drawdown_percent correctly computed
  - ✅ ROI calculation: total_pnl, initial_investment (entry_price × quantity + entry_fee), roi_percent = (pnl / investment) × 100 with 2 decimal places
  - ✅ Safety order usage counts: safety_order_usage_counts tracks index frequency (e.g., safety order 1 filled 45 times across all events)
  - ✅ Precision guarantee: All monetary values serialized with 8 decimal places (no rounding artifacts)
  - ❌ Inconsistent event order (events not sorted by timestamp) → error
  - ❌ Missing required event fields (price, quantity, timestamp) → error
  - Edge case: unrealized_pnl when position still OPEN (not closed)
  - Edge case: safety order index mapping (sequences[i] indices)
  - File: ~500 lines

- [x] T021 Implement `orchestrator/api/src/services/ResultAggregator.ts` with class ResultAggregator:
  - **Constructor**: takes Decimal helper for arithmetic
  - **Method**: async aggregateEvents(events: TradeEvent[]): Promise<PnlSummary>
  - Validates events in timestamp order
  - Scans event sequence:
    - Track: entry_price, initial_quantity, entry_fee (from PositionOpenedEvent)
    - Track: all OrderFilledEvents with price, quantity, fee, safety_order_index
    - Track: peak_balance and trough_balance for drawdown calculation
    - Track: liquidation_fee if LiquidationEvent present
    - Count fills per safety_order_index in safety_order_usage_counts
    - Compute: total_pnl, roi_percent, max_drawdown_percent
    - Compute: realized_pnl (same as total_pnl for closed), unrealized_pnl (if position still open)
  - All arithmetic via Decimal (no floats)
  - Returns complete PnlSummary object with all fields including safety_order_usage_counts: Record<number, number>
  - File: ~400 lines

- [x] T022 [P] Implement `orchestrator/api/src/utils/PrecisionFormatter.ts` with formatters:
  - function formatPrice(value: Decimal): string → 8 decimal places (e.g., "100.50000000")
  - function formatAmount(value: Decimal): string → 8 decimal places (e.g., "10.25000000")
  - function formatPercentage(value: Decimal): string → 2 decimal places (e.g., "5.50")
  - function formatTimestamp(ms: number): string → ISO 8601 with Z suffix (e.g., "2026-03-08T12:00:00.000Z")
  - All formatters use Decimal.toFixed() with explicit precision
  - File: ~150 lines

- [x] T023 [P] Write test coverage `orchestrator/api/src/services/EventBusParser.test.ts` with 12+ test cases:
  - ✅ Parse complete Event Bus sequence (5+ different event types in order)
  - ✅ Validate nested PositionState in each event
  - ✅ Handle gap-down events with fill array
  - ✅ Validate precision of all numeric fields (8 places for prices, 2 for percentages)
  - ❌ Reject malformed JSON lines
  - ❌ Reject events with missing required fields
  - ❌ Reject events with wrong event type strings

- [x] T024 Create integration test `orchestrator/api/src/integration/event-aggregation.integration.test.ts`:
  - ✅ End-to-end: Mock binary output → BacktestService.execute() → raw TradeEvent[]
  - ✅ Then: ResultAggregator.aggregateEvents() → complete PnlSummary
  - ✅ Verify: PnlSummary matches canonical test data (see spec.md canonical test data table)
  - ✅ Verify: safety_order_usage_counts correctly tallied across all OrderFilledEvents
  - ✅ Verify: precision of all formatted output values matches spec requirements

**Tests**: Run `npm run test -- src/services/ResultAggregator.test.ts src/utils/PrecisionFormatter.test.ts` → All 35+ tests PASS

---

## Phase 4: Express HTTP Handlers & Error Mapping

**Purpose**: Implement all REST endpoints, request/response validation, error mapping, and result persistence

**Goal**: User Stories US1, US3, US4, US5 (HTTP layer becomes functional)

### Foundational: Middleware and Error Handling

- [ ] T025 [P] Create validation middleware `orchestrator/api/src/middleware/validation.middleware.ts`:
  - Extract body, validate against BacktestRequest schema
  - Check: all required fields present
  - Check: decimal.js validation for prices/amounts (no floats)
  - Check: bounds validation (entry_price > 0, margin_ratio ∈ [0,1), etc.)
  - Check: sequences length matches amounts length
  - On error: next(ValidationError)
  - File: ~150 lines

- [ ] T026 Create error handler middleware `orchestrator/api/src/middleware/error-handler.middleware.ts`:
  - Catch all error types (ValidationError, ProcessError, StorageError, etc.)
  - Map error code (from ErrorMapper) to error_mapping.ts ERROR_CODES
  - Build HTTP response: { error: { code, http_status, message, field?, details? } }
  - Log error with error_code, request_id (if available)
  - Return HTTP response with mapped status code
  - File: ~200 lines

- [ ] T027 [P] Create request ID generator `orchestrator/api/src/utils/RequestIdGenerator.ts`:
  - Generate UUID v4 for request_id
  - Validate optional idempotency_key is valid UUID (RFC 4122)
  - File: ~100 lines

- [ ] T028 Create logging middleware `orchestrator/api/src/middleware/request-logger.middleware.ts`:
  - Log request: method, path, query, body summary (redact sensitive fields)
  - Attach timestamp, request_id to request context
  - File: ~100 lines

### Result Persistence

- [ ] T029 Implement `orchestrator/api/src/services/ResultStore.ts` with class ResultStore:
  - **Storage backends**: File-based (JSON) + SQLite index
  - **Constructor**: takes storagePath, ttlDays (default 7)
  - **Method**: async save(result: BacktestResult): Promise<void>
    - Write to `storagePath/results/{request_id}.json`
    - Insert row into SQLite index table: (request_id, timestamp, status, config_hash)
    - Create .meta file with TTL expiration timestamp
  - **Method**: async retrieve(request_id: string): Promise<BacktestResult>
    - Query SQLite index for existence (soft delete check)
    - Read from disk {request_id}.json, return typed BacktestResult
    - Throw StorageError if not found or expired
  - **Method**: async queryByDateRange(from: Date, to: Date): Promise<BacktestResult[]> (paginated)
    - Query SQLite index WHERE timestamp BETWEEN from AND to
    - Paginate results (default 50 per page)
    - Return BacktestResultPage with pagination metadata
  - **Method**: async cleanup(): Promise<number> → delete expired files + DB rows (called by scheduler)
  - File: ~350 lines

- [ ] T030 [P] Implement idempotency cache `orchestrator/api/src/services/IdempotencyCache.ts`:
  - Optional feature for MVP but structure in place
  - Store: { idempotency_key: { request_id, result, created_at } }
  - TTL: same as result TTL (7 days)
  - File: ~150 lines

- [ ] T031 [P] Create result cleanup scheduler `orchestrator/api/src/jobs/ResultCleanupJob.ts`:
  - Run daily at 00:00 UTC (configurable)
  - Call ResultStore.cleanup() to delete 7-day+ old results
  - Log deleted count
  - File: ~100 lines

### HTTP Endpoints: POST /backtest

- [ ] T032 Write test file `orchestrator/api/src/routes/backtest.routes.test.ts` for POST /backtest:
  - ✅ Valid request → HTTP 200 with complete BacktestResult (status: success)
  - ✅ Response includes: request_id, events[], final_position, pnl_summary (with safety_order_usage_counts), execution_time_ms, timestamp
  - ✅ All decimal values formatted correctly (8 places for prices, 2 for percentages)
  - ✅ Response matches spec.md canonical test data
  - ❌ Missing field → HTTP 400 with message listing missing field
  - ❌ Float precision (e.g., "entry_price": 1.1) → HTTP 400 with precision requirement message
  - ❌ Out-of-bounds (e.g., margin_ratio: 1.5) → HTTP 422 with boundary message
  - ❌ Invalid sequences (length != amounts length) → HTTP 400 with detail
  - ❌ CSV file not found on Core Engine host → HTTP 422 with "CSV file not found"
  - ❌ Core Engine timeout → HTTP 504 with "execution exceeded 30-second timeout"
  - ❌ Core Engine crash → HTTP 500 with "execution failed"
  - File: ~400 lines with supertest

- [ ] T033 Implement `orchestrator/api/src/routes/backtest.routes.ts` with:
  - **POST /backtest**:
    - Extract request ID, idempotency_key (optional)
    - Validate request body (validation middleware)
    - Check cache for idempotency_key (if provided) → return cached if found
    - Call ProcessManager.enqueue() to queue backtest
    - Poll for completion (up to 35s) or stream WebSocket-style (MVP: polling only)
    - On completion: retrieve events from BacktestService
    - Call ResultAggregator.aggregateEvents() → PnlSummary
    - Format response (PrecisionFormatter)
    - Call ResultStore.save()
    - Return HTTP 200 with BacktestResult JSON
    - On error: catch exception, call ErrorMapper, return HTTP error
  - Error handler: return ErrorResponse structure (from error-mapping.ts)
  - File: ~300 lines

### HTTP Endpoints: GET /backtest/:request_id

- [ ] T034 Write test file `orchestrator/api/src/routes/backtest.routes.test.ts` for GET /backtest/:request_id:
  - ✅ Valid request_id → HTTP 200 with exact BacktestResult from storage
  - ❌ Invalid request_id (not a UUID) → HTTP 400
  - ❌ Request not found → HTTP 404
  - ❌ Request expired (> 7 days) → HTTP 404
  - Response precision matches original

- [ ] T035 Add to `orchestrator/api/src/routes/backtest.routes.ts`:
  - **GET /backtest/:request_id**:
    - Validate request_id is UUID
    - Call ResultStore.retrieve(request_id)
    - Return HTTP 200 with BacktestResult JSON
    - On error: return HTTP 400/404/500

### HTTP Endpoints: GET /backtest (Query by Date Range)

- [ ] T036 Write test file `orchestrator/api/src/routes/backtest.routes.test.ts` for GET /backtest (query):
  - ✅ Query /backtest?from=2026-03-07&to=2026-03-08 → HTTP 200 with BacktestResultPage (array of results in date range)
  - ✅ Pagination: ?from=X&to=Y&page=0&limit=50 → returns limit results, has_more flag
  - ✅ Status filter: ?from=X&to=Y&status=success → returns only successful results
  - ❌ Invalid date format → HTTP 400
  - ❌ from > to → HTTP 400

- [ ] T037 Add to `orchestrator/api/src/routes/backtest.routes.ts`:
  - **GET /backtest?from=ISO_DATE&to=ISO_DATE[&status=success|failed|all][&page=N][&limit=50]**:
    - Parse and validate query params (date format, status enum, page/limit integers)
    - Call ResultStore.queryByDateRange()
    - Return HTTP 200 with BacktestResultPage JSON

### HTTP Endpoints: GET /health

- [ ] T038 Write test file `orchestrator/api/src/routes/health.routes.test.ts`:
  - ✅ Core Engine binary available → HTTP 200, status: healthy, binary_availability: ready
  - ✅ Queue empty and recent errors < 5% → status: healthy
  - ✅ Queue depth 20+, last 10 errors → status: degraded, error_rate: 10%
  - ✅ Binary unavailable or error_rate > 20% → status: unhealthy
  - Returns: status, timestamp, uptime_seconds, core_engine health, queue metrics, operational metrics
  - File: ~150 lines

- [ ] T039 Implement `orchestrator/api/src/services/HealthMonitor.ts` with class HealthMonitor:
  - **Method**: async getStatus(): Promise<HealthResponse>
  - Check: Core Engine binary exists and has execute permission
  - Check: Queue depth, workers active
  - Calculate: Error rate (errors / (errors + successes) in last 1 hour), timeout rate
  - Calculate: Response time histogram (p50, p95, p99)
  - Return HealthResponse with all metrics
  - File: ~200 lines

- [ ] T040 Add to `orchestrator/api/src/routes/health.routes.ts`:
  - **GET /health**:
    - Call HealthMonitor.getStatus()
    - Return HTTP 200 with HealthResponse JSON

### Express App Configuration

- [ ] T041 Create app factory `orchestrator/api/src/app.ts`:
  - Initialize Express app
  - Register middleware stack: request-logger → validation → routes → error-handler
  - Mount routes: /backtest (backtest.routes), /health (health.routes)
  - Return configured app instance
  - File: ~150 lines

- [ ] T042 Create server entry point `orchestrator/api/src/main.ts`:
  - Initialize AppConfig from environment
  - Initialize services: ResultStore, ProcessManager, HealthMonitor, ErrorMapper
  - Create Express app via factory
  - Start HTTP server on port (default 3000, configurable via PORT env)
  - Graceful shutdown: on SIGTERM/SIGINT → stop accepting requests, drain worker queue, close HTTP server, exit
  - File: ~150 lines

**After Phase 4, ALL 5 USER STORIES are HTTP-accessible and testable**

---

## Phase 5: Integration Testing & QA

**Purpose**: End-to-end BDD acceptance tests, concurrency chaos tests, performance validation, documentation

**Checkpoint**: All user stories validated, Green Light Protocol passes (npm run test:all), ready for deployment

### BDD Acceptance Tests (from spec.md)

- [ ] T043 Create BDD test suite `orchestrator/api/tests/acceptance/us1-submit-backtest.feature.test.ts` (User Story 1):
  - **Scenario 1**: Valid configuration → HTTP 200 with complete results for all trades, final position, P&L
  - **Scenario 2**: Gap-down event → parsed correctly, position state reflects gap-down
  - **Scenario 3**: Multiple fills → all fills in events[], correct quantities/prices, position state updates accurate
  - Test User Story 1 independently (ignore concurrency)
  - File: ~250 lines

- [ ] T044 Create BDD test suite `orchestrator/api/tests/acceptance/us2-concurrent-backtest.feature.test.ts` (User Story 2):
  - **Scenario 1**: 10 concurrent POST /backtest requests → all complete within 5s, all responses correct for their input
  - **Scenario 2**: Different configurations (prices, amounts, sequences) → each response matches its request (no mixing)
  - **Scenario 3**: Slow request + fast request → both complete independently, fast response time unaffected
  - Concurrency test: 50+ simultaneous requests, verify no data mixing, no performance degradation > 20%
  - File: ~300 lines

- [ ] T045 Create BDD test suite `orchestrator/api/tests/acceptance/us3-error-messages.feature.test.ts` (User Story 3):
  - **Scenario 1**: Missing field → HTTP 400 lists missing field and expected format
  - **Scenario 2**: Float precision → HTTP 400 explains decimal precision requirement
  - **Scenario 3**: Core Engine crash → HTTP 500 with "execution failed" message, marked retriable
  - **Scenario 4**: Out-of-bounds value → HTTP 422 with specific boundary message
  - Test all 13 error codes (see ERROR_CODES in errors.ts)
  - Verify error response structure (error.code, error.http_status, error.message, error.field)
  - File: ~400 lines

- [ ] T046 Create BDD test suite `orchestrator/api/tests/acceptance/us4-query-results.feature.test.ts` (User Story 4):
  - **Scenario 1**: GET /backtest/:request_id → HTTP 200 with identical result from original POST
  - **Scenario 2**: Query date range → correct subset of results with pagination
  - Test retrieval after 1 hour, 1 day, 6 days → all within 7-day TTL return successfully
  - Test retrieval after 8 days → HTTP 404 (expired)
  - File: ~200 lines

- [ ] T047 Create BDD test suite `orchestrator/api/tests/acceptance/us5-health-check.feature.test.ts` (User Story 5):
  - **Scenario 1**: Core Engine ready → /health returns status: healthy, binary_availability: ready
  - **Scenario 2**: Core Engine unavailable → /health returns status: degraded or unhealthy, explains reason
  - Test health change as queue depth increases
  - Test health recovery after errors clear
  - File: ~150 lines

### Load & Performance Tests

- [ ] T048 Create load test `orchestrator/api/tests/performance/load-test.ts`:
  - Scenario: 100 concurrent backtest requests over 60 seconds
  - Measure: average response time, p95, p99 latencies, error rate
  - Verify: avg response time < 5s, p99 < 15s, error rate < 1%
  - Verify: queue depth never exceeds maxWorkers × 2
  - File: ~200 lines

- [ ] T049 Create chaos test `orchestrator/api/tests/chaos/failure-scenarios.ts`:
  - Scenario: Core Engine binary crashes mid-execution → API returns HTTP 500, other requests continue
  - Scenario: Disk full during result persistence → HTTP 500, backtest remains queued for retry
  - Scenario: Worker thread crashes → ProcessManager respawns, queue continues
  - File: ~200 lines

### Documentation & Developer Experience

- [ ] T050 [P] Create API documentation `orchestrator/api/API.md` with:
  - Endpoint reference: POST /backtest, GET /backtest/:id, GET /backtest, GET /health
  - Request/response examples for each endpoint
  - Error codes and HTTP status mapping
  - Example: successful backtest POST + response
  - Example: error responses for each major error category
  - File: ~300 lines

- [ ] T051 [P] Create deployment guide `orchestrator/api/DEPLOYMENT.md`:
  - Environment variables (CORE_ENGINE_BINARY_PATH, PORT, MAX_WORKER_THREADS, etc.)
  - Dockerfile + docker-compose for local/staging
  - Health check configuration (probe endpoint /health)
  - Graceful shutdown procedure
  - Monitoring: log aggregation, metrics collection points
  - File: ~150 lines

- [ ] T052 [P] Create troubleshooting guide `orchestrator/api/TROUBLESHOOTING.md`:
  - Common errors and solutions
  - Debug mode (verbose logging via LOG_LEVEL=debug)
  - Performance tuning (MAX_WORKER_THREADS, timeout settings)
  - File: ~120 lines

### Final Validation

- [ ] T053 Run full test suite: `npm run test:all`
  - ✅ All unit tests pass (Phase 1-3): ~100+ tests
  - ✅ All integration tests pass (Phase 2-4): ~50+ tests
  - ✅ All BDD acceptance tests pass (Phase 5, US1-US5): ~15 scenarios
  - ✅ Load test passes: avg response time < 5s
  - ✅ All 13 error codes tested and mapped correctly
  - ✅ Code coverage > 85% for core services (BacktestService, ResultAggregator, ErrorMapper)

- [ ] T054 Create CHANGELOG.md documenting:
  - Feature 004 API Layer implementation
  - All endpoints and capabilities
  - User story completion status (all P1 complete, P2 complete)
  - Breaking changes: none (new feature)
  - Migration guide: N/A
  - File: ~100 lines

- [ ] T055 Verify Green Light Protocol compliance:
  - All tests pass
  - All linting passes (`npm run lint`)
  - All TypeScript strict mode checks pass
  - No console.log in production code (only pino logger)
  - PR review checklist completed
  - Ready for merge to main

---

## Implementation Strategy: MVP → Complete

### MVP Scope (User Stories P1)

After Phase 3 completion, **all P1 user stories are complete and testable**:

1. **US1** (Submit Backtest & Receive Results): ✅ COMPLETE
2. **US2** (Handle Concurrent Requests): ✅ COMPLETE (worker pool in Phase 2)
3. **US3** (Clear Error Messages): ✅ COMPLETE (error mapping in Phase 4)

**Minimum viable deployment**: Phases 1-4 (Tasks T001-T042)

### Post-MVP (User Stories P2, Nice-to-have)

Tasks T044-T047 (US4, US5) add production operations capabilities:

4. **US4** (Query Historical Results): ✅ COMPLETE (result persistence in Phase 4)
5. **US5** (Monitor API Health): ✅ COMPLETE (health endpoint in Phase 4)

**Production deployment**: Phases 1-5 (Tasks T001-T055)

---

## Parallel Task Execution

### Independent Task Groups (can run in parallel)

**Group A (Phase 1 Setup & Testing)**:
- T002, T003, T004, T005, T006 (project scaffolding)
- T007, T008, T011, T012 (test files + config)

**Group B (Phase 2 Subprocess)**:
- T015, T017, T018 (error structs, parsers, mappers)
- T013, T014, T016, T019, T020 (tests + services)

**Group C (Phase 3 Aggregation)**:
- T021, T022, T023 (aggregators, formatters, parsing)
- T024 (integration tests)

**Group D (Phase 4 HTTP)**:
- T025, T026, T027, T028 (middleware)
- T029, T030, T031 (storage, cleanup)
- T032, T033, T034, T035, T036, T037, T038, T039 (endpoints)

---

## Definition of Done

A task is **COMPLETE** when:

1. ✅ **Code Written**: Implementation matches task description exactly
2. ✅ **Tests Written First (TDD)**: Test file exists and all tests PASS
3. ✅ **Type Safety**: TypeScript code compiles with strict mode (no `any` types without justification)
4. ✅ **Linting Passes**: ESLint passes with zero warnings
5. ✅ **Decimal Precision**: All monetary values use Decimal library (no floats)
6. ✅ **Error Handling**: Functions throw specific, typed errors (not generic Error)
7. ✅ **Documentation**: Code includes JSDoc comments for public functions/types
8. ✅ **File Paths**: Follows `orchestrator/api/src/{types,services,routes,utils,middleware}` structure exactly
9. ✅ **Green Light Protocol**: No commits while tests fail
10. ✅ **User Story Validation**: Code validates against corresponding spec.md requirements

---

## Testing Strategy: TDD at Every Phase

### Test Execution Commands

```bash
# Run all tests (exit 0 only if 100% pass)
npm run test:all

# Run tests by phase
npm run test -- src/utils/DecimalValidator.test.ts          # Phase 1
npm run test -- src/services/*.test.ts                       # Phase 2-3
npm run test -- src/routes/*.test.ts                         # Phase 4
npm run test -- tests/acceptance/*.test.ts                   # Phase 5

# Run with coverage
npm run test:coverage

# Run load test (performance)
npm run test:load

# Run chaos test (failure scenarios)
npm run test:chaos
```

### Coverage Requirements

- **DecimalValidator**: 100% coverage (foundation for all validation)
- **ResultAggregator**: 100% coverage (core P&L calculation logic)
- **ErrorMapper**: 100% coverage (all 13 error codes tested)
- **BacktestService**: 95% coverage (subprocess orchestration)
- **HTTP Routes**: 90% coverage (endpoint handlers)
- **Overall**: ≥85% code coverage for src/ directory

---

## Success Criteria

After completing all 55 tasks:

✅ **Feature 004 - API Layer is COMPLETE and PRODUCTION-READY**

- All 5 user stories implemented (P1 and P2)
- All 20 functional requirements satisfied
- All 10 success criteria met (from spec.md)
- 100% of BDD acceptance scenarios passing
- 0 bugs in critical path (decimal precision, error handling, concurrency)
- <3 seconds median response time for typical backtests
- 99.5% uptime in load tests
- Ready for production deployment with confidence 🚀
