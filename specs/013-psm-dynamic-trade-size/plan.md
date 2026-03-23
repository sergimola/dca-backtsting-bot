# Implementation Plan: PSM Dynamic Trade Sizing from Compounding Balance

**Branch**: `013-psm-dynamic-trade-size` | **Date**: 2026-03-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/013-psm-dynamic-trade-size/spec.md`

## Summary

The Orchestrator (Feature 012) maintains a live `runningBalance` that compounds across trade cycles. When it opens a new trade it passes that balance into the PSM via `newPos.AccountBalance = orch.runningBalance`. However, the grid USDT amounts passed to `NewPosition` are computed _before_ that assignment, by calling `ComputeAmountSequence()` which still reads the static `c.accountBalance` from the config object for the percentage branch. This makes compounding inoperative for any strategy configured with `AmountPerTrade ≤ 1.0`.

The fix is a targeted, three-file change confined to the Go domain and its test suite:

1. **`sequences.go`** — Add `dynamicBalance decimal.Decimal` parameter to `ComputeAmountSequence`. Use it instead of `c.accountBalance` in the percentage branch. Add a zero-balance guard that returns a `SequenceComputationError` before any computation. Also update `ComputeBaseQuantities` (same file, internally calls `ComputeAmountSequence`) to thread the parameter through.
2. **`orchestrator.go`** — Update the single call site to pass `orch.runningBalance`.
3. **`sequences_test.go`** — Update every call site to pass a `dynamicBalance` argument; add new tests for FR-001, FR-002, FR-005, and the boundary condition.

No changes are required to `NewPosition`, the PSM state machine, the TypeScript layer, or the frontend.

## Technical Context

**Language/Version**: Go 1.22 (core-engine module)  
**Primary Dependencies**: `github.com/shopspring/decimal` (fixed-point arithmetic)  
**Storage**: N/A — pure in-memory domain computation  
**Testing**: `go test ./...` from `core-engine/`  
**Target Platform**: Linux/Windows (CI + developer machine)  
**Project Type**: Domain library (core-engine)  
**Performance Goals**: No change — this is a formula input substitution, not a hot path restructure  
**Constraints**: All monetary math via `decimal.Decimal`; zero float usage; sum invariant (D_n sum = V) must hold after the change  
**Scale/Scope**: 3 files modified; ~150 lines touched across implementation and tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates are determined by `.specify/memory/constitution.md` and include at minimum:
- No Live Trading enforcement (simulation-only)
- Green Light Protocol: entire test suite must be Green before merges/feature work
- Fixed-point arithmetic requirement for all monetary math
- Single-position invariant and Gap-Down execution rules
- Architecture constraints (core engine in Rust/Go; adapters outside domain)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Gate | Status | Evidence |
|---|---|---|
| No Live Trading | PASS | This feature touches only the backtest simulation engine. No live order routing exists or is modified. |
| Green Light Protocol | PASS (conditional) | All existing `go test ./...` must be green before implementation begins. The signature change to `ComputeAmountSequence` will break compilation in `sequences_test.go` and `orchestrator.go` — those are the only two call sites and both are updated atomically in the same task. |
| Fixed-point Arithmetic | PASS | `dynamicBalance decimal.Decimal` is the type used throughout. The percentage-branch guard and multiplication use only shopspring/decimal operations. No float introduced. |
| Single-position Invariant | PASS — Not Affected | `NewPosition` signature is not changed. The PSM state machine is not touched. |
| Gap-Down Execution Rule | PASS — Not Affected | Order fill logic in `order_fills.go` and `minute_loop.go` is not touched. |
| BDD Acceptance Criteria | PASS | spec.md contains Given/When/Then for all three user stories. New tests will be named by spec scenario (TS013_US1–US3). |
| TDD | PASS | Test names precisely map to spec Acceptance Scenarios and Canonical Test Data table. Tests are written before implementation passes (RED first). |

## Project Structure

### Documentation (this feature)

```text
specs/013-psm-dynamic-trade-size/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (Feature Placement: core-engine only)

