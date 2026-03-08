# Feature Specification: API Layer - HTTP Service

**Feature Branch**: `004-api-layer`  
**Created**: 2026-03-08  
**Status**: Draft  
**Input**: User description: "TypeScript/Node.js HTTP API service that accepts backtest configurations, executes the Go Core Engine binary, and returns parsed Event Bus results as JSON with concurrent request handling and error mapping"

## Constitution Gates (MANDATORY)

The API Layer must conform to:

- **Green Light Protocol**: All routes and core functionality must have unit and integration tests that verify correct request handling, response formatting, and error propagation. Tests MUST pass before merge. Integration tests MUST verify actual Core Engine binary execution with real Event Bus result parsing.
- **Fixed-point Arithmetic**: All monetary values in backtest configurations (prices, amounts, percentages) must preserve decimal precision. Configuration validation must reject float representations; only stringified decimals or explicit precision formats are accepted.
- **BDD Acceptance Criteria**: Each user story is defined with Given/When/Then scenarios. API behavior must be verifiable through these acceptance tests covering normal operations, error conditions, and concurrent load scenarios.

---

## User Scenarios & Testing

### User Story 1 - Submit Backtest Configuration and Receive Results (Priority: P1)

A backtesting trader submits a DCA strategy configuration via HTTP POST with entry price, amounts, sequences, and risk parameters. The API accepts the configuration, validates it against the Core Engine schema, executes the Go binary with the configuration, parses the Event Bus output into structured JSON, and returns the results with trade execution timeline, profit/loss, and state transitions.

**Why this priority**: This is the MVP core functionality. Without this, the API provides no value. It's the fundamental user workflow.

**Independent Test**: Can be fully tested by submitting a valid configuration and verifying: (1) correct HTTP response, (2) response matches Core Engine computation results, (3) Event Bus events are correctly parsed into user-readable fields. Delivers complete backtest analysis in a single request.

**Acceptance Scenarios**:

1. **Given** a valid backtest configuration (entry price, amounts, sequences), **When** POST to `/backtest` with `Content-Type: application/json`, **Then** HTTP 200 returned with JSON body containing all executed trades, final position state, and profit/loss calculations
2. **Given** a backtest configuration with gap-down event in price history, **When** POST to `/backtest`, **Then** Event Bus gap-down event is parsed and reflected in response showing position state after gap down
3. **Given** a backtest with multiple order fills across different price levels, **When** POST to `/backtest`, **Then** response includes ordered array of fill events with timestamps, prices, quantities, and updated position state after each fill

---

### User Story 2 - Handle Concurrent Backtest Requests (Priority: P1)

Multiple backtesting traders submit backtest requests simultaneously. The API manages concurrent execution of the Core Engine binary for each request without blocking other requests, maintains separate result streams for each execution, and returns correct results for each user without cross-contamination.

**Why this priority**: Production requirement. The API must handle realistic load without degrading per-user experience or losing data accuracy.

**Independent Test**: Can be tested by submitting 10+ backtest requests concurrently with different configurations and verifying: (1) all requests complete, (2) each response matches its corresponding input configuration, (3) no result mixing between requests, (4) response times remain consistent (no long tail latency). Demonstrates production readiness for multi-user scenarios.

**Acceptance Scenarios**:

1. **Given** 10 concurrent POST requests to `/backtest` with different configurations, **When** all requests are submitted within 1 second, **Then** all responses complete successfully with correct results for each configuration within reasonable time (no request blocking)
2. **Given** requests A and B executing simultaneously with different entry prices, **When** both complete, **Then** response A contains results for A's price, response B contains results for B's price (no mixing)
3. **Given** one slow backtest request and one fast backtest request, **When** both are submitted, **Then** fast request completes independently of slow request's timing

---

### User Story 3 - Clear Error Messages for Configuration and Execution Failures (Priority: P1)

When a backtester submits an invalid configuration (missing fields, precision loss, out-of-bounds values) or when the Core Engine binary fails during execution, the API returns an HTTP 4xx or 5xx error with a clear, actionable error message mapping Core Engine errors to user-friendly descriptions.

**Why this priority**: Required for usability. Vague errors frustrate users and create support burden. Clear error mapping is essential for API adoption.

**Independent Test**: Can be tested by submitting malformed configurations and monitoring failure scenarios, verifying: (1) each error type returns appropriate HTTP status code, (2) error response includes actionable message, (3) Core Engine errors are mapped to meaningful user guidance, (4) user can identify what field caused the error. Demonstrates supportability and user-friendliness.

**Acceptance Scenarios**:

1. **Given** a POST to `/backtest` with missing required field (e.g., `entry_price`), **When** request is submitted, **Then** HTTP 400 Bad Request returned with error message listing missing field and expected format
2. **Given** a backtest configuration with float precision (e.g., `"entry_price": 1.1`), **When** submitted, **Then** HTTP 400 returned with message explaining decimal precision requirement
3. **Given** Core Engine binary crashes during execution, **When** crash occurs, **Then** HTTP 500 returned with message indicating "backtest execution failed" and request is marked retriable (idempotent key support exists)
4. **Given** configured price sequence goes out of valid bounds (e.g., negative price), **When** validation occurs, **Then** HTTP 422 Unprocessable Entity returned with specific boundary violation message

