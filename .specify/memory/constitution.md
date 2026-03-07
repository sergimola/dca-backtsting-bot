<!--
Sync Impact Report

- Version change: unspecified -> 1.0.0
- Modified principles:
	- PRINCIPLE_1_NAME (placeholder) -> Purpose & Canonical Truth (NON-NEGOTIABLE)
	- PRINCIPLE_2_NAME (placeholder) -> Technical Architecture & Tech Stack
	- PRINCIPLE_3_NAME (placeholder) -> Mathematical & Execution Strictness (NON-NEGOTIABLE)
	- PRINCIPLE_4_NAME (placeholder) -> Software Engineering Principles & DDD
	- PRINCIPLE_5_NAME (placeholder) -> Testing, Observability & Performance
- Added sections: Constraints & Performance Standards; Development Workflow & Quality Gates
- Removed sections: none
- Templates requiring updates:
	- .specify/templates/plan-template.md ✅ updated
	- .specify/templates/spec-template.md ✅ updated
	- .specify/templates/tasks-template.md ✅ updated
- Follow-up TODOs:
	- TODO(RATIFICATION_DATE): Confirm the original ratification date for provenance
	- Verify there are no other templates referencing legacy "Unified" DDD bot (search/replace if found)
-->

# DCA Backtesting Bot Constitution

## Core Principles

### Purpose & Canonical Truth (NON-NEGOTIABLE)
This project is a backtesting and simulation engine for a long-only Dollar-Cost Averaging (DCA)
strategy on cryptocurrency pairs. The system is strictly for simulation and MUST NOT execute live
trades. The legacy procedural Python `src/trading_bot.py` is the canonical source of truth for all
mathematical and execution logic; implementations must reproduce its outcomes exactly or be
considered a critical failure. The abandoned "Unified" DDD bot attempt is explicitly discarded and
MUST NOT influence design or code.

### Technical Architecture & Tech Stack
The system SHALL separate concerns across a polyglot stack: the core execution engine MUST be a
high-performance compiled language (Go or Rust) capable of processing multi-year, millions-of-candle
backtests in under 60 seconds. Orchestration and API layers SHALL be implemented in TypeScript or
Python. OHLCV data MUST be stored in a local time-series database (e.g., ClickHouse or TimescaleDB).
Massive grid-search permutations SHALL be managed by an asynchronous message broker (e.g., Redis or
RabbitMQ) with stateless workers to support fault tolerance and pause/resume semantics.

### Mathematical & Execution Strictness (NON-NEGOTIABLE)
- All monetary and quantitative calculations MUST use strict fixed-point arithmetic equivalent to
	Python's `Decimal` with ROUND_HALF_UP; floating-point arithmetic is forbidden.
- Base currency quantities MUST be truncated (rounded down) to the exchange's allowed decimal step.
- The maintenance margin rate (`mmr`) MUST satisfy 0 ≤ mmr < 1 to avoid division-by-zero in
	liquidation formulas.
- The execution loop MUST evaluate 1-minute candles pessimistically in this order: check candle
	`low` for buy triggers, check `low` for liquidation risk, then check `high` for take-profit
	targets.
- The Gap-Down Rule: if a candle gaps down past multiple limit orders, the system MUST fill those
	orders at their pre-calculated limit prices (no opportunistic price improvements).

### Software Engineering Principles & Domain Model
- Clean Architecture / Ports-and-Adapters: the core Domain and State Machine MUST have zero
	dependencies on infrastructure, I/O, or frameworks.
- Infrastructure adapters (ClickHouse, Redis, API servers) MUST live outside the core domain.
- Domain-Driven Design: adopt a ubiquitous language matching the Universal Data Contract (e.g.,
	`Config`, `Position`, `amount_per_trade`) and implement a fresh domain model built from scratch.
- Event-Driven Domain: model state transitions explicitly with the project event schema (e.g.,
	`TradeOpenedEvent`, `BuyOrderExecutedEvent`) and derive actions exclusively from Event Store
	projections.

### Testing, Observability & Performance
- Green Light Protocol: no new feature development, refactor, or commits are permitted while any
	test in the suite is failing. All tests must be Green before progressing.
- BDD: system behaviors and complex invariants (e.g., Gap-Down Paradox, same-minute re-entry rule)
	MUST be captured as executable Given/When/Then acceptance criteria.
- TDD: core formulas and arithmetic logic MUST be implemented test-first, using expected values from
	the canonical Python bot.
- Integration tests MUST cover all outer-ring adapters (e.g., ClickHouse connectivity, broker
	job-state updates).
- Observability: instrument the stack with OpenTelemetry (OTel). Tracing and metrics MUST be
	non-blocking; the core engine MUST use asynchronous, batched exporters. During large grid searches
	telemetry for minute-by-minute events MUST be heavily sampled or disabled, relying strictly on
	aggregate metrics and `RunFinishedEvent` payloads.

## Constraints & Performance Standards
The core engine target: process multi-year datasets with millions of candles in under 60 seconds on
the supported CI/hardware profile. Design for low-latency, memory-efficient streaming, and zero
precision-loss arithmetic.

## Development Workflow & Quality Gates
- All work MUST follow Red-Green-Refactor and the Green Light Protocol.
- Every behavior-level requirement MUST have a corresponding BDD acceptance test in the feature
	specification. Unit tests for fixed-point math MUST prove zero precision loss against canonical
	Python examples.
- Commits touching the core domain MUST include regression tests that verify parity with the
	canonical Python bot for the changed behavior.

## Governance
Amendments to this constitution require a documented proposal, automated tests demonstrating the
impact, and approval by two maintainers. Versioning follows semantic versioning:
- MAJOR: incompatible governance or principle removals/renaming
- MINOR: added principle or material guidance expansion
- PATCH: wording clarifications or non-semantic refinements

**Version**: 1.0.0 | **Ratified**: 2026-03-07 | **Last Amended**: 2026-03-07
