# Research: PSM Dynamic Trade Sizing from Compounding Balance

**Feature**: 013-psm-dynamic-trade-size  
**Phase**: 0 — Pre-Design Research  
**Status**: COMPLETE

## Decisions

### Decision 1: How to pass the dynamic balance into `ComputeAmountSequence`

**Decision**: Add `dynamicBalance decimal.Decimal` as an explicit parameter to `ComputeAmountSequence`. The function signature becomes:

```go
func (c *Config) ComputeAmountSequence(dynamicBalance decimal.Decimal) (AmountSequence, error)
```

**Rationale**:
- `Config` is immutable after construction — all fields are set via functional options in `NewConfig` and the struct has no setters. Mutating `c.accountBalance` temporarily is not possible without violating the immutability contract.
- Passing the live balance as an explicit argument is the only approach consistent with Go's pure function style and makes the dependency visible at every call site.
- It mirrors the existing pattern for `ComputePriceSequence(currentPrice decimal.Decimal)`, which already accepts its live input externally rather than caching it on the struct.

**Alternatives considered**:

| Alternative | Why Rejected |
|---|---|
| Mutate `c.accountBalance` in-place before calling | `Config` is intentionally immutable; concurrent backtest workers share config; would cause data race |
| New method `ComputeAmountSequenceWithBalance(balance decimal.Decimal)` | Forks the API surface without deprecating the original; callers would have to know which to use |
| New config option `WithDynamicBalance` set before each trade | Requires mutating a const object per-trade; same concurrency problem as above |
| Store `dynamicBalance` on the `Position` struct and read it inside sequences.go | Creates a circular import: `config` package importing `position` package would form a cycle |

---

### Decision 2: Placement of the zero-balance guard (FR-005)

**Decision**: The guard lives inside `ComputeAmountSequence`, in the percentage branch, before any computation:

```go
if apt.LessThanOrEqual(one) {
    if dynamicBalance.LessThanOrEqual(decimal.Zero) {
        return nil, &SequenceComputationError{ ... }
    }
    V = dynamicBalance.Mul(apt).Mul(m)
}
```

**Rationale**: This is a mathematical precondition of the formula (`V = dynamicBalance × apt × m` is undefined / meaningless for `dynamicBalance ≤ 0`), not an orchestration–level policy. Placing the guard in the Orchestrator would silently skip position opening without a clear structured error; placing it here surfaces a `SequenceComputationError` that can be logged and counted by any caller.

**Consistent with**: `ComputePriceSequence` already guards `currentPrice ≤ 0` and returns `SequenceComputationError` for the same reason.

---

### Decision 3: `ComputeBaseQuantities` signature update

**Decision**: Update `ComputeBaseQuantities` to accept and thread `dynamicBalance`:

```go
func (c *Config) ComputeBaseQuantities(dynamicBalance decimal.Decimal, prices PriceSequence) (AmountSequence, error)
```

**Rationale**: `ComputeBaseQuantities` calls `ComputeAmountSequence` internally. If its signature is not updated, it becomes impossible to call the correct version. The function has zero external call sites in the current codebase (confirmed by grep), so the breakage is limited to the function definition itself and is trivially fixed.

**Note**: If `ComputeBaseQuantities` is used in a future feature, its parameter signature is already correct and consistent.

---

### Decision 4: What value existing tests should pass for `dynamicBalance` in the absolute branch

**Decision**: Pass `decimal.Zero` at all existing call sites where `amountPerTrade > 1.0`.

**Rationale**: In the absolute branch, `dynamicBalance` is never read. Passing `decimal.Zero` is semantically accurate ("I am not providing a balance because it's irrelevant here") and will exercise the guard-skip path, confirming the function correctly does nothing with the balance in absolute mode. Using a random non-zero value would obscure the intent.

**Affected tests** (T052–T061, except T058): all use absolute `amountPerTrade`, all updated to `decimal.Zero`.

**T058 special case**: `amountPerTrade = "0.5"` — this is a percentage test. It previously relied on `c.DefaultAccountBalance = 1000` implicitly. After the change it must explicitly pass `mustDecimal("1000")` to reproduce the same expected sum of 500.

---

### Decision 5: Whether `NewPosition` needs changes

**Decision**: No. `NewPosition` does not change.

**Rationale**: `NewPosition(tradeID string, openTime time.Time, prices, amounts []decimal.Decimal)` already accepts pre-computed USDT amount slices. The Orchestrator computes those amounts by calling `ComputeAmountSequence` and passes the results through. The fix is entirely upstream of `NewPosition` — in _how_ those amounts are computed, not in how they are consumed.

---

## Findings: Call Site Inventory

Exhaustive grep across the workspace for `ComputeAmountSequence`:

| File | Line | Context |
|---|---|---|
| `core-engine/domain/config/sequences.go` | 77 | Definition |
| `core-engine/domain/config/sequences.go` | 143 | Called by `ComputeBaseQuantities` |
| `core-engine/application/orchestrator/orchestrator.go` | 196 | **Primary call site** — must pass `orch.runningBalance` |
| `core-engine/domain/config/sequences_test.go` | 253, 279, 293, 311, 312, 329, 340, 364, 375, 391, 412 | Test call sites — must add `decimal.Zero` or explicit balance |

Total external call sites requiring update: **1 production** (`orchestrator.go`) + **11 test** (`sequences_test.go`).

`ComputeBaseQuantities` has **zero** external call sites (definition-only in sequences.go).
