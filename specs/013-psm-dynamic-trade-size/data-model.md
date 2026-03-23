# Data Model: PSM Dynamic Trade Sizing from Compounding Balance

**Feature**: 013-psm-dynamic-trade-size  
**Phase**: 1 — Design  
**Status**: COMPLETE

## Overview

This feature introduces no new domain entities, structs, events, or database tables. It modifies two existing function signatures within the `config` package and one call site in the `orchestrator` package.

---

## Modified Function Contracts

### `ComputeAmountSequence` (modified)

**Package**: `core-engine/domain/config`  
**File**: `core-engine/domain/config/sequences.go`

| Aspect | Before | After |
|---|---|---|
| Signature | `(c *Config) ComputeAmountSequence() (AmountSequence, error)` | `(c *Config) ComputeAmountSequence(dynamicBalance decimal.Decimal) (AmountSequence, error)` |
| Inputs | None (reads `c.accountBalance` internally) | `dynamicBalance decimal.Decimal` — the live compounding equity from the Orchestrator |
| Percentage branch | `V = c.accountBalance × apt × m` | `V = dynamicBalance × apt × m` (after zero-balance guard) |
| Absolute branch | `V = apt × m` (unchanged) | `V = apt × m` (unchanged — `dynamicBalance` not read) |
| Error conditions | None in V-computation | `SequenceComputationError` when `apt ≤ 1.0` AND `dynamicBalance ≤ 0` |
| Return type | `AmountSequence` | `AmountSequence` (no change) |
| Sum invariant | Maintained by last-element adjustment | Maintained by same last-element adjustment (logic unchanged) |

**Validation rule**:
```
IF amountPerTrade ≤ 1.0 AND dynamicBalance ≤ 0:
    → return SequenceComputationError{Sequence: "amount", Message: "dynamicBalance must be > 0 ..."}
```

**Mode decision tree** (unchanged boundary, new input source):
```
amountPerTrade ≤ 1.0?
├── YES (percentage mode)
│   ├── dynamicBalance ≤ 0? → ERROR (SequenceComputationError)
│   └── V = dynamicBalance × amountPerTrade × multiplier
└── NO (absolute mode)
    └── V = amountPerTrade × multiplier   [dynamicBalance ignored]
```

---

### `ComputeBaseQuantities` (modified)

**Package**: `core-engine/domain/config`  
**File**: `core-engine/domain/config/sequences.go`

| Aspect | Before | After |
|---|---|---|
| Signature | `(c *Config) ComputeBaseQuantities(prices PriceSequence) (AmountSequence, error)` | `(c *Config) ComputeBaseQuantities(dynamicBalance decimal.Decimal, prices PriceSequence) (AmountSequence, error)` |
| Internal call | `c.ComputeAmountSequence()` | `c.ComputeAmountSequence(dynamicBalance)` |
| All other logic | Unchanged | Unchanged |

---

## Canonical Arithmetic Reference

These are the binding test values from spec.md. Any implementation must produce these exact decimal results.

| amountPerTrade | dynamicBalance | multiplier | N | sa | Expected V |
|---|---|---|---|---|---|
| `1.0` | `5000` | `1` | any | any | `5000.00000000` |
| `0.5` | `4000` | `1` | any | any | `2000.00000000` |
| `1.0` | `5000` | `3` | any | any | `15000.00000000` |
| `500` | `5000` | `1` | any | any | `500.00000000` |
| `500` | `5000` | `2` | any | any | `1000.00000000` |
| `500` | `400` | `1` | any | any | `500.00000000` |
| `1.0` | `2000` | `1` | any | any | `2000.00000000` |
| `1.01` | `2000` | `1` | any | any | `1.01000000` |

---

## No New Entities

The following are explicitly **not** changed by this feature:

- `Config` struct fields — no new fields; `accountBalance` remains as static seed / reporting reference
- `Position` struct fields — not touched
- `NewPosition` function signature — not touched
- Any events (`TradeOpenedEvent`, `BuyOrderExecutedEvent`, etc.) — not touched
- TypeScript orchestrator layer — not touched
- React frontend — not touched
- API schema — not touched
