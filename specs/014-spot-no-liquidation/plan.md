# Implementation Plan: Spot Trading Liquidation Bypass (Multiplier = 1)

**Branch**: `014-spot-no-liquidation` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/014-spot-no-liquidation/spec.md`

## Summary

When `Multiplier = 1` is configured, the backtest simulates **spot trading** — the user holds the asset outright with no borrowed capital, so liquidation is financially impossible. The engine currently applies a futures-style liquidation formula to every position regardless of leverage, causing spot backtests to terminate prematurely with an incorrect total loss.

The root cause is a two-part wiring gap in the Go core-engine domain:

1. **`Position` struct has no `Multiplier` field.** The `Config.Multiplier()` value is available but is never copied onto the position object at creation time, so the PSM state machine has no access to it.
2. **`minute_loop.go` Step 3b uses a hardcoded 50% formula** (`pos.LiquidationPrice = pos.AverageEntryPrice.Mul(half)`) regardless of leverage. This overrides the zero value that `NewPosition` correctly initialises, producing a non-zero liquidation price on every first safety order fill — which then triggers the Step 3c check on subsequent candles.

The fix is a targeted four-file change confined to the Go domain and its test suite:

1. **`position.go`** — Add `Multiplier decimal.Decimal` field to the `Position` struct.
2. **`orchestrator.go`** — Copy `DomainConfig.Multiplier()` onto the new position at creation time (alongside the existing `TakeProfitDistance`, `AccountBalance`, and `ExitOnLastOrder` assignments).
3. **`minute_loop.go`** — In Step 3b, replace the hardcoded `half` formula with a guard: when `pos.Multiplier.Equal(decimal.NewFromInt(1))` set `pos.LiquidationPrice = decimal.Zero`, else call `CalculateLiquidationPrice` (already in `liquidation.go` with the correct `isSpot` parameter path). Also ensure Step 2 (market open) explicitly keeps `LiquidationPrice` at zero for spot positions.
4. **`spot_liquidation_test.go`** (new file in `domain/position`) — Three new test functions covering the three spec acceptance scenarios.

No changes are required to `liquidation.go` (its `isSpot bool` path already does the right thing), the TypeScript orchestrator layer, the API, or the frontend.

## Technical Context

**Language/Version**: Go 1.22 (core-engine module)
**Primary Dependencies**: `github.com/shopspring/decimal` (fixed-point arithmetic)
**Storage**: N/A — pure in-memory domain computation; no persistence changes
**Testing**: `go test ./...` from `core-engine/`
**Target Platform**: Linux/Windows (CI + developer machine)
**Project Type**: Domain library (core-engine)
**Performance Goals**: No change — this is a guard clause addition, not a hot-path restructure
**Constraints**: All monetary math via `decimal.Decimal`; zero float usage; Step 3b recalculation must still fire `BuyOrderExecutedEvent` and `LiquidationPriceUpdatedEvent` for futures positions exactly as before
**Scale/Scope**: 4 files touched (3 modified, 1 created); ~80 lines changed/added across implementation and tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Gate | Status | Evidence |
|---|---|---|
| No Live Trading | PASS | Feature touches only the backtest simulation engine. No live order routing exists or is modified. |
| Green Light Protocol | PASS (conditional) | All existing `go test ./...` must be green before implementation begins. The `Multiplier` field addition in `Position` is additive and breaks no existing call sites. The orchestrator change is a single line addition. No existing test uses `Multiplier` on `Position`. |
| Fixed-point Arithmetic | PASS | `pos.Multiplier` and `decimal.NewFromInt(1)` equality check uses shopspring/decimal comparison. `pos.LiquidationPrice = decimal.Zero` uses `decimal.Zero` (not `0.0`). No floats introduced. |
| Single-position Invariant | PASS — Not Affected | `NewPosition` signature is unchanged. State transitions (Idle → Opening → SafetyOrderWait → Closed) are unmodified. The feature only controls whether `LiquidationPrice` is zero or non-zero, which already exists as a field. |
| Gap-Down Execution Rule | PASS — Not Affected | `order_fills.go` and the Step 3a buy-check in `minute_loop.go` are not touched. |
| Pessimistic Order (Buy → Liq → TP) | PASS — Maintained | Step 3b guard for spot only prevents the *assignment* of a non-zero `LiquidationPrice`. Step 3c (`!pos.LiquidationPrice.IsZero() && CheckLiquidation(...)`) still runs in correct order; it simply exits the `if` immediately for spot because the first condition is false. |
| BDD Acceptance Criteria | PASS | spec.md contains Given/When/Then for all three user stories. New tests are explicitly named after spec scenarios (TS014_US1, TS014_US2, TS014_US3). |
| TDD | PASS | Test file is written before implementation passes (RED first). Test names map precisely to spec Acceptance Scenarios and Canonical Test Data table rows. |

## Project Structure

### Documentation (this feature)

```text
specs/014-spot-no-liquidation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (internal-only; no external interface change)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (Feature Placement: core-engine only)

