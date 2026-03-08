# Phase 0: Research & Clarification Resolution

**Date**: March 8, 2026  
**Status**: Complete  

## Clarifications Resolved

### Performance Target (SC-004)

**Question**: What is the acceptable runtime for backtesting a full year of minute-level data (~250K candles)?

**Decision**: 10 seconds (Option A)

**Rationale**: 
- Optimized performance enables interactive backtesting and fast development feedback loops
- Aligns with core-engine constitution goal of "under 60 seconds for multi-year datasets" while adding a tighter constraint for typical use cases
- Achievable via high-performance Go CSV parsing, in-memory event capture, and native PSM import (no IPC/gRPC overhead)
- Standard for infrastructure-heavy workloads on modern CI/CD hardware

**Implications for Implementation**:
- CSV loading must use buffered streaming (avoid loading entire file into memory upfront)
- Candle loop must be allocation-free (pre-allocate event slices, reuse buffers)
- Event Bus must use efficient Go data structures (pre-sized slices/maps, no interface{} boxing in hot path)
- Benchmarks required: <40µs per candle (10s ÷ 250K)
- Profile-driven optimization: pprof analysis before any production release

---

## Pre-Existing Knowledge Applied

### from `core-engine/domain/position/` (existing PSM)

- PSM exposes `ProcessCandle(*Candle) []Event` or `ProcessCandle(*Candle) ([]Event, error)` method
- Events include: OpenPositionEvent, BuyOrderExecutedEvent, TakeProfit hitEvent, LiquidationEvent, etc.
- PSM uses `shopspring/decimal.Decimal` for all price/quantity fields
- PSM is a pure domain object (no I/O); initialized with config (margin, DCA params, entry/exit thresholds)

### CSV Parsing Best Practices (Go)

- Use `encoding/csv.Reader` with pre-allocated buffers (1 MB buffer recommended)
- Parse columns once, cache indices to avoid repeated string lookups
- Type conversion: use `strconv.ParseFloat` or direct Decimal parsing with `decimal.NewFromString()`
- Benchmarks show streaming CSV parsing at ~10-100µs per row on modern hardware

### Event Bus Pattern (Go)

- Append-only, type-safe event slice: `[]Event` or interface-based dispatcher
- Query interface: `GetEventsByTimestamp(start, end time.Time) []Event` or `GetAllEvents() []Event`
- Pre-allocate slice if total event count is known (e.g., expected number passed to constructor)

---

## Next Steps

- **Phase 1 Design**: Define data models (Candle struct, Event types), public API contracts, and quickstart example
- **Phase 1 Contracts**: Document orchestrator package public interface (NewOrchestrator, LoadCSV, RunBacktest, GetEvents)
- **Phase 2 Tasks**: Break design into implementation tasks (CSV loader, Event Bus, orchestrator coordinator, tests)
