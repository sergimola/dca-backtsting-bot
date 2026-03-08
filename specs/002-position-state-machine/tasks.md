# Tasks: Position State Machine Implementation

**Feature**: Core Domain Position State Machine  
**Branch**: `002-position-state-machine`  
**Date**: March 8, 2026  
**Status**: Ready for implementation  
**Methodology**: Test-Driven Development (TDD) — Unit tests verified against canonical test data table (spec.md) are written and must FAIL before any implementation code.

---

## Overview

This tasks.md organizes implementation work into six phases:

1. **Phase 1 (Setup)**: Project structure initialization and test infrastructure
2. **Phase 2 (Foundational)**: Core types, state enum, test fixtures—blocking tasks for all user stories
3. **Phase 3 (P1 US1)**: Process Single-Minute Candle — main execution loop
4. **Phase 4 (P1 US2)**: Enforce Pessimistic Execution Order — buy before liquidation before take-profit
5. **Phase 5 (P1 US3)**: Handle Gap-Down Paradox — order filling at limit prices
6. **Phase 6 (P2 US4)**: Re-entry After Take-Profit — single-position invariant and restart logic
7. **Phase 7 (P2 US5)**: Monthly Capital Addition & Day Counter — recurring capital injection
8. **Phase 8 (P3 US6)**: Early Exit on Last Order Fill — simulation halt option
9. **Final Phase**: Polish, integration tests, and backtest validation

Each phase is independently testable and delivers working, tested code.

---

## Phase 1: Setup & Project Initialization

**Goal**: Initialize the Go package structure and core testing infrastructure for Position State Machine.

**Acceptance Criteria**:
- [ ] Project directory `core-engine/domain/position/` exists with Go package conventions
- [ ] Go module dependencies (shopspring/decimal, google/uuid) are installed and vendored
- [ ] Test configuration and fixtures directory structure in place
- [ ] IDE integrates with test discovery (Go Test Explorer sees new tests)

### Tasks

- [ ] T001 Create project structure under core-engine/domain/position/
- [ ] T002 Initialize go.mod dependencies for shopspring/decimal and google/uuid in core-engine/domain/position/
- [ ] T003 Create fixtures directory core-engine/domain/position/fixtures/ for test data
- [ ] T004 Setup test utilities file core-engine/domain/position/test_helpers.go with decimal parsing helpers

---

## Phase 2: Foundational (Blocking Prerequisites)

**Goal**: Implement core types, state machine interface, and reusable test infrastructure that all user stories depend on.

**Acceptance Criteria**:
- [ ] PositionState enum fully defined with all 5 states (IDLE, OPENING, SAFETY_WAIT, CLOSED) and String() method
- [ ] OrderType enum defined with MARKET and LIMIT types
- [ ] OrderFill struct with all required fields immutable and well-typed
- [ ] Candle input struct defined with OHLCV prices and volume
- [ ] PositionStateMachine interface defined with ProcessCandle and NewPosition methods
- [ ] Canonical test data fixture constants available for all downstream tests
- [ ] Fee calculation helper functioning with correct rate constants (FeeRateSpot, FeeRateMarginMarket, FeeRateMarginLimit)
- [ ] All Decimal operations use RoundHalfUp mode consistently

### Tests (TDD: Written FIRST, must FAIL before implementation)