This feature is **100% core-engine domain**. No TypeScript, API, or frontend files are modified.

```text
core-engine/
├── domain/position/
│   ├── position.go                  ← MODIFIED: add Multiplier field to Position struct
│   ├── minute_loop.go               ← MODIFIED: Step 2 + Step 3b liquidation price guards
│   └── spot_liquidation_test.go     ← NEW: TS014_US1, TS014_US2, TS014_US3 tests
└── application/orchestrator/
    └── orchestrator.go              ← MODIFIED: copy Multiplier onto new positions
```

`liquidation.go` is **read-only** for this feature — its `CalculateLiquidationPrice(..., isSpot bool)` already handles the zero-return case correctly. It is the reference implementation but does not need to change.

## Complexity Tracking

No constitution violations. No new abstractions, interfaces, events, or state transitions introduced. The change is a narrowly-scoped guard clause and a single new struct field.

---

## Phase 0: Research

> Status: COMPLETE — no unknowns remain from Technical Context. All required facts were determined by reading the existing source in a single pass.

### Findings & Decisions

**Decision 1 — Guard placement (Step 3b, not `CheckLiquidation`)**

The bypass guard belongs in `minute_loop.go` Step 3b, where `LiquidationPrice` is *assigned* after a safety order fill. It must not be placed inside `CheckLiquidation` or `CalculateLiquidationPrice` because those functions are already correct and already have `isSpot` support. The bug is upstream: Step 3b overwrites `LiquidationPrice` with a hardcoded formula before `CheckLiquidation` ever sees it.

The fix at Step 3b means `pos.LiquidationPrice` is permanently `0` for spot throughout the position's entire lifecycle. This is the single authoritative fix point. Step 3c (`!pos.LiquidationPrice.IsZero()`) then naturally skips liquidation evaluation for free.

Alternatives considered and rejected:
- *Add guard in `CheckLiquidation`*: Rejected — `CheckLiquidation` already returns `false` for zero price. The problem is that `LiquidationPrice` is never zero when it reaches Step 3c, so adding another guard there treats the symptom, not the cause.
- *Add `isSpot` parameter to `ProcessCandle`*: Rejected — creates an API surface change on `PositionStateMachine` interface without benefit. The position already owns its configuration; `Multiplier` belongs on `Position`.
- *Check multiplier from `Config` directly inside the PSM*: Rejected — the PSM is a domain object with no dependency on `Config`. Injecting `Config` into `StateMachine` would violate Clean Architecture. The correct contract is `Position` carries its own configuration-derived invariants (matching the existing pattern: `TakeProfitDistance`, `ExitOnLastOrder`, `AccountBalance` are all copied onto `Position` by the orchestrator).

**Decision 2 — Multiplier equality check**