This feature is **100% core-engine domain**. No orchestrator/ TypeScript, API, or UI files are modified.

```text
core-engine/
├── domain/config/
│   ├── sequences.go          ← MODIFIED: ComputeAmountSequence + ComputeBaseQuantities signature
│   └── sequences_test.go     ← MODIFIED: call site updates + new TS013 tests
└── application/orchestrator/
    └── orchestrator.go       ← MODIFIED: pass orch.runningBalance to ComputeAmountSequence
```

## Complexity Tracking

No constitution violations. No new abstractions, repositories, or patterns introduced. The change is a minimal parameter addition to one function and two call site updates.

---

## Phase 0: Research

> Status: COMPLETE — no unknowns remain from Technical Context. All required facts were determined from reading the existing source.

### research.md decisions

See [research.md](research.md) for the full record. Summary of decisions:

1. **Signature approach**: Add `dynamicBalance decimal.Decimal` as an explicit parameter to `ComputeAmountSequence`. Alternatives considered and rejected:
   - *Mutating config.accountBalance temporarily*: rejected — `Config` is immutable by design (const after construction); concurrent backtest workers sharing a config would race.
   - *New method variant `ComputeAmountSequenceWithBalance`*: rejected — creates a parallel API surface without clear deprecation path. A single function with an explicit parameter is simpler and enforces correctness at the call site.
   - *Thread balance through `Config.WithAccountBalance` before each trade*: rejected — `Config` is treated as a const backtest parameters snapshot; mutating it per-trade would violate its design contract.

2. **Zero-balance guard placement**: Guard lives inside `ComputeAmountSequence` (not in the Orchestrator). Rationale: the guard is a mathematical invariant of the formula (cannot divide or multiply by zero balance meaningfully), not an orchestration concern. Returning `SequenceComputationError` is consistent with how `ComputePriceSequence` guards `currentPrice ≤ 0`.

3. **`ComputeBaseQuantities` signature**: Also updated to accept and propagate `dynamicBalance`. Although it has no external call sites today, leaving it with a stale signature would permanently diverge it from `ComputeAmountSequence`. It is updated for consistency and correctness.

4. **Test migration strategy**: All existing `ComputeAmountSequence()` call sites in `sequences_test.go` use absolute amounts (`amountPerTrade > 1.0`). For these, `dynamicBalance` is irrelevant (the absolute branch ignores it). Passing `decimal.Zero` is semantically correct and unambiguous — it proves the absolute branch truly ignores the balance. The one percentage test (T058) must pass `mustDecimal("1000")` (matching the `DefaultAccountBalance` the test previously relied on implicitly).

---

## Phase 1: Design & Contracts

### data-model.md

See [data-model.md](data-model.md).

The only domain entity changes are:

- **`ComputeAmountSequence`** gains a `dynamicBalance decimal.Decimal` input. Its output (`AmountSequence`) and its return type signature are unchanged.
- **`ComputeBaseQuantities`** gains a `dynamicBalance decimal.Decimal` input. Same output type.
- No new structs, interfaces, events, or state transitions are introduced.

### Interface Contracts

See [contracts/](contracts/).

This feature modifies two internal Go function signatures. No external API (HTTP, gRPC, CLI) is changed. The only "contract" document needed is the updated function signatures.

### Quickstart

See [quickstart.md](quickstart.md).

---

## Implementation Blueprint

> This section is the detailed, task-ready breakdown for `/speckit.tasks`. It specifies exactly what to change, in what order, and what the tests must prove.

### Task Group 1 — Signature Refactor: `ComputeAmountSequence`

**File**: `core-engine/domain/config/sequences.go`

**Change**: Add `dynamicBalance decimal.Decimal` as the sole new parameter to `ComputeAmountSequence`. This is the only source-of-truth change.

**Before** (current signature):
```go
func (c *Config) ComputeAmountSequence() (AmountSequence, error)
```

**After** (new signature):
```go
func (c *Config) ComputeAmountSequence(dynamicBalance decimal.Decimal) (AmountSequence, error)
```

**Logic changes inside the function** (the percentage branch only):

