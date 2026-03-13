# Implementation Plan: SDD 4.1 Parameters Integration — UI & Engine Config Refactor

**Branch**: `006-sdd-params-integration` | **Date**: 2026-03-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/006-sdd-params-integration/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Replace the ad-hoc `entry_price / amounts[] / sequences[] / leverage / margin_ratio` engine contract
with the 13 canonical SDD §4.1 parameters (`trading_pair`, `start_date`, `end_date`, `price_entry`,
`price_scale`, `amount_scale`, `number_of_orders`, `amount_per_trade`, `margin_type`, `multiplier`,
`take_profit_distance_percent`, `account_balance`, `exit_on_last_order`). The change touches three
layers: (1) the Go engine entry point (`cmd/engine/main.go`), which gains a correctly mapped
`buildConfigFromRequest`; (2) the Node.js API types and validation (`configuration.ts`, `index.ts`,
`validation.middleware.ts`) plus a new `MarketDataResolver` service; and (3) the React frontend
(`ConfigurationForm.tsx`, `backtest-api.ts`, `services/types.ts`), which replaces manual
`amounts[]` / `sequences` list management with 13 individual controlled inputs.

## Technical Context

**Language/Version**: Go 1.21 (core engine), TypeScript 5.x / Node.js 20 (API), React 18 / TypeScript 5 (frontend)
**Primary Dependencies**: shopspring/decimal (Go), Decimal.js (Node.js), React + Tailwind CSS (frontend), Express 4 (API)
**Storage**: Flat files — OHLCV CSV files on disk (`MARKET_DATA_DIR`), JSON result files in `RESULTS_DIR`
**Testing**: `go test ./...` (Go), Jest (Node.js + React)
**Target Platform**: Local dev / Linux server (API + engine); browser (frontend)
**Project Type**: Web service (API layer), CLI subprocess (engine binary), web app (frontend)
**Performance Goals**: Engine must process multi-year backtests in < 60 seconds; API response ≤ 35s timeout
**Constraints**: Fixed-point arithmetic only (no IEEE-754 floats in monetary math); Green Light Protocol before merges
**Scale/Scope**: Single-user local tool; polyglot 3-layer stack (Go + TypeScript API + React)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Evidence |
|------|--------|---------|
| No live trading (simulation only) | ✅ Pass | Feature only modifies parameter schema — no execution model changes |
| Green Light Protocol | ✅ Pass | No new failures introduced; existing tests updated to match new schema |
| Fixed-point arithmetic | ✅ Pass | All monetary fields remain string-typed at API boundary; Go uses `decimal.NewFromString()`; frontend uses string form state |
| Single-position invariant | ✅ Pass | No change to execution engine logic |
| Gap-Down Rule | ✅ Pass | No change to execution engine logic |
| BDD acceptance criteria | ✅ Pass | 4 user stories with Given/When/Then scenarios documented in spec.md |
| TDD for canonical math | ✅ Pass | 6 integration test cases defined in research.md §4; they test the mapping layer against known math |
| Architecture separation (core vs orchestration) | ✅ Pass | Go changes are in `cmd/` adapter layer only, not `domain/`; Node.js stays in `orchestrator/api/`; React stays in `frontend/` |

**Post-design re-check**: All gates still pass. No constitution violations.

## Project Structure

### Documentation (this feature)

```text
specs/006-sdd-params-integration/
├── plan.md              ← This file
├── research.md          ← Phase 0: gap analysis, naming convention, state mgmt decisions
├── data-model.md        ← Phase 1: all entity shapes across all layers
├── quickstart.md        ← Phase 1: build + verify instructions
├── contracts/
│   ├── engine-json-protocol.md     ← Go stdin/stdout schema v2
│   ├── api-post-backtest.md        ← POST /backtest request/response contract
│   └── market-data-resolver.md     ← MarketDataResolver service interface
└── tasks.md             ← Phase 2 output (created by /speckit.tasks)
```

### Source Code (Polyglot Architecture)

```text
core-engine/
└── cmd/engine/main.go          ← MODIFY: new EngineRequest struct + buildConfigFromRequest

orchestrator/api/src/
├── types/
│   ├── configuration.ts        ← MODIFY: new ApiBacktestRequest interface + validateBacktestRequest
│   └── index.ts                ← MODIFY: update exported BacktestRequest type
├── services/
│   └── MarketDataResolver.ts   ← CREATE: CSV path derivation service
├── config/
│   └── AppConfig.ts            ← MODIFY: add MARKET_DATA_DIR env var
├── routes/
│   └── backtest.routes.ts      ← MODIFY: wire MarketDataResolver before engine call
└── middleware/
    └── validation.middleware.ts ← MODIFY: pass new request shape to validator

frontend/src/
├── services/
│   ├── types.ts                ← MODIFY: new BacktestFormState replacing BacktestConfiguration
│   └── backtest-api.ts         ← MODIFY: new API payload translation
└── components/
    └── ConfigurationForm.tsx   ← MODIFY: 13 individual fields, remove amounts[] list
```

**Feature Placement Contract**: Core engine changes are in `cmd/` (adapter/entrypoint layer only). No `domain/` code changes — all 14 `With*` option functions already exist. All API and UI changes are in `orchestrator/` and `frontend/` respectively.

## Complexity Tracking

> No constitution violations to justify.

