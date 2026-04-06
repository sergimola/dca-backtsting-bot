# Implementation Plan: Annualized Return (IRR / Money-Weighted Return)

**Branch**: `020-annualized-return` | **Date**: 2026-04-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/020-annualized-return/spec.md`

## Summary

Add an `annualizedReturn` (IRR as % per year) metric to every completed backtest result. The IRR is computed in the TypeScript orchestrator layer using a Newton-Raphson solver (100 iterations, 1e-10 tolerance) with bisection fallback, using Decimal.js for all fixed-point math. Cash flows are extracted from the Go engine's `tradeEvents` array — `DEPOSIT.balance` as capital outflows and the final event's `balance` as the terminal inflow. The value is persisted to `sweep_run_summaries.annualized_return` and surfaced in the single-run UI, optimizer leaderboard UI, and three Grafana dashboards. This is a fully additive change — no breaking API changes and no ClickHouse schema changes.

## Technical Context

**Language/Version**: TypeScript 5.1.3 / Node.js v24.11.0 (orchestrator layer); React 18 (frontend)  
**Primary Dependencies**: Decimal.js ^10.4.3 (fixed-point math), Drizzle ORM ^0.45.1 (schema + migrations), Express ^5.2.1 (API routes), pg ^8.20.0 (PostgreSQL client), @opentelemetry/api ^1.9.1 (tracing, non-blocking batched)  
**Storage**: PostgreSQL — `sweep_run_summaries` table; `annualized_return numeric(10,4)` column added via hand-written Drizzle migration  
**Testing**: Jest + ts-jest (ESM mode); run via `node --experimental-vm-modules jest`; `.js` imports mapped to no-extension; test files co-located as `*.test.ts`  
**Target Platform**: Linux server (Docker Compose); backtesting simulation only — no live trading  
**Project Type**: Web service (orchestrator API) + React SPA (frontend) + JSON dashboards (Grafana)  
**Performance Goals**: IRR solver runs once per engine result (offline computation); target < 5 ms per call — non-blocking concern  
**Constraints**: All monetary arithmetic via Decimal.js — no native `number` for cash flow or discount factor math; solver MUST converge on all 5 canonical test cases to 4 decimal places; additive-only (no breaking API changes, no ClickHouse DDL)  
**Scale/Scope**: Single IRR call per backtest run; sweep sessions may run 100–500 runs in parallel batches — solver must be stateless and synchronous

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Evidence |
|------|--------|----------|
| **No Live Trading** | ✅ PASS | IRR is a post-run analytics computation over historical `tradeEvents`. No execution path modified. |
| **Green Light Protocol** | ✅ PASS (conditional) | `IrrCalculator.test.ts` with all 5 canonical cases + edge cases MUST pass before merge. No existing tests may regress. |
| **Fixed-Point Arithmetic** | ✅ PASS | Solver uses `Decimal.js` throughout — all cash-flow construction, power/multiply/divide, NPV accumulation, and derivative computation use `new Decimal(...)` chains. |
| **Single-Position Invariant** | ✅ N/A | IRR computation is stateless orchestrator math; does not touch position state machine. |
| **Gap-Down Execution** | ✅ N/A | No candle-processing logic modified. IRR reads already-emitted `tradeEvents`. |
| **Architecture Constraint** | ✅ PASS | Feature lives entirely in `orchestrator/api/src/` and `frontend/src/`. Go engine unchanged. Core-engine domain untouched. |
| **Feature Placement** | ✅ PASS | `orchestrator/` only. IRR is financial analytics on emitted events — it is not part of the core simulation loop. |

**Post-design re-check**: After Phase 1, verify `IrrCalculator.ts` imports only Decimal.js (no `Math.pow` or `number` arithmetic in hot path).

## Project Structure

### Documentation (this feature)

```text
specs/020-annualized-return/
├── plan.md              # This file
├── research.md          # Phase 0 output (IRR algorithm choices, Decimal.js approach)
├── data-model.md        # Phase 1 output (CashFlow interface, StoredPnlSummary extension, DB schema)
├── quickstart.md        # Phase 1 output (how to run IrrCalculator tests)
├── contracts/           # Phase 1 output (TypeScript interfaces at service boundaries)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (Polyglot Architecture)

```text
core-engine/             # Go — NO CHANGES for this feature
│
orchestrator/api/src/
├── services/
│   ├── IrrCalculator.ts           # NEW — Newton-Raphson + bisection solver
│   ├── IrrCalculator.test.ts      # NEW — 5 canonical cases + edge cases
│   ├── BackgroundWorker.ts        # MODIFY — call computeAnnualizedReturn() post-engine
│   ├── SweepPersistenceService.ts # MODIFY — persist annualized_return column
│   └── optimizer.routes.ts        # (in routes/) MODIFY — inject IRR into batch results
├── types/
│   └── index.ts                   # MODIFY — StoredPnlSummary + annualizedReturn field
├── db/
│   └── schema.ts                  # MODIFY — add annualizedReturn to sweepRunSummaries
└── drizzle/
    ├── 0006_020_annualized_return.sql  # NEW — ADD COLUMN migration
    └── meta/_journal.json              # MODIFY — add idx 5 (stop_loss_kpis) + idx 6 (annualized_return)

frontend/src/
├── services/types.ts              # MODIFY — PnlSummary + annualizedReturn field
├── hooks/useOptimizer.ts          # MODIFY — parse annualizedReturn from API response
└── components/
    ├── PnlSummary.tsx             # MODIFY — add "Annualized Return (IRR)" MetricCard
    └── RunCard.tsx                # MODIFY — add annualizedReturn line in details

grafana/dashboards/
├── 04-sweep-leaderboard.json      # MODIFY — 2 stat panels + table column + overrides
├── 01-run-overview.json           # MODIFY — add annualizedReturn panel beside ROI
└── 04-sweep-promoted-comparison.json  # MODIFY — add annualizedReturn panel beside ROI
```

**Feature Placement**: `orchestrator/` only. The Go core-engine emits `tradeEvents` — the IRR computation reads those events and lives entirely in the TypeScript orchestrator layer.

## Complexity Tracking

> No Constitution violations. No complexity justification required.

| Gate | Result |
|------|--------|
| All 5 constitution gates | PASS (no violations) |
| Additive-only API change | PASS (`annualizedReturn` is optional everywhere) |
| No ClickHouse DDL | PASS (SC-008 — wide-event dashboards use JOIN to `sweep_run_summaries`) |