- [ ] T005 [P] Write canonical test for price grid formula: P₀=100 → P₁=98.00000000 (2% entry drop) in core-engine/domain/position/canonical_test.go
- [ ] T006 [P] Write canonical test for scaled price grid: P₁=98.00, scale=1.1 → P₂=95.84400000 in core-engine/domain/position/canonical_test.go
- [ ] T007 [P] Write canonical test for order amount grid: total=100, scale=2.0 → A[0]=14.28571428, A[1]=28.57142857, A[2]=57.14285715 in core-engine/domain/position/canonical_test.go
- [ ] T008 [P] Write canonical test for average entry price: 1.0@98.00 + 1.0@95.844 → Pbar=96.92200000 in core-engine/domain/position/canonical_test.go
- [ ] T009 [P] Write canonical test for take-profit target: Pbar=96.922, distance=0.5% → P_tp=97.40661000 in core-engine/domain/position/canonical_test.go
- [ ] T010 [P] Write canonical test for liquidation price: account=1000, position_size=20, Pbar=100, mmr=0.0067 → P_liq=50.33725964 in core-engine/domain/position/canonical_test.go
- [ ] T011 Write canonical test for fee calculation: price=95.844, qty=1.0, spot → fee=0.071883 in core-engine/domain/position/canonical_test.go

### Implementation

- [ ] T012 Implement PositionState enum with String() method in core-engine/domain/position/state.go
- [ ] T013 Implement OrderType enum with String() method in core-engine/domain/position/position.go
- [ ] T014 Implement OrderFill struct with all required fields in core-engine/domain/position/position.go
- [ ] T015 Implement Position struct with all aggregates (PositionQuantity, AverageEntryPrice, TakeProfitTarget, LiquidationPrice) in core-engine/domain/position/position.go
- [ ] T016 Implement Candle input struct in core-engine/domain/position/config.go
- [ ] T017 Implement PositionStateMachine interface in core-engine/domain/position/statemachine.go
- [ ] T018 Implement NewPosition() constructor initializing Position to StateIdle in core-engine/domain/position/position.go
- [ ] T019 Implement CalculateFee() function with spot/margin rate selection in core-engine/domain/position/position.go
- [ ] T020 Implement Decimal conversion utilities (ParseDecimal, MustDecimal) in core-engine/domain/position/test_helpers.go
- [ ] T021 Create canonical test data fixture constants in core-engine/domain/position/fixtures/test_config.go
- [ ] T022 Implement Order interface contract in core-engine/domain/position/config.go

### Tests Validated

- [ ] T023 [P] Run canonical tests T005-T011; all must PASS after Phase 2 implementation
- [ ] T024 Run complete test suite to ensure no regressions in Phase 2: `go test ./core-engine/domain/position -v`

---

## Phase 3: User Story 1 (P1) — Process Single-Minute Candle Through Position State Machine

**Goal**: Implement the core Minute Loop Protocol (SDD § 3.1) — main execution loop that processes one OHLCV candle per call, applying strict pessimistic order: Buy → Liquidation → Take-Profit.

**Story Description**: A backtesting engine processes historical OHLCV candles one at a time. For each candle, the state machine must:
1. Create a new position (if IDLE and candle received)
2. Process buy orders (if low ≤ any unfilled P_n)
3. Check liquidation (if low ≤ P_liq)
4. Check take-profit (if high ≥ P_tp)
5. Return events (TradeOpened, BuyOrderExecuted, LiquidationPriceUpdated, TradeClosed, SellOrderExecuted, etc.)

**Independent Test Criteria**: 
- Can test with synthetic candles and fixed starting Position, no external dependencies
- State transitions verifiable from returned events
- Profit/loss calculations verifiable against canonical test data

**Delivery**: Core execution loop with complete event dispatch for all state transitions.

### Tests (TDD: Written FIRST, must FAIL)