Use `pos.Multiplier.Equal(decimal.NewFromInt(1))` (shopspring/decimal method) rather than `pos.Multiplier.Cmp(decimal.NewFromInt(1)) == 0` for readability. Both are equivalent. Do NOT use `pos.Multiplier.IntPart() == 1` — that would incorrectly bypass for `Multiplier = 1.5` since `IntPart()` truncates.

**Decision 3 — Liquidation price formula for futures (Step 3b non-spot path)**

The current code uses `pos.LiquidationPrice = pos.AverageEntryPrice.Mul(half)` — a hardcoded 50% proxy. The `CalculateLiquidationPrice` function in `liquidation.go` implements the canonical formula from SDD § 2.5: `P_liq = (M - Q·P̄) / (Q·(mmr-1))`. However, the `maintenanceMarginRatio` (`mmr`) is not currently stored on `Position`. To keep this feature's scope strictly bounded to the spot bypass (FR-001 through FR-007), this plan does NOT fix the hardcoded futures formula. The non-spot path retains the existing `half`-formula behaviour for compatibility with the existing test suite. A future feature can replace it with the full canonical formula. This is explicitly noted as out-of-scope in the spec's Assumptions section.

**Decision 4 — Where to add new tests**

A new file `spot_liquidation_test.go` in `domain/position` (same package identifier `package position`) keeps the spec-driven tests isolated from the existing lifecycle tests in `minute_loop_test.go` and `position_test.go`. This is the pattern established by `invariant_test.go`, `gap_down_test.go`, and `reentry_test.go` in the same directory.

---

## Phase 1: Design & Contracts

### data-model.md

See [data-model.md](data-model.md).

The only domain entity change is:

- **`Position`** struct gains one new field: `Multiplier decimal.Decimal`. This is a configuration-derived invariant set once at position creation, never mutated thereafter. Its value directly matches `Config.Multiplier()` from the domain config.

No new events are added. `LiquidationPriceUpdatedEvent` still fires for futures positions (Multiplier > 1) after every safety order fill. For spot positions (Multiplier = 1), its `LiquidationPrice` field will always be `"0"` — downstream consumers already handle zero correctly (the API and frontend treat `liquidation_price = 0` as "no threshold").

### Interface Contracts

See [contracts/](contracts/).

No external interface (HTTP, CLI, CSV schema) is modified. The only "contract" change is the `Position` struct gaining a new exported field (`Multiplier`). This is backwards-additive for all consumers (the orchestrator, the API serialiser, and any tests). The field has a zero-value default of `decimal.Zero`, which is safe — a position for which the orchestrator failed to set `Multiplier` will have `Multiplier = 0`, which is not equal to `1`, so the spot bypass will not trigger. This is a safe-fail default.

### Quickstart

See [quickstart.md](quickstart.md).

---

## Implementation Blueprint

> This section is the detailed, task-ready breakdown for `/speckit.tasks`. It specifies exactly what to change, in what order, and what the tests must prove.

---

### Task Group 1 — Baseline: Green Light Pre-Check

**File**: N/A (terminal command only)

Before any code is written, the entire existing test suite must be green:

```
cd core-engine && go test ./... -count=1
```

All tests must PASS. If any fail, those failures must be resolved before feature work begins (Green Light Protocol). Record the exact pass count as the baseline for regression verification at the end.

---

### Task Group 2 — Add `Multiplier` Field to `Position` Struct

**File**: `core-engine/domain/position/position.go`

**Change**: Add a single new exported field to the `Position` struct, in the "Exit strategy" or "Configuration" group — logically near `ExitOnLastOrder` and `TakeProfitDistance`, which are both configuration-derived invariants.

**Before** (existing field block, abbreviated):
```go
// Exit strategy (US6: Early Exit on Last Order Fill)
ExitOnLastOrder   bool            // If true, close position immediately when last order fills

// Take-profit configuration
TakeProfitDistance decimal.Decimal
```

