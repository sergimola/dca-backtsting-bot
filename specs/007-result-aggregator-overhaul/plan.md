# Implementation Plan: Result Aggregator Overhaul

**Branch**: `007-result-aggregator-overhaul` | **Date**: 2026-03-14 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/007-result-aggregator-overhaul/spec.md`

## Summary

Fix three data-correctness bugs in the results pipeline and redesign the Trade accordion UI to surface per-trade Gross/Net/Fees alongside sequential Trade IDs.

Bugs being fixed:
1. **SO0 chart bug** — `ResultAggregator.aggregateGoEvents()` incorrectly counts `PositionOpened` as safety order level 0; and `backtest-api.ts` pads the chart array starting from index 0 — yielding a spurious "SO0" bar.
2. **Trade ID grouping** — all events share the same `trade_id` from the Go engine; frontend groups them into one accordion row instead of one per trade.
3. **Missing exit fee** — `SellOrderExecuted.fee` (the exit sell fee) is stripped from the pipeline before it can appear in trade-level fee totals.

New UI feature: accordion header shows `Trade #X | Gross: ±$X.XX | Fees: -$Y.YY | Net: ±$Z.ZZ` with green/red net profit colour coding, and the summary card relabelled "Total Net P&L".

## Technical Context

**Language/Version**: TypeScript 5 (orchestrator/api, frontend); React 18; Vite 5; Node.js 20  
**Primary Dependencies**: `decimal.js` (precision math), `recharts` (bar chart), `axios` (HTTP), `jest`/`ts-jest` (orchestrator tests), `vitest` (frontend tests), Tailwind CSS v3  
**Storage**: Filesystem JSON via `ResultStore` (`orchestrator/api/storage/results/`)  
**Testing**: Jest + ts-jest (`orchestrator/api`); Vitest + React Testing Library (`frontend`)  
**Target Platform**: Browser SPA (frontend) + Node.js HTTP server (orchestrator/api)  
**Project Type**: Web application — API adapter + React frontend  
**Performance Goals**: Client-side only; no throughput requirement — result sets are small (≤ 10k events)  
**Constraints**: All monetary arithmetic must use `Decimal.js` — no native JS float math  
**Scale/Scope**: Single-user local tool; results JSON files are ≤ 5 MB each

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — ✅ POST-DESIGN RE-CHECK PASSED (2026-03-14)*

| Gate | Status | Evidence |
|------|--------|----------|
| No Live Trading | ✅ PASS | Feature touches only results display; zero changes to execution path or Go engine |
| Green Light Protocol | ✅ PASS | All existing tests must remain green (confirmed: no breaking changes to public APIs or data contracts); new BDD tests added for each changed behaviour |
| Fixed-point arithmetic | ✅ PASS | All fee summation and gross profit reconstruction MUST use `Decimal.js`; the `backtest-api.ts` mapping already uses `parseFloat` for display values — new per-trade arithmetic will use `Decimal` before converting to display number |
| Single-position invariant | ✅ N/A | Feature does not touch position state machine |
| Gap-Down execution rules | ✅ N/A | Feature does not touch execution loop |
| Architecture constraints | ✅ PASS | All changes are in `orchestrator/api/` (TS adapter) and `frontend/` (React UI) — the Go core-engine is untouched |

**Post-design check**: Phase 1 design confirms no new constitution risks. The per-trade arithmetic uses `Decimal.js` addition before converting to JS float for display; no float accumulation occurs. Existing stored result files with legacy `"0"` keys in `safety_order_usage_counts` are handled gracefully (the new loop never reads index `0`).

**No gate violations.** Complexity Tracking table not required.

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
orchestrator/api/src/
├── services/
│   └── ResultAggregator.ts     ← Fix SO0 bug: remove PositionOpened from safetyOrderUsageCounts[0]
│                                  Fix totalFills: entry order not counted as a fill
├── (no new files)

frontend/src/
├── services/
│   ├── backtest-api.ts         ← Incremental tradeCounter; SellOrderExecuted fee extraction;
│   │                              safety order chart loop fixed to start at i=1
│   └── types.ts                ← TradeEvent: add tradeNumber: number (sequential display label)
├── components/
│   └── ResultsDashboard.tsx    ← Accordion header redesign (Trade #X | Gross | Fees | Net);
│                                  "Total Net P&L" label; gray/slate header styling
```

**Feature Placement**: Entirely within `orchestrator/api/` (TS result adapter) and `frontend/` (React UI).  
The Go `core-engine/` is not touched — this feature is pure display-layer computation.

## Complexity Tracking

No constitution violations — table omitted.