- [ ] T025 [US1] Write test: IDLE position + first candle → TradeOpenedEvent dispatched in core-engine/domain/position/minute_loop_test.go
- [ ] T026 [US1] Write test: OPENING position + candle with low ≤ P[1] → BuyOrderExecutedEvent for safety order #1 in core-engine/domain/position/minute_loop_test.go
- [ ] T027 [US1] Write test: OPENING position after buy → LiquidationPriceUpdatedEvent with recalculated price in core-engine/domain/position/minute_loop_test.go
- [ ] T028 [US1] Write test: SAFETY_ORDER_WAIT + candle with high ≥ P_tp → TradeClosed event (take-profit close) in core-engine/domain/position/minute_loop_test.go
- [ ] T029 [US1] Write test: Position closed via take-profit → state transitions to IDLE (via event interpretation by caller) in core-engine/domain/position/minute_loop_test.go
- [ ] T030 [US1] Write test: Event payload validation — TradeOpenedEvent contains trade_id, timestamp, configured_orders array in core-engine/domain/position/minute_loop_test.go
- [ ] T031 [US1] Write test: Event payload validation — BuyOrderExecutedEvent contains order_number, price, base_size, quote_size, liquidation_price, fee in core-engine/domain/position/minute_loop_test.go
- [ ] T032 [US1] Write test: ProcessCandle called with nil Candle returns error in core-engine/domain/position/minute_loop_test.go
- [ ] T033 [US1] Write test: Multiple orders filled on same candle (gap-down) → events in order in core-engine/domain/position/minute_loop_test.go

### Implementation

- [ ] T034 [US1] Implement ProcessCandle() signature in core-engine/domain/position/minute_loop.go
- [ ] T035 [US1] Implement step 1 of Minute Loop (IDLE → OPENING): market buy logic, emit TradeOpenedEvent in core-engine/domain/position/minute_loop.go
- [ ] T036 [US1] Implement step 2: PriceChangedEvent dispatch in core-engine/domain/position/minute_loop.go
- [ ] T037 [US1] Implement step 3: Buy order processing loop, emit BuyOrderExecutedEvent in core-engine/domain/position/order_fills.go
- [ ] T038 [US1] Implement step 4: Liquidation price recalculation after each buy, emit LiquidationPriceUpdatedEvent in core-engine/domain/position/liquidation.go
- [ ] T039 [US1] Implement step 5: Liquidation check (low ≤ P_liq), emit TradeClosedEvent with reason="liquidation", loss=-account_balance in core-engine/domain/position/liquidation.go
- [ ] T040 [US1] Implement step 6: Take-profit check (high ≥ P_tp), emit TradeClosedEvent + SellOrderExecutedEvent with calculated profit in core-engine/domain/position/profit.go
- [ ] T041 [US1] Implement step 7: Return events slice in order dispatched in core-engine/domain/position/minute_loop.go
- [ ] T042 [US1] Implement event constructors for TradeOpenedEvent, BuyOrderExecutedEvent, LiquidationPriceUpdatedEvent, TradeClosedEvent, SellOrderExecutedEvent in core-engine/domain/position/events.go
- [ ] T043 [US1] Implement AverageEntryPrice() calculation (size-weighted average) in core-engine/domain/position/averaging.go (called by order_fills.go)
- [ ] T044 [US1] Implement TakeProfitTarget() calculation (Pbar × 1 + distance%) in core-engine/domain/position/profit.go
- [ ] T045 [US1] Implement LiquidationPrice() calculation per SDD § 2.5 in core-engine/domain/position/liquidation.go (called by minute_loop.go)
- [ ] T046 [US1] Implement Profit() calculation (proceeds from sell - sum of quote amounts - sum of fees) in core-engine/domain/position/profit.go

### Integration Tests

- [ ] T047 [US1] Write integration test: Full lifecycle IDLE → OPENING → SAFETY_WAIT → CLOSED with 3 synthetic candles in core-engine/domain/position/position_test.go
- [ ] T048 [US1] Write integration test: Verify cumulative profit equals expected value from canonical test data in core-engine/domain/position/position_test.go
- [ ] T049 [US1] Run all US1 tests; all must PASS: `go test ./core-engine/domain/position -v -run TestUS1`

---

## Phase 4: User Story 2 (P1) — Enforce Pessimistic Execution Order

**Goal**: Verify that order execution strictly follows pessimistic sequence: Buy → Liquidation → Take-Profit. No out-of-order violations.

