# Implementation Plan: API Layer - HTTP Service

**Branch**: `004-api-layer` | **Date**: 2026-03-08 | **Spec**: [spec.md](spec.md)  
**Status**: Phase 0 & 1 Planning Complete

## Summary

The API Layer is an Express/TypeScript HTTP service that bridges user backtest requests to the Go Core Engine binary. It must:

1. **Receive** backtest configurations via POST `/backtest` with decimal-precision validation
2. **Execute** Core Engine binary as subprocess with config streamed to stdin + ndjson parsing from stdout
3. **Manage** concurrent requests with auto-scaled worker pool (based on CPU core count)
4. **Parse** Event Bus output into typed TypeScript objects (PositionOpened, OrderFilled, etc.)
5. **Persist** completed results for 7-day retrieval with idempotency support
6. **Map** errors to clear HTTP status codes (400/422/500/504) with actionable messages
7. **Report** health and queue metrics via `/health` endpoint

**Key Innovation**: A non-blocking subprocess manager using Node.js `child_process` with JSON-stream parsing, resource limits, and 30-second execution timeout per backtest.

---

## Technical Context

**Language/Version**: TypeScript 5.1+, Node.js 18+ (LTS or later)  
**Runtime**: Express.js 4.18+, for clean routing and middleware pattern  
**Primary Dependencies**: 
- `express` - HTTP framework
- `decimal.js` - Fixed-point decimal arithmetic for validation
- `stream` - Node.js native streams for non-blocking I/O
- `ndjson` - Parse newline-delimited JSON Event Bus output
- `pino` - High-performance structured logging
- `node-cron` or `node-schedule` - Result cleanup scheduler (7-day retention)

**Storage**: File-based (local filesystem) with JSON result files or SQLite database for 7-day result persistence and query indexing  
**Testing**: 
- `jest` for unit tests
- `jest` + mocks for integration tests (mock Go binary subprocess)
- `supertest` for HTTP endpoint testing
- **Must include**: BDD acceptance scenarios from spec user stories, error path coverage, concurrency chaos tests

**Target Platform**: Linux server (x86_64), Docker-containerizable  
**Project Type**: Stateless HTTP web service with subprocess orchestration  
**Performance Goals**: 
- Response time < 5 seconds for typical backtests (100-1000 candles, 3-10 DCA entries)
- 10+ concurrent requests without >20% latency degradation
- Sub-100ms validation failure responses
- 99.5% uptime

**Constraints**:
- 30-second timeout per Core Engine subprocess execution
- Auto-scaled concurrency (limited to CPU core count)
- Process resource limits: prevent memory exhaustion from runaway Core Engine
- 7-day result retention with automatic cleanup
- All decimal values in configs and responses with 8 decimal places (prices) or 2 (currency)

**Scale/Scope**: 
- MVP: 10+ concurrent backtests
- ~3000 LOC (core API, subprocess manager, error mapper, result store)
- Interfaces: HTTP REST only (no GraphQL, no WebSocket for MVP)

## Constitution Check

**GATE STATUS**: ✅ PASS - All constitutional requirements satisfied

### Principle 1: Purpose & Canonical Truth (NON-NEGOTIABLE) ✅

**Gate**: No live trading; simulation-only. Canonical Python bot parity required.

**Compliance**:
- API is a stateless request handler; it DOES NOT execute trades live, only backtests them
- API streams configurations to Core Engine binary (Go) and parses deterministic Event Bus results
- Response accuracy bound to Core Engine; zero transformation loss required (BDD test: `spec.md` canonical test data table)
- Reference: `core-engine/application/orchestrator/integration_test.go` verifies Event Bus parsing parity

**Gate Result**: ✅ PASS

---

### Principle 2: Technical Architecture & Tech Stack ✅

**Gate**: Core engine in compiled language (Go ✓). Orchestration/API in TypeScript ✓. No forbidden tech stack.

**Compliance**:
- Core engine: Already in Go, not in scope for this feature
- API layer: TypeScript/Node.js (officially sanctioned for orchestration per constitution)
- Result persistence: Local filesystem + SQLite (no centralized DB in MVP scope)
- Async workload distribution: Worker pool pattern (will scale to Redis/RabbitMQ in future feature)
- Architecture enforces: API layer has ZERO knowledge of domain logic; all trading rules remain in Go Core Engine

**Gate Result**: ✅ PASS

---

### Principle 3: Mathematical & Execution Strictness (NON-NEGOTIABLE) ✅

**Gate**: Fixed-point decimal arithmetic mandatory. No floats. Gap-Down rule respected.

**Compliance**:
- **Decimal Validation (FR-003)**: API rejects IEEE 754 floats in backtest configuration; accepts only stringified decimals (e.g., `"100.50"`) via `decimal.js`
- **Precision Preservation**: All monetary values in JSON responses serialized with 8 decimal places (matching Go `Decimal` backend)
- **Edge Case Handling**: BDD test (User Story 1, Scenario 3) verifies multi-fill sequences maintain exact price and quantity precision
- **Canonical Test Data**: Three proof cases bind API response to Core Engine:
  - Gap-down with 3 fills: API must parse Event Bus correctly
  - Liquidation scenario: API must reflect position state without delta loss
  - Single entry (baseline): API must serialize baseline result exactly