---

### User Story 4 - Query Historical Backtest Results (Priority: P2)

A backtester wants to retrieve a previously submitted backtest result without re-running it. The API stores completed backtest results with timestamps and provides a GET endpoint to retrieve results by request ID or query by date range with filtering.

**Why this priority**: Improves user experience for iterative analysis. Reduces duplicate computations. Enables audit trails. Valuable but not strictly necessary for MVP.

**Independent Test**: Can be tested by submitting a backtest, storing its ID, waiting, then retrieving it via GET endpoint and verifying: (1) retrieved result matches original response, (2) timestamp is preserved, (3) filtering by date range returns correct subset. Demonstrates result persistence capability.

**Acceptance Scenarios**:

1. **Given** a completed backtest with request ID `abc123`, **When** GET `/backtest/abc123` is called later, **Then** HTTP 200 returns same result as original POST response with identical calculations
2. **Given** multiple backtests completed over 24 hours, **When** GET `/backtest?from=2026-03-07&to=2026-03-08` is called, **Then** HTTP 200 returns array of results within specified time range

---

### User Story 5 - Monitor API Health and Execution Status (Priority: P2)

Operations teams monitor API availability, Core Engine binary connectivity, and background task queue status. The API exposes a `/health` endpoint returning operational status and metrics about backtest execution throughput.

**Why this priority**: Important for production operations. Enables proactive problem detection. Not essential for initial launch but required before production deployment.

**Independent Test**: Can be tested by calling `/health` endpoint and verifying: (1) returns HTTP 200, (2) indicates Core Engine binary availability, (3) reports queue depth and throughput metrics, (4) reflects actual state (if binary is down, health reports degraded status).

**Acceptance Scenarios**:

1. **Given** API is running with Core Engine binary available, **When** GET `/health` is called, **Then** HTTP 200 returned with status `"healthy"` and binary availability `"ready"`
2. **Given** Core Engine binary is not accessible, **When** GET `/health` is called, **Then** HTTP 200 returned with status `"degraded"` and message indicating binary unavailable

---

### Canonical Test Data & Mathematical Proofs

| Input Configuration | Input Data | Expected Response Content | Reference |
|---------------------|-----------|--------------------------|-----------|
| Entry=100, DCA amounts=[10,10,10] | Gap-down to 90, then fills at prices [100,95,90] | Event Bus events parsed: 3 fills at correct prices, position quantities accurate, profit calculation matches Core Engine computation | `position/canonical_integration_test.go` covering gap-down scenario |
| Simple single entry, price steady | Entry=100, no price movement | Single event (open position), no fills, P&L = entry fee only | `orchestrator/integration_test.go` baseline case |
| Liquidation scenario | Entry=100, margin ratio=0.5, price drops 55% to 45 | Event Bus includes liquidation event, position state marked CLOSED, P&L includes liquidation fee | `position/canonical_integration_test.go` liquidation coverage |

**Rationale**: API responses must exactly match Core Engine computations. These test cases bind the API contract to verified Go implementation behavior. Response parsing must preserve all precision and event ordering.

### Edge Cases

- What happens when backtest configuration references a CSV file that doesn't exist on the Core Engine host?
- How does the API handle if the Core Engine binary is updated mid-request? (e.g., binary path changes, new version has different output format)
- What if a concurrent request causes Core Engine to exceed memory limits?
- How are orphaned subprocesses cleaned up if the API crashes mid-backtest?
- What happens when the Event Bus output is truncated or malformed?

---

## Requirements

### Functional Requirements