```
// BEFORE (reads static config balance):
if apt.LessThanOrEqual(one) {
    V = c.accountBalance.Mul(apt).Mul(m)
}

// AFTER (uses dynamic balance, with guard):
if apt.LessThanOrEqual(one) {
    if dynamicBalance.LessThanOrEqual(decimal.Zero) {
        return nil, &SequenceComputationError{
            Sequence: "amount",
            Message:  "dynamicBalance must be > 0 for percentage-mode AmountPerTrade, got " + dynamicBalance.String(),
        }
    }
    V = dynamicBalance.Mul(apt).Mul(m)
}
// absolute branch: unchanged — V = apt.Mul(m)
```

The rest of the function body (R calculation, D_n distribution, sum invariant adjustment) is **unchanged**.

**`slog.Debug` log line** — update the `"account_balance"` field to log both:
```go
"static_account_balance", c.accountBalance,
"dynamic_balance",        dynamicBalance,
```

---

### Task Group 2 — Thread Through: `ComputeBaseQuantities`

**File**: `core-engine/domain/config/sequences.go`

**Change**: `ComputeBaseQuantities` calls `ComputeAmountSequence()` internally. Its signature must accept and propagate `dynamicBalance`.

**Before**:
```go
func (c *Config) ComputeBaseQuantities(prices PriceSequence) (AmountSequence, error) {
    ...
    dollarsSeq, err := c.ComputeAmountSequence()
```

**After**:
```go
func (c *Config) ComputeBaseQuantities(dynamicBalance decimal.Decimal, prices PriceSequence) (AmountSequence, error) {
    ...
    dollarsSeq, err := c.ComputeAmountSequence(dynamicBalance)
```

No other changes inside the function body.

---

### Task Group 3 — Call Site Update: Orchestrator

**File**: `core-engine/application/orchestrator/orchestrator.go`

**Single change** — the one call to `ComputeAmountSequence`:

**Before**:
```go
usdtAmounts, amountErr := orch.config.DomainConfig.ComputeAmountSequence()
```

**After**:
```go
usdtAmounts, amountErr := orch.config.DomainConfig.ComputeAmountSequence(orch.runningBalance)
```

`orch.runningBalance` is already available at this point in the loop. It is initialised to `orch.config.DomainConfig.AccountBalance()` on backtest start (line 80 of orchestrator.go), then compounded forward by monthly additions and realized profits. It is always a valid positive `decimal.Decimal` for any live backtest — the guard in `ComputeAmountSequence` handles the edge case where a sequence of losses has reduced it to zero or below.

No other changes in orchestrator.go.

---

### Task Group 4 — Test Call Site Updates: Existing Tests

**File**: `core-engine/domain/config/sequences_test.go`

**All existing calls** to `ComputeAmountSequence()` use absolute `amountPerTrade > 1.0`. For these, `dynamicBalance` is mathematically irrelevant (the absolute branch ignores it). Pass `decimal.Zero` at every call site. This communicates intent: "balance is intentionally not relevant here".

| Test | Current call | Updated call | Why |
|---|---|---|---|
| T052 `TestUS3_CanonicalAmountSequence` | `cfg.ComputeAmountSequence()` | `cfg.ComputeAmountSequence(decimal.Zero)` | apt=1000 (absolute) |
| T053 `TestUS3_SumInvariant` | `cfg.ComputeAmountSequence()` | `cfg.ComputeAmountSequence(decimal.Zero)` | all apt > 1.0 |
| T054 `TestUS3_NormalizationFactorR` | `cfg.ComputeAmountSequence()` | `cfg.ComputeAmountSequence(decimal.Zero)` | apt=7 (absolute) |
| T055 `TestUS3_MultiplierScalesAmounts` | `cfgM1.ComputeAmountSequence()` / `cfgM2.ComputeAmountSequence()` | `(decimal.Zero)` at each | apt=1000 (absolute) |
| T056 `TestUS3_AmountsGeometricOrdering` | `cfg.ComputeAmountSequence()` | `cfg.ComputeAmountSequence(decimal.Zero)` | apt=1000 |
| T057 `TestUS3_UniformDistribution_ScaleOne` | `cfg.ComputeAmountSequence()` | `cfg.ComputeAmountSequence(decimal.Zero)` | apt=300 |
| T058 `TestUS3_FractionalAmountPerTradeScaledByBalance` | `cfg.ComputeAmountSequence()` | `cfg.ComputeAmountSequence(mustDecimal("1000"))` | apt=0.5, must pass explicit 1000 to replicate previous implicit behavior |
| T059 `TestUS3_SingleOrderReturnsTotal` | `cfg.ComputeAmountSequence()` | `cfg.ComputeAmountSequence(decimal.Zero)` | apt=1000 |
| T060 `TestUS3_AcceptanceScenario1_ExactAmounts` | `cfg.ComputeAmountSequence()` | `cfg.ComputeAmountSequence(decimal.Zero)` | apt=1000 |
| T061 `TestUS3_AcceptanceScenario2_SumPreservation` | `cfg.ComputeAmountSequence()` | `cfg.ComputeAmountSequence(decimal.Zero)` | all apt > 1.0 |