**After**:
```go
// Exit strategy (US6: Early Exit on Last Order Fill)
ExitOnLastOrder   bool            // If true, close position immediately when last order fills

// Leverage configuration (set from domain config at position open)
// Multiplier = 1 means spot trading: no liquidation price is calculated or checked.
// Multiplier > 1 means futures/margin: liquidation price is computed and enforced.
Multiplier        decimal.Decimal

// Take-profit configuration
TakeProfitDistance decimal.Decimal
```

**`NewPosition` function**: No change required. `decimal.Decimal` zero-value default is `0`, not `1`. The orchestrator is responsible for setting this field (Task Group 3). No test constructs positions with a non-zero multiplier before Task Group 3.

**Verification**: `go build ./domain/position/` must pass with zero errors.

---

### Task Group 3 — Wire Multiplier in Orchestrator

**File**: `core-engine/application/orchestrator/orchestrator.go`

**Change**: Add one line to the block where configuration-derived fields are copied onto a new position. This block already sets `TakeProfitDistance`, `AccountBalance`, and `ExitOnLastOrder`.

**Before** (existing block ~line 241):
```go
if orch.config.DomainConfig != nil {
    newPos.TakeProfitDistance = orch.config.DomainConfig.TakeProfitDistancePercent()
    newPos.AccountBalance = orch.runningBalance
    newPos.ExitOnLastOrder = orch.config.DomainConfig.ExitOnLastOrder()
}
```

**After**:
```go
if orch.config.DomainConfig != nil {
    newPos.TakeProfitDistance = orch.config.DomainConfig.TakeProfitDistancePercent()
    newPos.AccountBalance = orch.runningBalance
    newPos.ExitOnLastOrder = orch.config.DomainConfig.ExitOnLastOrder()
    newPos.Multiplier = orch.config.DomainConfig.Multiplier()
}
```

**Rationale**: `Config.Multiplier()` getter already exists (line 197 of `config.go`). This is a single-line, zero-risk addition that follows the established `Config → Position` hydration pattern.

**Verification**: `go build ./application/orchestrator/` must pass.

---

### Task Group 4 — Fix Step 2: Explicit Spot Guard at Market Open

**File**: `core-engine/domain/position/minute_loop.go`

**Location**: Step 2 of `ProcessCandle` — immediately after the initial market buy block sets `pos.AverageEntryPrice` and transitions to `StateOpening`.

**Purpose**: Defensive; ensures that even before any safety order fills, a spot position has `LiquidationPrice = 0`. In the current code, `NewPosition` already initialises it to zero (the `decimal.Decimal` zero value), so this step is technically redundant. However, making the intent explicit here prevents future regressions from any code that might attempt to set `LiquidationPrice` during the opening fill.

**Change**: After the `TradeOpenedEvent` is built and appended:

```go
// Spot bypass (FR-001): for Multiplier = 1, liquidation price is always 0.
// For futures (Multiplier > 1), the initial LiquidationPrice will be computed
// in Step 3b when the first safety order fills (using the half-formula proxy).
if pos.Multiplier.Equal(decimal.NewFromInt(1)) {
    pos.LiquidationPrice = decimal.Zero
}
```

This block is placed at the end of the `if pos.State == StateIdle { ... }` branch, after `events = append(events, tradeOpenedEvent)`.

**Verification**: Existing `TestUS1_T025_IdlePositionFirstCandle` and `TestUS1_T047_FullPositionLifecycle` must still pass.

---

### Task Group 5 — Fix Step 3b: Spot Guard After Safety Order Fills

**File**: `core-engine/domain/position/minute_loop.go`

**Location**: Step 3b — immediately after `pos.AverageEntryPrice = CalculateAverageEntryPrice(pos.Orders)` and the closing of the `if len(filledOrders) > 0 {` block, specifically the liquidation price recalculation segment.

**This is the primary bug fix.** The existing code:

```go
// Recalculate liquidation price (simplified for testing)
// CRITICAL ASSERTION: This must happen BEFORE Step 3c liquidation check
if !pos.AverageEntryPrice.IsZero() {
    half, _ := decimal.NewFromString("0.5")
    pos.LiquidationPrice = pos.AverageEntryPrice.Mul(half)
}
```