**Story Description**: Backtesting correctness depends on pessimistic order. If a candle triggers both a buy order and a liquidation, the buy must fill first (updating average entry and liquidation price), then liquidation is re-evaluated. If candle triggers both liquidation and take-profit, liquidation executes first.

**Independent Test Criteria**:
- Test with a single candle where multiple conditions are true simultaneously
- Verify state transitions occur in correct order
- Verify intermediate state updates (average price, liquidation recalc) are applied before next check

**Delivery**: Minute Loop enforces order; all tests verify no shortcuts or re-ordering.

### Tests (TDD: Written FIRST, must FAIL)

- [ ] T050 [P] [US2] Write test: Candle with low ≤ both P[1] AND ≤ P_liq → buy fills FIRST, P_liq recalculated, then liquidation re-checked in core-engine/domain/position/pessimistic_order_test.go
- [ ] T051 [P] [US2] Write test: After buy+recalc, P_liq moves above low → position stays open in core-engine/domain/position/pessimistic_order_test.go
- [ ] T052 [P] [US2] Write test: Candle with no buy trigger + high ≥ P_tp but low ≤ P_liq → liquidation closes position (take-profit ignored) in core-engine/domain/position/pessimistic_order_test.go
- [ ] T053 [P] [US2] Write test: Position open with P_liq=90, candle has high=100, low=89 → low ≤ P_liq triggers liquidation (take-profit not checked) in core-engine/domain/position/pessimistic_order_test.go
- [ ] T054 [P] [US2] Write test: Event order verification — if candle triggers buy + liquidation, events are [BuyOrderExecuted, LiquidationPriceUpdated, TradeClosed] in that order in core-engine/domain/position/pessimistic_order_test.go

### Implementation (Verification Tasks — Logic from US1, just ensuring order)

- [ ] T055 [US2] Add step-by-step pessimistic validation IN minute_loop.go: after each buy fill, immediately recalculate P_liq before liquidation check
- [ ] T056 [US2] Document order guarantee in minute_loop.go comments: "Step 3→4→5→6 are NEVER reordered" (reference SDD § 3.1)
- [ ] T057 [US2] Assert that minute_loop.go processes candle in EXACTLY this order (no branching shortcuts): Buy loop → Liquidation check → Take-profit check
- [ ] T058 [US2] Add compiler check or linter rule to prevent code changes that might reorder steps (manual code review via PR checklist)

### Tests Validated

- [ ] T059 [US2] Run all pessimistic order tests; all must PASS: `go test ./core-engine/domain/position -v -run TestPessimisticOrder`

---

## Phase 5: User Story 3 (P1) — Handle Gap-Down Paradox (Pessimistic Gap Pricing)

**Goal**: When candle opens below multiple safety order prices, fill orders at pre-calculated limit prices, never at gap-down market price. This is the "Gap-Down Paradox Rule" (SDD § 3.2).

**Story Description**: Pessimistic execution means worst-case (most conservative) fills. If open price is 95.5 but two orders are at 96 and 95, the system fills at 96 then 95, not at open=95.5 for both.

**Independent Test Criteria**:
- Test with synthetic candle where open ≤ multiple P_n
- Verify each order fills at its exact P_n, not interpolated or market price
- Verify order quantities match configured amounts (not gap-adjusted)

**Delivery**: order_fills.go implements precise gap-down handling; all edge cases covered by tests.

### Tests (TDD: Written FIRST, must FAIL)

- [ ] T060 [P] [US3] Write test: Candle open=95.0, low=94.0; orders at P[1]=98, P[2]=95.844, P[3]=95 → all 3 fill at their exact prices in core-engine/domain/position/gap_down_test.go
- [ ] T061 [P] [US3] Write test: Candle open=95.5, gap=1.0 below prior close; order at P[1]=98 → fills at 98, not at open=95.5 in core-engine/domain/position/gap_down_test.go
- [ ] T062 [P] [US3] Write test: Verify order quantities match configured amounts (not gap-adjusted) in core-engine/domain/position/gap_down_test.go
- [ ] T063 [P] [US3] Write test: Multiple fills on single candle, verify order execution index increments correctly in core-engine/domain/position/gap_down_test.go
- [ ] T064 [P] [US3] Write test: Gap-down past all remaining orders → fills all at their respective prices in core-engine/domain/position/gap_down_test.go
- [ ] T065 [P] [US3] Write test: Canonical gap-down scenario from SDD § 3.2 with exact prices and quantities in core-engine/domain/position/gap_down_test.go

