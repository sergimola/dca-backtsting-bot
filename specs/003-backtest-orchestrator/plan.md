# Implementation Plan: Backtest Orchestrator

**Branch**: `003-backtest-orchestrator` | **Date**: March 8, 2026 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-backtest-orchestrator/spec.md`

## Summary

Design and implement an internal Go application service that orchestrates backtests by loading historical OHLCV data, instantiating the Position State Machine, sequentially feeding candles through `ProcessCandle()`, and capturing all emitted events into an in-memory Event Bus. The orchestrator acts as a pure bridge between infrastructure (CSV data files) and core domain (PSM + events) with no business logic. Performance target: <10 seconds for 250,000 candles (1 year of minute-level data) on standard CI hardware. Architecture: high-performance Go CSV parsing + in-memory event logging, native PSM import (no IPC/gRPC), strict separation ensuring PSM domain knows nothing about orchestrator.

## Technical Context

**Language/Version**: Go 1.21+ (matches core-engine/domain/position/go.mod)  
**Primary Dependencies**: `shopspring/decimal` (already used in PSM), `encoding/csv` (stdlib)  
**Storage**: In-memory (Event Bus), CSV file input (high-performance streaming)  
**Testing**: Go native `testing` package, testify/assert for BDD-style assertions  
**Target Platform**: Linux/macOS (CI/CD environment)  
**Project Type**: Internal application service (library/domain-supporting)  
**Performance Goals**: <10 seconds to process 250,000 candles; <100ms per 1,000 candles on average  
**Constraints**: 
  - Memory footprint proportional to event count (thousands of events acceptable)
  - No I/O blocking during candle loop (pre-load CSV into memory or use buffered reader)
  - CPU-bound: optimized CSV parsing, no allocations in hot path
  - Deterministic execution: same data + config → identical event sequence
**Scale/Scope**: Single orchestrator instance per backtest run; supports multi-year datasets (1-3M candles)

## Constitution Check

*GATE: Verified before Phase 1 design. Re-checked after design completion.*

✅ **No Live Trading**: The orchestrator is simulation-only; it never executes trades. It is a backtesting bridge with zero connection to live market data or order execution. Enforced by design: input is historical CSV, output is event log, no broker integration.

✅ **Green Light Protocol**: All acceptance scenarios from [spec.md user stories](spec.md#user-scenarios--testing) are marked with BDD Given/When/Then criteria and will have corresponding Go test cases before any PR merge. No work proceeds until test suite is fully Green.

✅ **Fixed-point Arithmetic**: The orchestrator does NOT perform monetary calculations; it delegates all pricing and quantity logic to the PSM. The PSM already uses `shopspring/decimal` per the constitution. The orchestrator captures events as-is, preserving Decimal precision from PSM. No float conversions.

✅ **Architecture Constraint**: 
  - **Feature Domain**: `core-engine/application/orchestrator/` (or `core-engine/infrastructure/orchestrator/` if treating as adapter-like utility)
  - **Dependency Direction**: Orchestrator → PSM (one-way). PSM has zero knowledge of orchestrator. Enforced by Go import structure.
  - **No Infrastructure Leakage into Domain**: The PSM remains in `core-engine/domain/position/`. Orchestrator is a consumer, not a modifier.
  - **Adapter Pattern**: CSV data loading is an adapter concern (infrastructure); the orchestrator bridges this adapter to the domain via `ProcessCandle()` calls.

✅ **BDD Acceptance Scenarios Validated**: [spec.md](spec.md#user-story-1---run-backtest-with-historical-data-priority-p1) defines 4×P1, 2×P2, 2×P3 scenarios. Phase 1 design will map these to Go test cases with exact Decimal assertions.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (Polyglot Architecture)

<!--
  MANDATORY ARCHITECTURE: This project follows a strict polyglot design with two distinct domains.
  Do NOT deviate from this structure. The core engine (Go/Rust) must remain free of orchestration,
  API, or UI concerns. Adapters go in infrastructure/. Always specify which domain a feature belongs to.
-->

```text
core-engine/             # Go/Rust - Pure Domain, Fixed-Point Math, State Machine
├── domain/              # Core trading logic, state machines, event schemas
├── infrastructure/      # Isolated Adapters (ClickHouse, Broker, message queues)
└── tests/               # Unit + integration tests proving parity with canonical Python bot