- **Gap-Down Rule**: Gap-down fills are handled by Core Engine; API only parses events (no business logic in API)

**BDD Tests**:
- `spec.md` User Story 1, Scenario 2: "Gap-down event is parsed and reflected in response"
- `spec.md` User Story 3, Scenario 2: "Float precision rejected with 400 + message"

**Gate Result**: ✅ PASS (Precision gates delegated to Core Engine; API is a passive transformer)

---

### Principle 4: Software Engineering & Domain Model ✅

**Gate**: Clean Architecture. Core domain outside API. Ports-and-Adapters pattern.

**Compliance**:
- **Architecture Separation**:
  - API Layer (orchestrator/api/): Request handlers, subprocess management, error mapping, result persistence
  - Core Domain (core-engine/): Stays untouched; all business logic remains in Go
  - Adapter Boundary: API is an adapter that calls Go binary; no domain rules in API code
- **No Domain Logic in API**: API does NOT know about DCA, gap-down rules, margin calculations, etc.
- **Event-Driven**: API consumes Core Engine's Event Bus (stream of immutable events); derives no logic from event order
- **Idempotency**: Optional for MVP; when added, will use Event Store pattern (replaying events for deduplication)

**Gate Result**: ✅ PASS

---

### Principle 5: Testing, Observability & Performance ✅

**Gate**: Green Light Protocol. BDD acceptance tests. TDD for numeric logic.

**Compliance**:

#### Green Light Protocol
- NO new commits to main unless ALL tests pass
- All PR merges require per `npm run test` passing
- Integration tests verify Core Engine subprocess behavior (mocked binary for CI)

#### BDD Acceptance Tests (from spec.md)
1. **User Story 1** (Submit & Receive): 3 scenarios
2. **User Story 2** (Concurrency): 3 scenarios
3. **User Story 3** (Error Handling): 4 scenarios
4. **User Story 4** (Result Retrieval): 2 scenarios
5. **User Story 5** (Health): 2 scenarios

**TDD - Numeric Precision**: DecimalValidator has 100% test coverage for edge cases

**Gate Result**: ✅ PASS

## Project Structure

### Documentation (this feature)

```text
specs/004-api-layer/
├── spec.md                    # Feature specification (COMPLETE)
├── plan.md                    # This file - implementation approach
├── research.md                # Phase 0 output (DEFERRED: no unknowns remain)
├── data-model.md              # Phase 1 output (IN PROGRESS)
├── quickstart.md              # Phase 1 output (IN PROGRESS)
├── contracts/                 # Phase 1 TypeScript interfaces
│   ├── backtest-request.ts
│   ├── backtest-result.ts
│   ├── trade-event.ts
│   ├── error-mapping.ts
│   └── health-metrics.ts
└── checklists/requirements.md # Quality gate (PASSING)
```

### Source Code (Polyglot Architecture)

```text
orchestrator/api/                              # NEW: TypeScript/Node.js
├── src/
│   ├── types/
│   │   ├── index.ts                          # Exported TypeScript interfaces
│   │   ├── configuration.ts                  # BacktestRequest schema
│   │   ├── result.ts                         # BacktestResult, TradeEvent types
│   │   └── errors.ts                         # ErrorMapping, internal error types
│   ├── services/
│   │   ├── BacktestService.ts                # Subprocess executor (spawn binary, stream handling)
│   │   ├── ResultStore.ts                    # Persistence layer (file/SQLite adapter)
│   │   ├── ErrorMapper.ts                    # Binary stderr → HTTP status mapping
│   │   ├── HealthMonitor.ts                  # Health check & metrics aggregation
│   │   └── CacheService.ts                   # Result cache & idempotency (MVP optional)
│   ├── routes/
│   │   ├── backtest.routes.ts                # POST /backtest, GET /backtest/:id
│   │   ├── health.routes.ts                  # GET /health
│   │   └── middleware/
│   │       ├── validation.middleware.ts      # Body validation, decimal check
│   │       ├── error-handler.middleware.ts   # Global error handler
│   │       └── request-logger.middleware.ts  # Request/response logging
│   ├── utils/
│   │   ├── DecimalValidator.ts               # Fixed-point decimal validation (decimal.js)
│   │   ├── EventBusParser.ts                 # ndjson → TypeScript event objects
│   │   └── ProcessManager.ts                 # Worker pool, concurrent subprocess management
│   ├── config/
│   │   ├── env.ts                            # Environment config (CORE_BINARY_PATH, etc.)
│   │   └── constants.ts                      # Timeouts, concurrency limits, decimals
│   └── app.ts                                # Express app setup, middleware, routes
├── tests/
│   ├── integration/
│   │   ├── backtest.integration.test.ts      # Full flow with mocked binary
│   │   ├── concurrent-load.test.ts           # User Story 2 concurrency tests
│   │   ├── error-handling.test.ts            # User Story 3 error scenarios
│   │   ├── result-retrieval.test.ts          # User Story 4 persistence tests
│   │   └── fixtures/
│   │       ├── mock-binary-stdout.ndjson     # Sample Core Engine output
│   │       └── test-configs.ts               # Test configuration data
│   ├── unit/
│   │   ├── services/
│   │   │   ├── ErrorMapper.test.ts
│   │   │   ├── ResultStore.test.ts
│   │   │   ├── DecimalValidator.test.ts
│   │   │   └── EventBusParser.test.ts
│   │   └── utils/
│   │       ├── ProcessManager.test.ts        # Worker pool tests
│   │       └── ProcessManager.chaos.test.ts  # Resource limit tests
│   └── acceptance/
│       ├── user-story-1.acceptance.test.ts   # BDD: Submit & Receive (Given/When/Then)
│       ├── user-story-2.acceptance.test.ts   # BDD: Concurrency
│       ├── user-story-3.acceptance.test.ts   # BDD: Error Handling
│       ├── user-story-4.acceptance.test.ts   # BDD: Result Retrieval
│       └── user-story-5.acceptance.test.ts   # BDD: Health Monitoring
├── package.json
├── tsconfig.json
├── jest.config.js
├── .env.example
└── README.md                                 # API documentation, examples

core-engine/                                  # EXISTING (no changes)
├── domain/                                   # Untouched
├── application/orchestrator/
│   └── [existing binary + integration tests]
└── [infrastructure/tests - no changes]
```