### Implementation

- [ ] T066 [US3] Implement order fill loop in order_fills.go: iterate through unfilled orders, check if low ≤ P[i], fill at P[i] (not open, not low)
- [ ] T067 [US3] Implement OrderFill constructor with ExecutedPrice = P[i] (not market price) in core-engine/domain/position/order_fills.go
- [ ] T068 [US3] Implement quantity rounding to lot size (e.g., 8 decimals) in order_fills.go
- [ ] T069 [US3] Implement NextOrderIndex tracking in core-engine/domain/position/order_fills.go (which order fills next)
- [ ] T070 [US3] Add loop condition validation (low ≤ P[i]) in order_fills.go; log gap-down trigger for audit in comment
- [ ] T071 [US3] Implement HasMoreOrders boolean update after each fill in core-engine/domain/position/order_fills.go

### Tests Validated

- [ ] T072 [US3] Run all gap-down tests; all must PASS: `go test ./core-engine/domain/position -v -run TestGapDown`

---

## Phase 6: User Story 4 (P2) — Re-entry After Take-Profit (Position Restart)

**Goal**: When a position closes via take-profit, a new position may open on the NEXT candle (not the closing candle). Re-entry price is take-profit price × 1.0005 (pessimistic re-entry buffer).

**Story Description**: Multi-position backtests require smooth re-entry after take-profit. The single-position invariant prevents concurrent positions. Re-entry mechanics enable realistic, multi-cycle backtests.

**Independent Test Criteria**:
- Test two consecutive candles where first closes via take-profit, second opens new position
- Verify new position has fresh grid starting from re-entry price
- Verify single-position invariant is maintained (never 2 concurrent positions)
- Verify cumulative profit from both positions is correctly summed

**Delivery**: minute_loop.go handles re-entry; new positions open on candle after close; single-position invariant enforced via state machine.

### Tests (TDD: Written FIRST, must FAIL)

- [ ] T073 [P] [US4] Write test: Position closes via take-profit on candle t; t+1 is processed → new position opens in StateOpening in core-engine/domain/position/reentery_test.go
- [ ] T074 [P] [US4] Write test: Verify re-entry price = close_price × 1.0005 exactly in core-engine/domain/position/reentery_test.go
- [ ] T075 [P] [US4] Write test: New position uses fresh price grid starting from re-entry price in core-engine/domain/position/reentery_test.go
- [ ] T076 [P] [US4] Write test: Single-position invariant — at no point are two positions in non-IDLE state simultaneously in core-engine/domain/position/reentery_test.go
- [ ] T077 [P] [US4] Write test: Two positions both close take-profit → cumulative profit = profit1 + profit2 in core-engine/domain/position/reentery_test.go
- [ ] T078 [P] [US4] Write test: Position closes via LIQUIDATION (not take-profit) → new position may still open on next candle (SDD allows this) in core-engine/domain/position/reentery_test.go

### Implementation

- [ ] T079 [US4] Implement state transition IDLE → OPENING when IDLE position receives buy trigger in minute_loop.go (calls NewPosition internally)
- [ ] T080 [US4] Implement state transition logic on take-profit close → set State back to StateIdle in profit.go
- [ ] T081 [US4] Implement re-entry price calculation in minute_loop.go: close_price × 1.0005
- [ ] T082 [US4] Implement Position copy/refresh logic on re-entry (fresh orders list but same TradeID series) in minute_loop.go
- [ ] T083 [US4] Add single-position invariant assertion in minute_loop.go: only 1 position may be non-IDLE at a time
- [ ] T084 [US4] Implement account_balance update after position close (for subsequent position sizing) in minute_loop.go

