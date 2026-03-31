---
description: "Task list for 014-spot-no-liquidation"
---

# Tasks: Spot Trading Liquidation Bypass (Multiplier = 1)

**Feature Branch**: `014-spot-no-liquidation`
**Input**: Design documents from `/specs/014-spot-no-liquidation/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅

**Domain**: 100% `core-engine/` — no TypeScript, API, or frontend files are touched.

---

## Phase 1: Setup — Green Light Pre-Check

**Purpose**: Confirm the test suite is fully green before any code changes are made. This is a mandatory condition of the Green Light Protocol.

- [X] T001 Run `cd core-engine && go test ./... -count=1` and record the total PASS count as the baseline; no feature work begins until all tests pass

**Checkpoint**: All existing tests GREEN. Baseline pass count recorded.

---

## Phase 2: Foundational — `Multiplier` Field Wiring

**Purpose**: The `Position` struct must carry its `Multiplier` value before any guard logic in the PSM can reference it. This phase adds the field and wires it from config. It blocks all user story phases because every guard in Phase 3 depends on `pos.Multiplier` being available.

**⚠️ CRITICAL**: Phases 3, 4, and 5 cannot begin until T002 and T003 are complete.

- [X] T002 [core-engine] Add `Multiplier decimal.Decimal` field to `Position` struct between `ExitOnLastOrder` and `TakeProfitDistance` in `core-engine/domain/position/position.go`
- [X] T003 [core-engine] Add `newPos.Multiplier = orch.config.DomainConfig.Multiplier()` inside the `if orch.config.DomainConfig != nil` block in `core-engine/application/orchestrator/orchestrator.go`

**Checkpoint**: `go build ./...` compiles with zero errors. No existing test regressions.

---

## Phase 3: User Story 1 — Spot Survival (Priority: P1) 🎯 MVP

**Goal**: A position configured with `Multiplier = 1` must survive any price drop, no matter how catastrophic, without a forced liquidation. `LiquidationPrice` must be `0` at all times throughout the spot position's lifecycle.

**Independent Test**: Feed a `Multiplier = 1` position a candle with `low = $1.00` (99% drop from `$100.00` entry). Assert position is NOT closed and no `trade.closed` event is emitted.

### Tests for User Story 1 (TDD — write first, must FAIL before T006–T007)

> **NOTE: Write these tests FIRST, ensure they FAIL (RED) before applying T006 and T007**

- [X] T004 [P] [core-engine] [US1] Create `core-engine/domain/position/spot_liquidation_test.go` with `package position` header and helper imports only (scaffold file, no test functions yet)
- [X] T005 [core-engine] [US1] Add `TestTS014_US1_SpotSurvivesCatastrophicDrop` to `core-engine/domain/position/spot_liquidation_test.go`: open with `Multiplier=1` at `$100.00`, process candle with `low=$1.00`/`high=$1.50`; assert `pos.State != StateClosed`, no `trade.closed` event, `pos.LiquidationPrice.Equal(decimal.Zero)`; run test and confirm RED

### Implementation for User Story 1

- [X] T006 [core-engine] [US1] In `core-engine/domain/position/minute_loop.go` Step 2 (inside `if pos.State == StateIdle` block, after `events = append(events, tradeOpenedEvent)`): add spot guard — `if pos.Multiplier.Equal(decimal.NewFromInt(1)) { pos.LiquidationPrice = decimal.Zero }`
- [X] T007 [core-engine] [US1] In `core-engine/domain/position/minute_loop.go` Step 3b (replace existing `if !pos.AverageEntryPrice.IsZero() { half ... }` liquidation recalculation block): replace with `if pos.Multiplier.Equal(decimal.NewFromInt(1)) { pos.LiquidationPrice = decimal.Zero } else if !pos.AverageEntryPrice.IsZero() { half, _ := decimal.NewFromString("0.5"); pos.LiquidationPrice = pos.AverageEntryPrice.Mul(half) }`
- [X] T008 [core-engine] [US1] Run `go test ./domain/position/ -run TestTS014_US1 -v` and confirm GREEN; run `go test ./domain/position/ -v` and confirm no regressions

**Checkpoint**: `TestTS014_US1_SpotSurvivesCatastrophicDrop` passes. US1 is independently testable and complete.

---

## Phase 4: User Story 2 — Futures Non-Regression (Priority: P1)

**Goal**: A position with `Multiplier = 2` must still liquidate correctly when its candle `low` breaches the calculated `LiquidationPrice`. The spot bypass introduced in Phase 3 must be provably scoped to `Multiplier = 1` only.

**Independent Test**: Feed a `Multiplier = 2` position a candle with `low = $20.00` after a safety order has set `LiquidationPrice ≈ $49.xx`. Assert `pos.State == StateClosed`, reason is `"liquidation"`, and profit is negative.

### Tests for User Story 2 (TDD — write first, must PASS after Phase 3 implementation)

- [X] T009 [core-engine] [US2] Add `TestTS014_US2_FuturesLiquidatesCorrectly` to `core-engine/domain/position/spot_liquidation_test.go`: open with `Multiplier=2` at `$100.00`; process candle 1 (open), candle 2 (`low=$97.00` triggers SO fill at `$98.00`, `LiquidationPrice` recalculates to `≈$49.xx`), candle 3 (`low=$20.00`); assert `pos.State == StateClosed`, `TradeClosedEvent.Reason == "liquidation"`, `pos.Profit.IsNegative()`
- [X] T010 [core-engine] [US2] Run `go test ./domain/position/ -run TestTS014_US2 -v` — this test should pass immediately from Phase 3's `else if` branch; if RED investigate the `else if` path in T007

**Checkpoint**: `TestTS014_US2_FuturesLiquidatesCorrectly` passes. Futures behaviour confirmed unregressed.

---

## Phase 5: User Story 3 — Spot Closes via Take Profit (Priority: P2)

**Goal**: A `Multiplier = 1` position that has survived a catastrophic dip must still be able to close via Take Profit when the price recovers. This validates that disabling liquidation does not inadvertently disable other exit paths or corrupt position state.

**Independent Test**: Feed a `Multiplier = 1` position a candle with `low = $50.00` (no liquidation), then a candle with `high = $101.00` (above TP target `≈ $100.50`). Assert `pos.State == StateClosed`, reason is `"take_profit"`, and profit is positive.

### Tests for User Story 3 (TDD — write first)

> **NOTE: Write this test before confirming it passes. Candle 2 (`low=$50.00`) is the critical candle — without Phase 3's fix, it would produce a `trade.closed` (liquidation) event, causing this test to fail at the candle-2 assertion.**

- [X] T011 [core-engine] [US3] Add `TestTS014_US3_SpotClosesViaTakeProfit` to `core-engine/domain/position/spot_liquidation_test.go`: set `Multiplier=1`, `TakeProfitDistance=0.5`; process candle 1 (open at `$100.00`, TP target `≈$100.50`), candle 2 (`low=$50.00`, assert no `trade.closed` event), candle 3 (`low=$100.00`, `high=$101.00`); assert `pos.State == StateClosed`, `TradeClosedEvent.Reason == "take_profit"`, `pos.Profit.IsPositive()`
- [X] T012 [core-engine] [US3] Run `go test ./domain/position/ -run TestTS014_US3 -v` and confirm GREEN

**Checkpoint**: `TestTS014_US3_SpotClosesViaTakeProfit` passes. All three acceptance scenarios are GREEN.

---

## Phase 6: Polish — Full Regression & Build

**Purpose**: Confirm zero regressions across the entire core-engine module and rebuild the binary for integration testing.

- [X] T013 [core-engine] Run `go test ./... -count=1 -v` from `core-engine/`; confirm total pass count equals baseline (T001) + 3 new tests; zero failures permitted under Green Light Protocol
- [X] T014 [P] [core-engine] Rebuild binary: `go build -o "../orchestrator/api/core-engine.exe" ./cmd/engine/` from `core-engine/`; confirm exit code 0

**Checkpoint**: All tests GREEN. Binary rebuilt. Feature is complete and ready for merge.

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup: T001)
    └── Phase 2 (Foundational: T002–T003)  ← BLOCKS all story work
            ├── Phase 3 (US1: T004–T008)   ← P1 — implement first
            ├── Phase 4 (US2: T009–T010)   ← P1 — can run in parallel with Phase 3 once T007 is done
            └── Phase 5 (US3: T011–T012)   ← P2 — requires Phase 3 complete
                    └── Phase 6 (Polish: T013–T014)
```