**Must be replaced with**:

```go
// Recalculate liquidation price.
// SPOT BYPASS (FR-002, FR-003): For Multiplier = 1 (spot trading), liquidation
// price is permanently 0. No formula is evaluated. This prevents the Step 3c
// check from ever firing for spot positions.
// For futures (Multiplier > 1), the simplified half-formula proxy is retained.
// CRITICAL ASSERTION: This recalculation must happen BEFORE Step 3c (T055).
if pos.Multiplier.Equal(decimal.NewFromInt(1)) {
    pos.LiquidationPrice = decimal.Zero
} else if !pos.AverageEntryPrice.IsZero() {
    half, _ := decimal.NewFromString("0.5")
    pos.LiquidationPrice = pos.AverageEntryPrice.Mul(half)
}
```

**Why this is the correct and sufficient fix**: After this change, `pos.LiquidationPrice` is always `0` throughout the spot position's lifecycle. Step 3c (`if !pos.LiquidationPrice.IsZero() && CheckLiquidation(...)`) evaluates the first condition as `false` and short-circuits — `CheckLiquidation` is never called. No `LiquidationEvent` is ever emitted. The position survives indefinitely until TP, trailing stop, or `exit_on_last_order`.

**Futures non-regression**: The `else if` branch preserves the exact existing behaviour for `Multiplier > 1` positions — the same `half` formula, the same `!IsZero()` guard.

**Event emission unchanged**: `BuyOrderExecutedEvent.LiquidationPrice` and `LiquidationPriceUpdatedEvent.LiquidationPrice` will now serialize as `"0"` for spot fills. This is correct (FR-008) and is what downstream consumers should display as "no liquidation threshold".

**Verification**: All existing `minute_loop_test.go` tests must still pass. The `TestUS2_T052` pessimistic-order test (which uses `Multiplier = 0` / unset — the default) must still trigger liquidation correctly.

---

### Task Group 6 — New Tests: Binding Acceptance Scenarios

**File**: `core-engine/domain/position/spot_liquidation_test.go` (new file)
**Package**: `package position`

---

#### Test 1 — `TestTS014_US1_SpotSurvivesCatastrophicDrop`

**Maps to**: spec US1 Acceptance Scenarios 1 & 2; Canonical Test Data rows 1–2.

**Setup**:
- `Multiplier = decimal.NewFromInt(1)`
- Position opened at entry `$100.00` (3 orders: `$100.00`, `$98.00`, `$95.84`)
- Process candle 1: market open at close `$100.00` (entry candle, same timestamp as `OpenTimestamp`)
- Process candle 2: `low = $1.00`, `high = $1.50`, `close = $1.20` — a 99% collapse

**Assertions**:
1. After candle 2: `pos.State != StateClosed` — position is NOT closed
2. After candle 2: no event with `EventType() == "trade.closed"` is emitted
3. After candle 2: `pos.LiquidationPrice.Equal(decimal.Zero)` — liquidation price is 0
4. After candle 2: `pos.Multiplier.Equal(decimal.NewFromInt(1))` — multiplier reads back correctly
5. After candle 2: no event with `EventType() == "liquidation"` (confirm no such event type exists or is emitted)

**Note on candle 2 setup**: Set `high = $1.50` which is well below any take-profit target (~$100.50). Set `low = $1.00` which is below any plausible `half`-formula liquidation price. This ensures the test would fail (liquidation fires) without the fix, proving the guard is operative.

---

#### Test 2 — `TestTS014_US2_FuturesLiquidatesCorrectly`

**Maps to**: spec US2 Acceptance Scenarios 1 & 2; Canonical Test Data rows 4–5.