### Tests Validated

- [ ] T085 [US4] Run all re-entry tests; all must PASS: `go test ./core-engine/domain/position -v -run TestReentry`

---

## Phase 7: User Story 5 (P2) — Monthly Capital Addition & Day Counter

**Goal**: On every 30-day boundary (1440 × 30 candles), inject capital into account balance and emit MonthlyAdditionEvent.

**Story Description**: Realistic long-cycle backtests require recurring capital injection (e.g., DCA savings plan). A day_counter tracks candles; after 1440 candles, day_counter increments. After 30 days, capital is injected and MonthlyAdditionEvent is dispatched.

**Independent Test Criteria**:
- Test with 43200 candles (30 days × 1440 candles/day)
- Verify account_balance increases by monthly_addition on day 30
- Verify MonthlyAdditionEvent is dispatched with correct amount
- Verify subsequent positions use increased balance for sizing

**Delivery**: minute_loop.go tracks day_counter; capital injection on 30-day boundaries.

### Tests (TDD: Written FIRST, must FAIL)

- [ ] T086 [P] [US5] Write test: day_counter increments on 1440th candle in core-engine/domain/position/monthly_addition_test.go
- [ ] T087 [P] [US5] Write test: After 1440 candles, days_since_start = 1 in core-engine/domain/position/monthly_addition_test.go
- [ ] T088 [P] [US5] Write test: After 1440 × 30 candles, MonthlyAdditionEvent dispatched with correct amount in core-engine/domain/position/monthly_addition_test.go
- [ ] T089 [P] [US5] Write test: account_balance increases by monthly_addition on day 30 in core-engine/domain/position/monthly_addition_test.go
- [ ] T090 [P] [US5] Write test: Second position (after first take-profit on day 25) uses increased balance for sizing after day 30 injection in core-engine/domain/position/monthly_addition_test.go
- [ ] T091 [P] [US5] Write test: If monthly_addition = 0, no event dispatched on day 30 in core-engine/domain/position/monthly_addition_test.go

### Implementation

- [ ] T092 [US5] Add day_counter field to Position struct (or caller state) in core-engine/domain/position/position.go
- [ ] T093 [US5] Implement day counter increment logic in minute_loop.go: `if candle_count % 1440 == 0 then days_since_start += 1`
- [ ] T094 [US5] Implement monthly addition check in minute_loop.go: `if days_since_start % 30 == 0 and monthly_addition > 0`
- [ ] T095 [US5] Implement account_balance update on monthly boundary in minute_loop.go: `account_balance += monthly_addition`
- [ ] T096 [US5] Implement MonthlyAdditionEvent constructor and dispatch in events.go
- [ ] T097 [US5] Add monthly_addition and account_balance fields to Position or caller context

### Tests Validated

- [ ] T098 [US5] Run all monthly addition tests; all must PASS: `go test ./core-engine/domain/position -v -run TestMonthlyAddition`

---

## Phase 8: User Story 6 (P3) — Early Exit on Last Order Fill

**Goal**: If `exit_on_last_order = true` and the final safety order is filled, halt simulation immediately (BREAK).

**Story Description**: Some backtests analyze behavior when maximum drawdown buffer is reached (all orders filled). When the Nth order is filled, if exit_on_last_order is set, the backtest stops accepting further candles.

**Independent Test Criteria**:
- Test with position configured to 3 orders, exit_on_last_order = true
- Verify simulation halts after 3rd order filled
- Verify no further candles are processed after halt

**Delivery**: minute_loop.go checks exit_on_last_order flag; caller receives halt signal via event or error.

### Tests (TDD: Written FIRST, must FAIL)

