# Research: Spot Trading Liquidation Bypass (Multiplier = 1)

**Branch**: `014-spot-no-liquidation` | **Date**: 2026-03-23

## Status: COMPLETE — All unknowns resolved from source inspection.

No external research was required. All decisions were derived by reading the existing Go source in `core-engine/domain/position/` and `core-engine/application/orchestrator/`.

---

## Finding 1 — Root Cause Location

**Question**: Where exactly is the bug?

**Answer**: Two locations in `minute_loop.go`:

1. **Step 2 (market open)**: `LiquidationPrice` is not explicitly set. It starts at `0` from `NewPosition`, which is correct. However, it is not *locked* at `0` for spot — a future code change could accidentally set it. The plan adds an explicit defensive guard.

2. **Step 3b (after safety order fill)** — **this is the primary bug**:
   ```go
   if !pos.AverageEntryPrice.IsZero() {
       half, _ := decimal.NewFromString("0.5")
       pos.LiquidationPrice = pos.AverageEntryPrice.Mul(half)
   }
   ```
   This runs unconditionally for every position on every safety order fill, regardless of `Multiplier`. The result is that after the first safety order fills, every position — including spot — has a non-zero `LiquidationPrice` equal to 50% of its average entry. Step 3c then fires in subsequent candles when `low` breaches that 50% threshold.

3. **Step 3c** is NOT a bug — it correctly guards: `if !pos.LiquidationPrice.IsZero() && CheckLiquidation(...)`. The guard works. The problem is that `LiquidationPrice` is never zero by the time Step 3c runs on the second candle after a safety order fill.

---

## Finding 2 — `Position.Multiplier` Field is Missing

**Question**: Where does `Multiplier` live and how does it reach the PSM?

**Answer**: `Config.Multiplier()` (getter at `config.go` line 197) exposes the value. However, `Position` struct has no `Multiplier` field. The orchestrator hydrates several config values onto position at creation time:

```go
newPos.TakeProfitDistance = orch.config.DomainConfig.TakeProfitDistancePercent()
newPos.AccountBalance = orch.runningBalance
newPos.ExitOnLastOrder = orch.config.DomainConfig.ExitOnLastOrder()
```

`Multiplier` is missing from this block. This follows the exact same pattern — it is a one-line addition: `newPos.Multiplier = orch.config.DomainConfig.Multiplier()`.

---

## Finding 3 — `liquidation.go` Is Already Correct, Just Unwired

**Question**: Does the existing `CalculateLiquidationPrice` function support the spot bypass?

**Answer**: Yes. The function already has:

```go
func CalculateLiquidationPrice(..., isSpot bool) decimal.Decimal {
    if isSpot || positionQuantity.IsZero() {
        return decimal.NewFromInt(0)
    }
    // ...
}
```

And `CheckLiquidation` also short-circuits on zero:

```go
func CheckLiquidation(ctx context.Context, lowPrice, liquidationPrice decimal.Decimal) bool {
    if liquidationPrice.IsZero() {
        return false
    }
    return lowPrice.LessThanOrEqual(liquidationPrice)
}
```

Neither function needs to change. The only problem is that Step 3b bypasses these functions entirely with a hardcoded inline formula.

---

## Finding 4 — `Config.DefaultMultiplier = decimal.NewFromInt(1)`

**Question**: What is the default multiplier? Would existing tests be affected by the new spot guard?

**Answer**: `DefaultMultiplier = decimal.NewFromInt(1)` (from `config.go`). This means existing tests that create positions through the orchestrator with default config will have `Multiplier = 1` after Task Group 3. However, existing tests in `minute_loop_test.go` and `position_test.go` create `Position` objects directly via `NewPosition(...)` without going through the orchestrator — they never set `pos.Multiplier`. The `decimal.Decimal` zero value means `pos.Multiplier` will be `0`, not `1`.

`decimal.Zero.Equal(decimal.NewFromInt(1))` is `false`. Therefore existing direct-construction tests will hit the `else if` branch (futures path) — same as before. **No regressions.**

Only tests that explicitly set `pos.Multiplier = decimal.NewFromInt(1)` will enter the spot bypass path. These are the three new tests in Task Group 6.

---

## Finding 5 — `LiquidationPriceUpdatedEvent` Compatibility

**Question**: Does emitting `LiquidationPrice = "0"` for spot positions break any downstream consumer?

**Answer**: No. The `LiquidationPriceUpdatedEvent` already carries it as a `string`:
```go
LiquidationPrice string `json:"liquidation_price"` // Decimal as string
```

Emitting `"0"` is valid. The API layer and frontend both handle `liquidation_price = 0` as "no threshold" — confirmed by reading the existing event schema. The event is still emitted for spot positions (it is part of the buy-order fill reporting sequence); it will simply carry `"0"`.

---

## Decisions Summary

| Decision | Choice | Rejected Alternative |
|---|---|---|
| Guard placement | Step 3b assignment | Adding guard in `CheckLiquidation` (treats symptom) |
| `Multiplier` carrier | New `Position.Multiplier` field | Injecting `Config` into `StateMachine` (violates Clean Architecture) |
| Futures formula | Preserve existing `half` proxy | Replace with canonical SDD § 2.5 formula (out of scope; separate feature) |
| Multiplier equality | `pos.Multiplier.Equal(decimal.NewFromInt(1))` | `pos.Multiplier.IntPart() == 1` (unsafe: truncates 1.5 → 1) |
| Test file | New `spot_liquidation_test.go` | Adding to `minute_loop_test.go` (dilutes spec traceability) |
