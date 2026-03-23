# Quickstart: PSM Dynamic Trade Sizing from Compounding Balance

**Feature**: 013-psm-dynamic-trade-size  
**Purpose**: Developer onboarding for implementing this feature

---

## What changed and why

The backtest Orchestrator already tracks a compounding `runningBalance` (Feature 012). But the grid sizing function `ComputeAmountSequence` was reading the static initial `accountBalance` from the config for the percentage-allocation branch, ignoring the live balance entirely. This feature corrects that.

## Scope

Three files. No new files need to be created.

| File | Change type |
|---|---|
| `core-engine/domain/config/sequences.go` | Signature + logic change |
| `core-engine/application/orchestrator/orchestrator.go` | Call site update |
| `core-engine/domain/config/sequences_test.go` | Call site updates + new tests |

## Step-by-step

### 1. Update `ComputeAmountSequence` in `sequences.go`

Add `dynamicBalance decimal.Decimal` as the first argument. In the percentage branch, replace `c.accountBalance` with `dynamicBalance`. Add the zero-balance guard before `V` is computed. See [plan.md: Task Group 1](plan.md) for the exact before/after.

### 2. Update `ComputeBaseQuantities` in `sequences.go`

Add `dynamicBalance decimal.Decimal` as the first argument. Pass it through to `ComputeAmountSequence`. See [plan.md: Task Group 2](plan.md).

### 3. Update the Orchestrator call site in `orchestrator.go`

Change the one call:
```go
// Before
orch.config.DomainConfig.ComputeAmountSequence()

// After
orch.config.DomainConfig.ComputeAmountSequence(orch.runningBalance)
```

`orch.runningBalance` is already in scope at that point in the loop.

### 4. Update existing test call sites in `sequences_test.go`

Every `cfg.ComputeAmountSequence()` in T052–T061 becomes `cfg.ComputeAmountSequence(decimal.Zero)` for absolute-amount tests (i.e., `amountPerTrade > 1.0`). T058 (percentage test) gets `cfg.ComputeAmountSequence(mustDecimal("1000"))`.

### 5. Add new tests T062–T073

Add the new tests described in [plan.md: Task Group 5](plan.md). Write them first (RED), then verify they pass (GREEN) with the changes from steps 1–4.

## Verify

```powershell
cd "D:\personal\bot-dca\dca-bot\DCA Backtesting bot\core-engine"
go test ./domain/config/... -v -run "TestUS3|TestTS013"
go test ./application/orchestrator/...
go test ./... 2>&1 | Select-String FAIL
```

All tests must pass. Confirm no test output contains `FAIL`.

## Key invariants to keep

- `sum(D_n) == V` — the last-element adjustment at the end of `ComputeAmountSequence` must not break. T072 directly tests this with a geometric 10-order sequence.
- `c.accountBalance` **must not be mutated**. It stays as the static starting seed.
- The absolute branch (`amountPerTrade > 1.0`) must produce the same output regardless of what `dynamicBalance` is passed. T065 and T067 test this.