- [ ] T099 [P] [US6] Write test: 3 orders configured, exit_on_last_order = true; after 3rd fill → BREAK signal in core-engine/domain/position/early_exit_test.go
- [ ] T100 [P] [US6] Write test: Position with 5 orders, exit_on_last_order = true; 3rd order fills → simulation continues; 5th order fills → BREAK in core-engine/domain/position/early_exit_test.go
- [ ] T101 [P] [US6] Write test: exit_on_last_order = false → no BREAK signal even after final order in core-engine/domain/position/early_exit_test.go
- [ ] T102 [P] [US6] Write test: BREAK is returned as event or error for caller to detect in core-engine/domain/position/early_exit_test.go

### Implementation

- [ ] T103 [US6] Add exit_on_last_order field to Position or config in core-engine/domain/position/position.go
- [ ] T104 [US6] Implement check in order_fills.go: after fill, if NextOrderIndex == len(Prices) AND exit_on_last_order, dispatch BREAK signal
- [ ] T105 [US6] Implement BREAK event type or error return in events.go and minute_loop.go
- [ ] T106 [US6] Document BREAK behavior in spec comments (SDD § 3.1 step 7 extension)

### Tests Validated

- [ ] T107 [US6] Run all early exit tests; all must PASS: `go test ./core-engine/domain/position -v -run TestEarlyExit`

---

## Final Phase: Polish, Integration, and Backtest Validation

**Goal**: Complete integration testing, performance validation, and readiness for production deployment.

**Acceptance Criteria**:
- [ ] All canonical test data table entries (8 scenarios) pass with exact Decimal parity
- [ ] Full integration test runs 1000+ candle backtest with multiple positions, re-entries, and monthly additions
- [ ] 85%+ code coverage for PSM core logic
- [ ] Benchmarks confirm <1ms latency per candle on commodity hardware
- [ ] All code passes Go linting (golangci-lint) and staticcheck
- [ ] Documentation complete: package.md, interface contracts, architectural notes

### Integration Tests

- [ ] T108 Write comprehensive backtest scenario: 60 days, 2 positions, 1 monthly addition, verify exact profit match vs. canonical bot in core-engine/domain/position/integration_test.go
- [ ] T109 [P] Write canonical test scenarios table: all 8 scenarios from spec.md canonical test data table with exact expected values in core-engine/domain/position/canonical_integration_test.go
- [ ] T110 [P] Write gap-down + liquidation scenario: candle opens below multiple orders and below P_liq, verify fills then closes in core-engine/domain/position/integration_test.go
- [ ] T111 Write stress test: 10,000 candles, 50+ positions, verify no memory leaks and <500µs average latency in core-engine/domain/position/benchmark_test.go
- [ ] T112 Write state machine invariant validator: after each candle, verify Position struct integrity (quantities ≥ 0, prices monotonic, etc.) in core-engine/domain/position/invariant_test.go

### Code Quality & Documentation

- [ ] T113 Run `go test ./core-engine/domain/position -v -cover` and verify ≥85% code coverage
- [ ] T114 Run `golangci-lint run ./core-engine/domain/position` and fix all lint issues
- [ ] T115 Run `go vet ./core-engine/domain/position` and verify no warnings
- [ ] T116 Write package documentation comment for position package in core-engine/domain/position/doc.go
- [ ] T117 Write architecture overview document: core-engine/domain/position/ARCHITECTURE.md (SDD § 4.2–4.3 mapping)
- [ ] T118 Write API contract documentation: interfaces and expected error types in core-engine/domain/position/CONTRACTS.md

### Performance & Finalization

- [ ] T119 [P] Run benchmarks `go test -bench=. ./core-engine/domain/position` and capture baseline latencies in core-engine/domain/position/benchmark_results.txt
- [ ] T120 Validate benchmark results: ProcessCandle < 1ms on typical 10–20 order position
- [ ] T121 Add profiling markers (pprof hooks) for caller use in minute_loop.go comments (no mandatory instrumentation in PSM)
- [ ] T122 Commit final code and pass code review: PR checks design (pessimistic order, gap-down, re-entry), tests (canonical data), and performance (latency < 1ms)
- [ ] T123 Tag release: `v1.0.0-position-state-machine` on feature branch