---

### Task Group 5 — New Tests: Feature 013 Acceptance Scenarios

**File**: `core-engine/domain/config/sequences_test.go`

Add the following new tests, keyed to the spec's Canonical Test Data table and Acceptance Scenarios. Tests are numbered starting at **T062** (next after T061):

#### T062 — US1 AS1: Percentage allocation uses dynamicBalance, not static config balance

```
Name: TestTS013_US1_PercentageUsesdynamicBalance
apt=1.0, sa=1.0, m=1, N=1, staticConfigBalance=1000, dynamicBalance=5000
Call: cfg.ComputeAmountSequence(mustDecimal("5000"))
Assert: sum == 5000.00000000
Assert: sum != 1000.00000000  (proves static balance is NOT used)
```

#### T063 — US1 AS2: 50% allocation against grown balance

```
Name: TestTS013_US1_HalfPercentageOfGrownBalance
apt=0.5, sa=1.0, m=1, N=1, dynamicBalance=4000
Call: cfg.ComputeAmountSequence(mustDecimal("4000"))
Assert: sum == 2000.00000000
```

#### T064 — US1 AS3: Percentage × Multiplier

```
Name: TestTS013_US1_PercentageWithMultiplier
apt=1.0, sa=1.0, m=3, N=1, dynamicBalance=5000
Call: cfg.ComputeAmountSequence(mustDecimal("5000"))
Assert: sum == 15000.00000000
```

#### T065 — US2 AS1: Absolute amount is independent of dynamicBalance

```
Name: TestTS013_US2_AbsoluteIgnoresBalance
apt=500, sa=1.0, m=1, N=1, dynamicBalance=50000
Call: cfg.ComputeAmountSequence(mustDecimal("50000"))
Assert: sum == 500.00000000
```

#### T066 — US2 AS2: Absolute × Multiplier

```
Name: TestTS013_US2_AbsoluteWithMultiplier
apt=500, sa=1.0, m=2, N=1, dynamicBalance=50000
Call: cfg.ComputeAmountSequence(mustDecimal("50000"))
Assert: sum == 1000.00000000
```

#### T067 — US2 AS3: Absolute unchanged even when balance < absolute amount

```
Name: TestTS013_US2_AbsoluteWhenBalanceBelowFloor
apt=500, sa=1.0, m=1, N=1, dynamicBalance=400
Call: cfg.ComputeAmountSequence(mustDecimal("400"))
Assert: sum == 500.00000000 (absolute floor, no clamping)
```

#### T068 — US3 Boundary: apt = 1.0 exactly → percentage mode

```
Name: TestTS013_US3_BoundaryExactlyOneIsPercentage
apt=1.0, sa=1.0, m=1, N=1, dynamicBalance=2000
Call: cfg.ComputeAmountSequence(mustDecimal("2000"))
Assert: sum == 2000.00000000
```

#### T069 — US3 Boundary: apt = 1.01 → absolute mode