**Feature Placement Contract**: ✅ API Layer is in `orchestrator/api/` (NOT in `core-engine/`). API is pure HTTP adapter; zero domain logic.

---

## Phase 0: Research (DEFERRED - No Unknowns)

**Status**: ✅ All clarifications resolved in specification update.

**Resolved Clarifications**:
1. ✅ FR-009: Execution timeout → **30 seconds**
2. ✅ FR-015: Result retention → **7 days**
3. ✅ FR-010: Concurrency limit → **Auto-detect by CPU cores** (os.cpus().length)

**Research Output**: [research.md](research.md) - DEFERRED (only needed if unknowns exist)

---

## Phase 1: Design & Contracts (NOW - Generate contracts/)

### 1.1 Data Model: [data-model.md](data-model.md)

Key entities with relationships and validation rules to be documented.

### 1.2 Interface Contracts: [contracts/](contracts/)

TypeScript interfaces defining API contract (see next section for details).

### 1.3 Subprocess Execution Pattern (CRITICAL)

**Non-blocking JSON-stream pipeline**:

```
API Request (HTTP)
    ↓
[BacktestService]
    ├→ Validate config (decimal.js)
    ├→ Serialize to JSON
    ├→ Spawn subprocess: child_process.spawn('core-engine-binary')
    ├→ Write JSON to stdin (stream)
    ├→ Read stdout (ndjson stream)
    │  └→ [EventBusParser] - Split by newline, JSON.parse each event
    ├→ Collect events in array while subprocess runs
    ├→ Enforce 30-second timeout (SIGTERM if exceeded)
    └→ On subprocess exit:
        ├→ Aggregate events → BacktestResult
        ├→ Persist to ResultStore
        └→ HTTP 200 + JSON response
        
   OR (on error):
        ├→ Capture stderr
        ├→ [ErrorMapper] - stderr → HTTP status code + message
        └→ HTTP 4xx/5xx + error JSON
```

**Implementation Highlights**:

1. **Concurrency (FR-010)**: `os.cpus().length` worker pool - no request blocking
2. **Resource Limits (FR-011)**: SIGTERM at 30s timeout; memory caps per process
3. **Error Mapping (FR-012)**: stderr patterns → HTTP status codes
4. **Event Parsing (FR-005)**: ndjson accumulation maintaining event order
5. **Persistence (FR-014/15)**: 7-day SQLite + file storage with cleanup

### 1.4 Quickstart: [quickstart.md](quickstart.md)

Hands-on guide for development and testing.

---

## Complexity Tracking

| Complexity | Justification | Simpler Alternative & Why Rejected |
|------------|---------------|----------------------------------|
| Subprocess management with ndjson streaming | Core requirement to handle concurrent backtest execution with real-time event parsing | File-based IPC (slower, more brittle) |
| Worker pool pattern | FR-010 requires concurrent requests without blocking | Queuing to single worker (cannot scale) |
| 7-day result persistence | FR-015; enables retrieval + audit trail | No persistence (loses user data, poor UX) |
| Decimal.js validation | FR-003 + Constitution gate; no float precision loss | Native JSON numbers (precision loss, fails constitution) |
| Integration tests with mocked binary | FR-001 canonical test data proof | No integration tests (cannot verify Event Bus parsing works) |
