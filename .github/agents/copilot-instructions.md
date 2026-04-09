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
- Go 1.26.1 (core engine), TypeScript 5.x / Node.js 20 (API), React 18 (frontend) (008-clickhouse-market-data)
- ClickHouse — `ReplacingMergeTree`, ordered on `(symbol, timestamp)`, 1-minute OHLCV candles (008-clickhouse-market-data)
- TypeScript 5.1 / React 18.2 + React 18, Vite 5, TailwindCSS 3.3, lucide-react (NEW), decimal.js (009-pro-quant-terminal-ui)
- N/A — session-only React state; no persistence (009-pro-quant-terminal-ui)
- TypeScript 5.1 / Node.js 18+ + Express 5.x (existing), Drizzle ORM (drizzle-orm + drizzle-kit), pg (node-postgres), child_process.spawn (stdlib) (010-postgres-async-architecture)
- PostgreSQL 16 (new — backtest jobs + sync ledger) + ClickHouse (existing — market data OHLCV only) (010-postgres-async-architecture)
- Go 1.22 (core engine), TypeScript 5.x / Node.js 20 LTS (orchestrator) (011-go-engine-io-optimization)
- PostgreSQL 16 via Drizzle ORM (two new columns); ClickHouse (new pre-flight COUNT query) (011-go-engine-io-optimization)
- Go 1.21 (core engine) · TypeScript 5.x / React 18 (UI + API) (012-monthly-capital-injection)
- PostgreSQL via Drizzle — `config` JSONB column stores `ApiBacktestRequest` blob verbatim; no schema migration required (012-monthly-capital-injection)
- Go 1.22 (core engine) | TypeScript 5.x / React 18 (frontend + orchestrator API) + `shopspring/decimal` (Go fixed-point), `decimal.js` (TypeScript fixed-point), React 18, Tailwind CSS, Vite (012-monthly-capital-injection)
- PostgreSQL (Drizzle ORM) — JSONB columns store config + result blobs; no migration required (012-monthly-capital-injection)
- Go 1.22 (core-engine module) + `github.com/shopspring/decimal` (fixed-point arithmetic) (013-psm-dynamic-trade-size)
- N/A — pure in-memory domain computation (013-psm-dynamic-trade-size)
- N/A — pure in-memory domain computation; no persistence changes (014-spot-no-liquidation)
- Go 1.22 (core engine) · TypeScript 5.x / Node.js 20 (orchestrator API) + `shopspring/decimal` (Go), `bufio` stdlib, `encoding/json` stdlib, `@clickhouse/client` (Node.js, already present), `clickhouse-go/v2` (Go, already present) (015-wide-events-analytics)
- ClickHouse (OLAP, JSONL bulk insert) · PostgreSQL (job queue, no change) (015-wide-events-analytics)
- Go 1.22 (core engine) · TypeScript 5.x + Node.js 20 (orchestrator API) · TypeScript 5.x + React 18 (frontend) + shopspring/decimal (Go fixed-point) · Express 4 (API) · Vite + Tailwind CSS (frontend) · Headless UI (popovers) (016-optimizer-workspace)
- ClickHouse (candle data — read-only in this feature) · In-memory only for sweep results (FR-034; no DB writes for optimizer runs) (016-optimizer-workspace)
- Go 1.22 (core-engine) + TypeScript 5.x/Node.js 22 (orchestrator/api) + TypeScript 5.x/React 18 (frontend) + `shopspring/decimal` (Go), `decimal.js` (Node.js), `drizzle-orm` + `pg` (API), React Router v6, Tailwind CSS (017-pro-optimizer-workspace)
- PostgreSQL via Drizzle ORM — two new tables: `sweep_sessions`, `sweep_run_summaries` (017-pro-optimizer-workspace)
- Go 1.22 (core-engine) · TypeScript 5 / Node.js 20 (orchestrator/api) · React 18 / TypeScript (frontend) + `@clickhouse/client` (ClickHouse HTTP singleton, existing), `drizzle-orm` + `pg` (Postgres ORM, existing), Express 5 (API, existing), React 18 + TanStack Table (Leaderboard, existing) (018-clickhouse-batch-promotion)
- PostgreSQL (sweep summaries, config metadata) + ClickHouse (wide event time-series) (018-clickhouse-batch-promotion)
- Go 1.22 (core engine), TypeScript 5.x (API + frontend), React 18 (frontend) + `shopspring/decimal` (Go fixed-point), Drizzle ORM (Postgres), React/Tailwind (frontend) (019-engine-stop-loss)
- PostgreSQL (sweep summaries, migrations), ClickHouse (wide events, market data) (019-engine-stop-loss)
- TypeScript 5.1.3 / Node.js v24.11.0 (orchestrator layer); React 18 (frontend) + Decimal.js ^10.4.3 (fixed-point math), Drizzle ORM ^0.45.1 (schema + migrations), Express ^5.2.1 (API routes), pg ^8.20.0 (PostgreSQL client), @opentelemetry/api ^1.9.1 (tracing, non-blocking batched) (020-annualized-return)
- PostgreSQL — `sweep_run_summaries` table; `annualized_return numeric(10,4)` column added via hand-written Drizzle migration (020-annualized-return)
- TypeScript 5.1 (frontend), React 18.2 + `decimal.js ^10.6.0` (already installed), Jest 29, Testing Library 14 (021-roi-unification)
- N/A — pure computational/rendering change; no schema or DB involvement (021-roi-unification)

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
- 021-roi-unification: Added TypeScript 5.1 (frontend), React 18.2 + `decimal.js ^10.6.0` (already installed), Jest 29, Testing Library 14
- 020-annualized-return: Added TypeScript 5.1.3 / Node.js v24.11.0 (orchestrator layer); React 18 (frontend) + Decimal.js ^10.4.3 (fixed-point math), Drizzle ORM ^0.45.1 (schema + migrations), Express ^5.2.1 (API routes), pg ^8.20.0 (PostgreSQL client), @opentelemetry/api ^1.9.1 (tracing, non-blocking batched)
- 019-engine-stop-loss: Added Go 1.22 (core engine), TypeScript 5.x (API + frontend), React 18 (frontend) + `shopspring/decimal` (Go fixed-point), Drizzle ORM (Postgres), React/Tailwind (frontend)


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