- **FR-001**: API MUST expose HTTP endpoint `POST /backtest` accepting JSON request body with backtest configuration fields (entry_price, amounts, sequences, leverage, margin_ratio, etc.)
- **FR-002**: API MUST validate backtest configuration against Core Engine schema before execution; reject requests with missing required fields, invalid types, or out-of-bounds values with HTTP 400/422 errors
- **FR-003**: API MUST accept only decimal-formatted monetary values (strings like `"100.00"` or `"0.5"`) for prices and amounts, rejecting IEEE 754 floats to prevent precision loss
- **FR-004**: API MUST invoke Core Engine binary as subprocess with configuration serialized as JSON to stdin or CLI flags, capturing stdout for Event Bus result parsing
- **FR-005**: API MUST parse Core Engine Event Bus output (structured events: PositionOpened, OrderFilled, PositionClosed, LiquidationEvent, GapDownEvent) into typed JSON response objects
- **FR-006**: API MUST track all parsed events in execution order, preserving timestamps and calculated values (prices, quantities, position state deltas)
- **FR-007**: API MUST calculate final position state, P&L, trade count, and execution timeline from parsed Event Bus sequence
- **FR-008**: API MUST serialize backtest results as JSON with fields: `request_id`, `status`, `events[]`, `final_position`, `pnl_summary`, `execution_time_ms`, `timestamp`
- **FR-009**: API MUST return HTTP 200 with complete results for successful backtest execution within 30 seconds
- **FR-010**: API MUST handle concurrent POST requests to `/backtest` independently using worker pool or queue pattern, executing simultaneous Core Engine processes auto-detected based on available CPU cores (e.g., `os.cpus().length` in Node.js)
- **FR-011**: API MUST prevent memory exhaustion by implementing process resource limits (max heap, timeout) for Core Engine subprocesses
- **FR-012**: API MUST map Core Engine error codes and stderr messages to standardized HTTP error responses with user-friendly descriptions (e.g., "Invalid configuration" → 400, "Backtest timeout" → 504)
- **FR-013**: API MUST assign unique `request_id` to each backtest request for traceability and retrieval
- **FR-014**: API MUST provide `GET /backtest/{request_id}` endpoint to retrieve previously completed backtest results from storage
- **FR-015**: API MUST persist completed backtest results with timestamp for 7 days
- **FR-016**: API MUST provide `GET /health` endpoint returning JSON with status (healthy/degraded/unhealthy), Core Engine binary availability, and backtest queue metrics
- **FR-017**: API MUST log all backtest requests (configuration summary, timing, results) for audit and debugging purposes
- **FR-018**: API MUST handle graceful shutdown: complete in-flight backtests, reject new requests with HTTP 503, terminate Core Engine subprocesses
- **FR-019**: API MUST support idempotent backtest requests using optional `idempotency_key` header; duplicate requests with same key return cached results instead of re-executing
- **FR-020**: API response body MUST serialize all decimal values with consistent precision (e.g., 8 decimal places for prices, 2 for currency)

### Key Entities

- **BacktestRequest**: Encapsulates user-submitted configuration (entry_price, amounts, sequences, leverage, margin_ratio, market_data_csv_path) with unique request_id and submission timestamp
- **BacktestResult**: Contains all parsed Event Bus events in sequence, final position state snapshot, P&L summary, execution duration, and completion status
- **TradeEvent**: Represents a single Event Bus event (PositionOpened, OrderFilled, Liquidation, etc.) with timestamp, event type, and type-specific fields (price, quantity, reason, etc.)
- **PositionState**: Snapshot of position attributes (average_cost, quantity, leverage_level, status, last_update_time)
- **ErrorMapping**: Standardized error structure with HTTP status code, error code, user message, and technical details for debugging
- **BacktestHealthMetrics**: Real-time API metrics (queue_depth, backtests_completed_today, average_execution_time, binary_status)

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: API responds to valid backtest requests with complete results in under 5 seconds for typical configurations (100-1000 candles, 3-10 DCA entries)
- **SC-002**: API handles 10+ concurrent backtest requests without response time degradation exceeding 20% vs. single request baseline
- **SC-003**: 100% of invalid configuration requests receive HTTP 400-422 with actionable error message identifying the specific field/constraint violation
- **SC-004**: 100% of Core Engine errors are caught and mapped to appropriate HTTP status codes (500 for crashes, 504 for timeouts, 422 for invalid data)
- **SC-005**: API achieves 99.5% uptime in production (excluding planned maintenance), measured over 30-day period
- **SC-006**: Backtest result accuracy is 100% match to Core Engine Event Bus output (zero information loss or transformation errors in event parsing)
- **SC-007**: All backtest requests are uniquely identifiable and retrievable by request_id for audit purposes; no data loss of completed backtests during retention period
- **SC-008**: Concurrent Core Engine subprocesses do not exhaust system memory; test with 20 simultaneous heavy backtests (10K+ candles each)
- **SC-009**: Error response time for invalid requests is under 100ms (validation failures before Core Engine invocation)
- **SC-010**: Documentation includes API specification (OpenAPI/Swagger), example requests/responses, error code reference, and concurrency model explanation

---

## Assumptions

- Core Engine binary outputs Event Bus results in JSON or line-delimited JSON (ndjson) format, parseable into typed event structs
- Core Engine binary can accept configuration via stdin JSON or command-line arguments (implementation detail to be confirmed)
- Core Engine binary respects timeout signals (SIGTERM) for graceful subprocess termination
- API deployment environment has sufficient disk space for 7-day result retention on typical usage patterns
- Market data CSV files (referenced in configurations) are pre-positioned on Core Engine host filesystem
- Initial launch does not require authentication/authorization (open REST API); security gates added in future sprint if needed
- Idempotency is optional for MVP; can be added in post-launch optimization sprint
- Concurrency auto-detection uses CPU core count; system has adequate memory per Core Engine process to avoid resource exhaustion at calculated concurrency level

---

## Related Artifacts

- **Domain References**: `core-engine/domain/config/` (configuration schema), `core-engine/domain/position/` (position state machine), `core-engine/application/orchestrator/` (Event Bus and binary invocation patterns)
- **Previous Specifications**: `specs/001-core-domain-config/spec.md`, `specs/002-position-state-machine/spec.md`, `specs/003-backtest-orchestrator/spec.md`