---

## Execution Strategy & Parallelization

### Dependency Graph

```
Phase 1 (Setup)
     ↓
Phase 2 (Foundational) ← All tests must PASS before proceeding
     ↓
Phase 3 (US1) ← Can proceed with implementation once Phase 2 tests pass
     ↓
[Phase 4 (US2) | Phase 5 (US3)] ← Can parallelize after US1 complete
     ↓
Phase 6 (US4) ← Depends on US1 for basic state machine
     ↓
[Phase 7 (US5) | Phase 8 (US6)] ← Can parallelize; independent features
     ↓
Final Phase (Integration)
```

### Parallelization Opportunities

**Can run in parallel after US1 complete**:
- US2 (Pessimistic order validation) — does not require new implementation, just verification of US1 order
- US3 (Gap-down) — depends on Phase 2 and US1 foundations

**Can run in parallel after US3 complete**:
- US4 (Re-entry) — extends US1 with state reset logic
- US5 (Monthly addition) — independent feature
- US6 (Early exit) — independent feature

**Recommended MVP scope (minimal viable product)**:
- Phase 1 + Phase 2 + Phase 3 (US1): Core Minute Loop, basic state machine, event dispatch
- Tests: Canonical test data table passes with exact Decimal parity
- Delivery: Functional PSM that processes candles and emits events correctly

### Estimated Effort per Task

- **Tests (TDD)**: 5–15 min each (write failing test) = ~30 tests × 10 min avg = 300 min
- **Implementation**: 10–30 min each (implement to pass test) = ~100 tasks × 15 min avg = 1500 min
- **Integration & Polish**: 5 hours (benchmarking, coverage, docs)
- **Total**: ~31 hours (4 days for full-time developer)

### Immediate Next Steps

1. Run Phase 1 tasks (T001–T004): `mkdir core-engine/domain/position && go mod init`
2. Run Phase 2 tests (T005–T011): Write all canonical test cases to file, watch them FAIL
3. Run Phase 2 implementation (T012–T024): Implement types and fixtures until tests PASS
4. Run Phase 3 tests (T025–T033): Write US1 test cases, watch them FAIL
5. Run Phase 3 implementation (T034–T049): Implement minute_loop.go incrementally, test each step

---

## Success Criteria

- ✅ All canonical test data table scenarios (8 entries) produce exact Decimal output matching spec.md
- ✅ Code coverage ≥85% for core-engine/domain/position
- ✅ Zero lint warnings: `golangci-lint run ./core-engine/domain/position`
- ✅ ProcessCandle latency <1ms per candle on 10–20 order typical positions
- ✅ Parity with canonical Python bot: 100% of backtests produce identical cumulative profit (last decimal place)
- ✅ All state transitions follow SDD § 3.1 strict pessimistic order
- ✅ Gap-down orders fill at P_n, never at market price (SDD § 3.2)
- ✅ Single-position invariant maintained: never 2 concurrent positions
- ✅ Full backtest scenario (60 days, multiple positions, monthly additions) completes successfully
- ✅ Code passes PR review and is merged to main branch

---

## References

- **SDD Master Report**: Sections 2.0–2.8 (math), 3.1–3.4 (minute loop), 4.2–4.3 (data contract), 5.5–5.7 (legacy fixes)
- **Feature Spec**: specs/002-position-state-machine/spec.md
- **Implementation Plan**: specs/002-position-state-machine/plan.md
- **Data Model**: specs/002-position-state-machine/data-model.md
- **Contracts**: specs/002-position-state-machine/contracts/ (Go files)
- **Quickstart**: specs/002-position-state-machine/quickstart.md