orchestrator/            # TypeScript/Python - API, Workload Distributor
├── api/                 # REST/GraphQL endpoints, request routing
├── jobs/                # Queue publishers, workload distribution
└── ui/                  # Web/CLI interfaces
```

**Feature Placement Contract**: Every feature MUST explicitly state whether it belongs to
`core-engine/` (mathematical, state, domain) or `orchestrator/` (API, jobs, UI). Core-engine
tasks MUST NOT include HTTP, API, or UI logic.

## Phase 0: Research & Clarification

**Output**: [research.md](research.md) ✅ Complete

**Clarifications Resolved**: 
- Performance target (SC-004): 10 seconds for 250K candles confirmed
- Pre-existing knowledge: PSM public API, CSV parsing best practices, Event Bus patterns documented
- Dependencies: shopspring/decimal confirmed available in PSM, stdlib encoding/csv sufficient for CSV parsing

---

## Phase 1: Design & Contracts

**Outputs**: 
- ✅ [data-model.md](data-model.md) — Core entities: Candle, Event, BacktestRun, EventBus
- ✅ [contracts/orchestrator.go](contracts/orchestrator.go) — Public API: New(), RunBacktest(), GetEventBus(), etc.
- ✅ [quickstart.md](quickstart.md) — Usage examples, error handling, testing patterns

**Architecture Decision**: 
- **Feature Domain**: `core-engine/application/orchestrator/` (application/coordination layer)
- **Dependency Chain**: Orchestrator → PSM (domain) → (no dependencies outward from PSM)
- **Import Structure**: Orchestrator imports position package; position has zero knowledge of orchestrator
- **No Infrastructure Leakage**: CSV adapter is internal to orchestrator; PSM domain remains pure

**Design Highlights**:
1. **Candle Struct**: Typed representation with Decimal precision for all prices (no float conversions)
2. **Event Bus**: In-memory append-only log with thread-safe read access; query interface for post-backtest analysis
3. **Streaming CSV Parsing**: High-performance buffered reader with pre-allocation to meet <10s target
4. **Deterministic Execution**: Single-threaded candle loop ensures event order preservation
5. **Error Handling**: Graceful degradation with partial event capture on malformed CSV

**BDD Acceptance Test Mapping** (from [spec.md](spec.md) → contracts/orchestrator.go):
- P1/S1: "Given valid data..." → Test scenario in contracts with assert checks
- P2/S1-2: "Edge cases..." → Empty CSV, single candle test scenarios
- P3/S1: "Large backtest..." → Benchmark test with 250K candles, <10s assertion
- All scenarios explicitly documented in contracts as acceptance test contracts

**Constitution Post-Check** ✅:
- No Live Trading: Confirmed; orchestrator is simulation-only (CSV input, event output)
- Green Light Protocol: All acceptance scenarios need Go test implementations before merge
- Fixed-point Arithmetic: No calculations in orchestrator; Decimal preserved from PSM
- Architecture Constraint: PSM domain independence maintained via import structure
- BDD Criteria: Acceptance scenarios fully specified in contracts/orchestrator.go

---

## Phase 1 Completion Checklist

Before proceeding to Phase 2 (task generation):

- [x] Technical Context filled (Go 1.21+, dependencies clarified)
- [x] Constitution gates verified (no violations; all gates satisfied)
- [x] Data Model defined (Candle, Event, BacktestRun, EventBus)
- [x] Public API contracts documented (orchestrator.go with method signatures)
- [x] Usage quickstart provided (examples, error handling, testing)
- [x] Performance targets explicit (<10s, <40µs per candle)
- [x] Architecture decision documented (core-engine/application/)
- [x] Dependency direction enforced (Orchestrator → PSM only)
- [x] BDD acceptance scenarios mapped to Go tests

---

## Agent Context Update

**Action**: After Phase 1 design, run:
```bash
.specify/scripts/powershell/update-agent-context.ps1 -AgentType copilot
```

This script adds technology decisions (Go, shopspring/decimal, encoding/csv) to agent context for task generation phase.

---

## Complexity Tracking

✅ **No Constitution violations** — All gates satisfied by design