**Setup**:
- `Multiplier = decimal.NewFromInt(2)` (futures)
- Position opened at entry `$100.00` (prices: `$100.00`, `$98.00`, `$95.84`)
- Process candle 1: market open at close `$100.00`
- Process candle 2: `low = $97.00` — triggers safety order fill at `$98.00`; after recalc, `LiquidationPrice ≈ $99.00 × 0.5 ≈ $49.xx` (half of avg); **does NOT liquidate** because `low=97 > liq≈49`
- Process candle 3: `low = $20.00`, `high = $40.00` — well below `LiquidationPrice`

**Assertions on candle 3**:
1. `pos.State == StateClosed` — position is force-closed
2. At least one event with `EventType() == "trade.closed"` is emitted
3. The `TradeClosedEvent.Reason == "liquidation"`
4. `pos.Profit.IsNegative()` — loss is negative

**Note**: This test proves that the spot bypass (Multiplier = 1 guard) does not affect futures behaviour. The `else if` path in Task Group 5 must have fired, producing a non-zero `LiquidationPrice`, which then triggered Step 3c.

---

#### Test 3 — `TestTS014_US3_SpotClosesViaTakeProfit`

**Maps to**: spec US3 Acceptance Scenarios 1 & 2; Canonical Test Data row 6.

**Setup**:
- `Multiplier = decimal.NewFromInt(1)` (spot)
- `TakeProfitDistance = decimal.NewFromFloat(0.5)` (0.5% above avg entry)
- Position opened at entry `$100.00`
- Process candle 1: market open at close `$100.00`; TP target initialises to `≈ $100.50`
- Process candle 2: `low = $50.00` — catastrophic drop; must NOT liquidate
- Process candle 3: `low = $100.00`, `high = $101.00` — high exceeds TP target `$100.50`

**Assertions on candle 3**:
1. `pos.State == StateClosed` — position IS closed (via take profit, not liquidation)
2. At least one event with `EventType() == "trade.closed"` is emitted
3. The `TradeClosedEvent.Reason == "take_profit"`
4. `pos.Profit.IsPositive()` — trade was profitable

**Note**: Candle 2 (`low = $50.00`) is the key candle. Without the fix, the hardcoded `LiquidationPrice = $50.00` formula would have fired on candle 2 (since `$50.00 == $50.00`). With the fix, candle 2 passes silently and the position closes on candle 3 via TP. If candle 2 produces a `trade.closed` event, fail the test immediately.

---

### Task Group 7 — Test Execution & Regression

**File**: N/A (terminal command)

Run the full test suite:

```
cd core-engine && go test ./... -count=1 -v 2>&1 | tail -50
```

**Pass criteria**:
1. All three new `TestTS014_*` tests: PASS
2. All previously passing tests: still PASS (zero regressions)
3. Total pass count equals baseline from Task Group 1 plus exactly 3 new tests

If any test fails, diagnose immediately — do not proceed to merge under the Green Light Protocol.

---

## Post-Implementation Notes

### What this plan does NOT change

- **`liquidation.go`**: The `CalculateLiquidationPrice` and `CheckLiquidation` functions are not modified. They are already correct. They are indirectly validated by the new tests (the futures test proves the non-zero path; the spot test proves the zero-skip path).
- **The futures liquidation formula**: The hardcoded `half` proxy (`pos.LiquidationPrice = pos.AverageEntryPrice.Mul(half)`) is preserved for `Multiplier > 1`. Replacing it with the canonical SDD § 2.5 formula is a separate future feature.
- **`LiquidationPriceUpdatedEvent` schema**: Not changed. For spot fills, the event carries `"0"` in the `LiquidationPrice` field, which is correct per FR-008.
- **TypeScript orchestrator, API, frontend**: Not touched.

### Known follow-up work (out of scope)

- Implement the canonical liquidation price formula from SDD § 2.5 for futures positions (replacing the `half` proxy). This requires adding `MaintenanceMarginRatio` as a `Position` field and threading it through from `Config`.
- Add a trailing stop exit path for spot positions (currently spec US1 FR-005 mentions it as a valid exit; if not yet implemented when this feature ships, FR-005's trailing-stop clause is noted as future work per the spec Assumptions).