### User Story Dependencies

- **US1 (Phase 3)**: Unblocked by T002 + T003. Tests must be written (RED) before implementation (T006–T007).
- **US2 (Phase 4)**: Unblocked by T007 (the `else if` branch is what US2 tests). Can be written and run in parallel with Phase 3 once T007 is applied.
- **US3 (Phase 5)**: Requires Phase 3 complete (specifically T006 + T007, which prevent the candle-2 liquidation that would break T011's intermediate assertion).
- **Polish (Phase 6)**: Requires Phases 3–5 complete.

### Parallel Opportunities

- T002 and T003 can be applied simultaneously (different files, no dependency between them).
- T004 (test file scaffold) can be created at any time — it has no code dependencies.
- T009 (US2 test) can be written immediately after T007 is applied — it does not depend on US1 test passing.
- T013 and T014 can run in parallel (test run and binary build are independent).

### TDD Checkpoints

| Task | Phase | Expected State |
|---|---|---|
| T005 (US1 test) written | After T004 | Must be RED before T006–T007 |
| T006–T007 applied | Phase 3 | T005 turns GREEN |
| T009 (US2 test) written | After T007 | Should be GREEN immediately (else if path) |
| T011 (US3 test) written | After Phase 3 | Should be GREEN immediately |
| T013 (full suite) | Phase 6 | All GREEN, count = baseline + 3 |

## Implementation Strategy

**MVP = Phase 3 only (US1)**: After T001–T008, the primary bug is fixed. A `Multiplier = 1` backtest will no longer incorrectly liquidate. This is the minimum viable delivery.

**Complete = Phases 3–6**: All three acceptance scenarios covered with tests, zero regressions, binary rebuilt.

**Scope boundary**: `liquidation.go` is NOT modified. The canonical SDD § 2.5 formula for futures positions is NOT implemented (left for a future feature). No TypeScript, API, or frontend files are touched.
