# DCA Backtesting bot Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-07

## Active Technologies
- Go 1.22+ (core-engine domain layer) (002-position-state-machine)
- N/A (PSM is stateless per candle; caller manages state persistence) (002-position-state-machine)
- Go 1.21+ (matches core-engine/domain/position/go.mod) + `shopspring/decimal` (already used in PSM), `encoding/csv` (stdlib) (003-backtest-orchestrator)
- In-memory (Event Bus), CSV file input (high-performance streaming) (003-backtest-orchestrator)
- [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION] + [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION] (006-sdd-params-integration)
- [if applicable, e.g., PostgreSQL, CoreData, files or N/A] (006-sdd-params-integration)
- Go 1.21 (core engine), TypeScript 5.x / Node.js 20 (API), React 18 / TypeScript 5 (frontend) + shopspring/decimal (Go), Decimal.js (Node.js), React + Tailwind CSS (frontend), Express 4 (API) (006-sdd-params-integration)
- Flat files — OHLCV CSV files on disk (`MARKET_DATA_DIR`), JSON result files in `RESULTS_DIR` (006-sdd-params-integration)
- TypeScript 5 (orchestrator/api, frontend); React 18; Vite 5; Node.js 20 + `decimal.js` (precision math), `recharts` (bar chart), `axios` (HTTP), `jest`/`ts-jest` (orchestrator tests), `vitest` (frontend tests), Tailwind CSS v3 (007-result-aggregator-overhaul)
- Filesystem JSON via `ResultStore` (`orchestrator/api/storage/results/`) (007-result-aggregator-overhaul)

- Go 1.20+ + github.com/shopspring/decimal (fixed-point arithmetic library) (001-core-domain-config)

## Project Structure

```text
src/
tests/
```

## Commands

# Add commands for Go 1.20+

## Code Style

Go 1.20+: Follow standard conventions

## Recent Changes
- 007-result-aggregator-overhaul: Added TypeScript 5 (orchestrator/api, frontend); React 18; Vite 5; Node.js 20 + `decimal.js` (precision math), `recharts` (bar chart), `axios` (HTTP), `jest`/`ts-jest` (orchestrator tests), `vitest` (frontend tests), Tailwind CSS v3
- 006-sdd-params-integration: Added Go 1.21 (core engine), TypeScript 5.x / Node.js 20 (API), React 18 / TypeScript 5 (frontend) + shopspring/decimal (Go), Decimal.js (Node.js), React + Tailwind CSS (frontend), Express 4 (API)
- 006-sdd-params-integration: Added [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION] + [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
