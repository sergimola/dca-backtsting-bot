# Quickstart: Spot Trading Liquidation Bypass (Multiplier = 1)

**Branch**: `014-spot-no-liquidation`

## Prerequisites

- Go 1.22+ installed (verify: `go version`)
- Working in the `core-engine/` directory
- All existing tests passing (Green Light pre-check)

## Development Environment

```powershell
# From workspace root:
cd core-engine

# Verify baseline (all tests must pass before starting)
go test ./... -count=1

# Build to verify compilation
go build ./...
```

## Running the New Tests

```powershell
# Run only the new spot liquidation tests
go test ./domain/position/ -run TestTS014 -v

# Run all position domain tests
go test ./domain/position/ -v

# Run full suite
go test ./... -count=1
```

## Files to Edit

| File | Location | Action |
|---|---|---|
| `position.go` | `domain/position/position.go` | Add `Multiplier decimal.Decimal` field |
| `minute_loop.go` | `domain/position/minute_loop.go` | Add spot guards in Step 2 and Step 3b |
| `orchestrator.go` | `application/orchestrator/orchestrator.go` | Wire `newPos.Multiplier = config.Multiplier()` |
| `spot_liquidation_test.go` | `domain/position/spot_liquidation_test.go` | Create with 3 test functions |

## TDD Workflow

1. Create `spot_liquidation_test.go` with the three test skeletons (failing).
2. Run `go test ./domain/position/ -run TestTS014 -v` → expect 3 FAIL (RED phase).
3. Apply Task Groups 2–5 (struct + orchestrator + minute_loop changes).
4. Run tests again → expect 3 PASS (GREEN phase).
5. Run full suite `go test ./... -count=1` → confirm zero regressions.

## Verifying Correct Behaviour Manually

To verify the fix end-to-end with a real backtest, run the engine binary with `multiplier: 1` and a dataset that previously triggered premature liquidation:

```powershell
# From workspace root, rebuild the engine:
cd core-engine
go build -o "../orchestrator/api/core-engine.exe" ./cmd/engine/

# Then start the API and run a backtest via the UI or via curl
# A spot backtest where the price drops >50% should no longer liquidate
```