```
Name: TestTS013_US3_BoundaryAboveOneIsAbsolute
apt=1.01, sa=1.0, m=1, N=1, dynamicBalance=2000
Call: cfg.ComputeAmountSequence(mustDecimal("2000"))
Assert: sum == 1.01000000 (absolute 1.01 USDT, balance ignored)
```

#### T070 — FR-005: Zero balance + percentage → `SequenceComputationError`

```
Name: TestTS013_FR005_ZeroBalanceReturnsError
apt=1.0, dynamicBalance=0
Call: cfg.ComputeAmountSequence(decimal.Zero)
Assert: err != nil
Assert: err is *SequenceComputationError
```

#### T071 — FR-005: Negative balance + percentage → `SequenceComputationError`

```
Name: TestTS013_FR005_NegativeBalanceReturnsError
apt=0.5, dynamicBalance=-100
Call: cfg.ComputeAmountSequence(mustDecimal("-100"))
Assert: err != nil
Assert: err is *SequenceComputationError
```

#### T072 — FR-006: Sum invariant preserved with dynamicBalance (geometric N=10)

```
Name: TestTS013_FR006_SumInvariantPreservedWithDynamicBalance
apt=1.0, sa=2.0, m=1, N=10, dynamicBalance=5000
Call: cfg.ComputeAmountSequence(mustDecimal("5000"))
Assert: sum == 5000.00000000 (last-order adjustment still fires correctly)
```

#### T073 — Orchestrator integration: second trade in compounding sequence uses grown balance

```
Name: TestTS013_OrchestratorCompoundingIntegration
This is a higher-level integration test in the orchestrator package.
Set up a two-trade backtest where:
  - initialBalance = "1000", amt_per_trade = "1.0", multiplier = 1
  - Trade 1 closes with profit "4000" (so runningBalance becomes "5000")
  - Trade 2 opens
Assert: The amounts slice passed to NewPosition on Trade 2 sums to "5000.00000000"
Assert: The amounts slice passed to NewPosition on Trade 1 sums to "1000.00000000"
File: core-engine/application/orchestrator/orchestrator_integration_test.go (new or existing)
```

---

## Dependency & Sequencing Map

```
Task Group 1 (sequences.go — ComputeAmountSequence)
       │
       ├── Task Group 2 (sequences.go — ComputeBaseQuantities)  [no dependents today]
       │
       ├── Task Group 3 (orchestrator.go — call site)           [compiles after TG1]
       │
       └── Task Group 4 (sequences_test.go — existing tests)    [compiles after TG1]
                  │
                  └── Task Group 5 (sequences_test.go — new tests)  [written RED first, then GREEN via TG1]
```

Implementation order: TG1 → TG2 (can be parallel with TG3/TG4 once TG1 compiles) → TG5.

TG4 and TG5 should be applied in the **same commit** as TG1 so the repo never has a broken build state. The recommended commit strategy is:

1. Apply TG1 + TG2 + TG3 + TG4 together (all old call sites updated, compilation restored)
2. Apply TG5 RED (new tests fail because logic not yet updated — this is the TDD red state)
3. TG5 GREEN is achieved by the same TG1 change already applied

In practice for code review, TG1 through TG5 are a single atomic PR.

---

## Re-evaluation: Constitution Check (Post-Design)

| Gate | Status | Notes |
|---|---|---|
| No Live Trading | PASS | Unchanged — simulation only |
| Green Light Protocol | PASS | Exactly 3 existing call sites updated (T052–T061 in sequences_test.go, 1 in orchestrator.go). No other call sites exist (`ComputeBaseQuantities` has zero external callers today). Compilation is restored atomically. |
| Fixed-point Arithmetic | PASS | `dynamicBalance decimal.Decimal` is passed through unchanged. All arithmetic in the function body remains shopspring/decimal. |
| Single-position Invariant | PASS — Not Affected | PSM not touched |
| Sum Invariant (FR-006) | PASS | The last-element adjustment `seq[n-1] = seq[n-1].Add(diff)` at the end of `ComputeAmountSequence` operates on `V` regardless of how `V` was computed. T072 explicitly proves this still holds when `V` comes from a dynamic balance. |

