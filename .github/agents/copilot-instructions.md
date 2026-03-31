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
- 015-wide-events-analytics: Added Go 1.22 (core engine) · TypeScript 5.x / Node.js 20 (orchestrator API) + `shopspring/decimal` (Go), `bufio` stdlib, `encoding/json` stdlib, `@clickhouse/client` (Node.js, already present), `clickhouse-go/v2` (Go, already present)
- 014-spot-no-liquidation: Added Go 1.22 (core-engine module) + `github.com/shopspring/decimal` (fixed-point arithmetic)
- 013-psm-dynamic-trade-size: Added Go 1.22 (core-engine module) + `github.com/shopspring/decimal` (fixed-point arithmetic)


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
