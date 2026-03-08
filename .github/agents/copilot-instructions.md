# DCA Backtesting bot Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-07

## Active Technologies
- Go 1.22+ (core-engine domain layer) (002-position-state-machine)
- N/A (PSM is stateless per candle; caller manages state persistence) (002-position-state-machine)
- Go 1.21+ (matches core-engine/domain/position/go.mod) + `shopspring/decimal` (already used in PSM), `encoding/csv` (stdlib) (003-backtest-orchestrator)
- In-memory (Event Bus), CSV file input (high-performance streaming) (003-backtest-orchestrator)

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
- 003-backtest-orchestrator: Added Go 1.21+ (matches core-engine/domain/position/go.mod) + `shopspring/decimal` (already used in PSM), `encoding/csv` (stdlib)
- 002-position-state-machine: Added Go 1.22+ (core-engine domain layer)

- 001-core-domain-config: Added Go 1.20+ + github.com/shopspring/decimal (fixed-point arithmetic library)

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
