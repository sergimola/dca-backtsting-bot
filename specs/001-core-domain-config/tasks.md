# Task Generation Output: Core Domain Configuration Data Contract

**Feature**: 001-core-domain-config  
**Generated**: 2026-03-08  
**Workflow**: /speckit.tasks  
**Status**: TDD Order (Tests First, Implementation Second)

---

## Executive Summary

This task breakdown implements the core domain configuration and order sequence mathematics in Go using test-driven development (TDD). Tests are written first (failing), then implementation is built to make tests pass. All tasks are organized by user story to enable independent implementation and testing.

**Total Tasks**: 51 tasks across 7 phases  
**Parallelizable Tasks**: 18 (marked [P])  
**MVP Target**: Complete US1 + US2 (32 tasks) for early canonical test validation  
**Critical Path**: US1 → US2 (sequential)  

### Canonical Test Data (MANDATORY)

These exact values MUST appear in test code and implementation must reproduce them exactly:

- **Test Case 1 (Price Sequence):** P_0=100.00, P_1=98.00, P_2=95.84400000, P_3=93.52457520
- **Test Case 2 (Amount Sequence):** R=7.00, A_0=142.85714286, A_1=285.71428571, A_2=571.42857143, sum=1000.00
- **Test Case 3 (Defaults):** 13 parameters with exact defaults from SDD Table 4.1

### Dependency Graph

```
┌─────────────────────────────────────────────────────┐
│ Phase 1: Setup & Project Initialization             │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│ Phase 2: Foundational Infrastructure                │
└────────────────────┬────────────────────────────────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     ┌────────┐ ┌────────┐ ┌────────────┐
     │ US1    │ │ US2    │ │ US3        │
     │Tests →  │ │Tests →  │ │Tests →     │
     │Impl ────┼─┼─Impl ┼──┼─Impl       │ (US2, US3 parallel after US1)
     │ (US4)   │ │       │ │            │
     └────────┘ └────────┘ └────────────┘
          │
          └────────────────────┬──────────────────────────────┐
                              ▼                              ▼
                         ┌────────────┐              ┌──────────────┐
                         │ US4        │              │ Phase 7      │
                         │Tests →     │              │Polish &      │
                         │Impl        │              │Integration  │
                         └────────────┘              └──────────────┘
```

### Parallelization Opportunities

**After US1 completion**, these can execute in **parallel**:
- US2 (Price Sequence) tests + implementation
- US3 (Amount Sequence) tests + implementation  
- US4 (Constraint Validation) tests + implementation

**Within each US phase**, these are parallelizable **[P]**:
- All unit tests (different test files, independent data)
- All acceptance scenario tests (scoped to specific scenarios)
- Implementation files for different components (when not interdependent)

---

## Phase 1: Setup & Project Initialization

**Goal**: Establish Go project structure, dependencies, and test harness  
**Duration**: ~30 min  
**Independent Test Criteria**: Go module resolves, shopspring/decimal installed, test framework working

### Tasks

- [ ] T001 Initialize Go module in core-engine/domain/config/ with `go mod init github.com/dca-bot/core-engine/domain/config`

- [ ] T002 Add shopspring/decimal dependency to core-engine/domain/config/go.mod with `go get github.com/shopspring/decimal@v1.3.1`

- [ ] T003 Create core-engine/domain/config/ directory structure: config.go, sequences.go, config_test.go, sequences_test.go, README.md

- [ ] T004 Create core-engine/domain/config/README.md documenting package purpose, canonical formulas, and SDD references (sections 2.0, 2.1, 2.2, 4.1)

- [ ] T005 [P] Create core-engine/domain/config/config.go with package declaration, imports, and placeholder Config interface skeleton

- [ ] T006 [P] Create core-engine/domain/config/errors.go with ValidationError, SequenceComputationError, PrecisionError, SumInvariantViolation types

- [ ] T007 [P] Create core-engine/domain/config/config_test.go with test package setup and helper functions for comparing Decimal values

- [ ] T008 [P] Create core-engine/domain/config/sequences_test.go with test package setup and sequence-specific test helpers

- [ ] T009 Verify all tests compile and run with `go test ./...` (should have 0 tests passing initially)

---

## Phase 2: Foundational Infrastructure

**Goal**: Implement shared test utilities and test helpers for canonical data validation  
**Duration**: ~45 min  
**Independent Test Criteria**: Decimal comparison helpers work correctly, canonical test data can be embedded in tests, error messages are actionable

### Tasks

- [ ] T010 [P] Create test helper function for Decimal equality checks with tolerance (allow for rounding): `DecimalEqual(expected, actual decimal.Decimal, tolerance string) bool` in config_test.go

- [ ] T011 [P] Create test helper function for validating price sequence monotonicity: `AssertMonotonicDecreasing(seq []*decimal.Decimal) error` in sequences_test.go

- [ ] T012 [P] Create test helper function for validating amount sequence sum invariant: `AssertSumInvariant(seq []*decimal.Decimal, expectedSum decimal.Decimal) error` in sequences_test.go

- [ ] T013 Create canonical test data package-level constants and functions in config_test.go:
  - TestCase1_CurrentPrice = 100.00
  - TestCase1_PriceEntry = 2.0  
  - TestCase1_PriceScale = 1.1
  - TestCase1_NumOrders = 3
  - TestCase1_ExpectedPrices = [100.00, 98.00, 95.84400000, 93.52457520]

- [ ] T014 Create canonical test data package-level constants in sequences_test.go:
  - TestCase2_Capital = 1000
  - TestCase2_AmountScale = 2.0
  - TestCase2_Multiplier = 1
  - TestCase2_NumOrders = 3
  - TestCase2_ExpectedR = 7.00
  - TestCase2_ExpectedAmounts = [142.85714286, 285.71428571, 571.42857143]
  - TestCase2_ExpectedSum = 1000.00

- [ ] T015 Create canonical test data package-level constants in config_test.go for Test Case 3 (all 13 default parameters with exact values from SDD Table 4.1)

---

## Phase 3: User Story 1 (Config Entity + Validation) — TDD Approach

**Goal**: Implement Config data structure with 13 parameters, canonical defaults, and validation  
**User Story**: US1 - Initialize Configuration Data Contract  
**Priority**: P1  
**Duration**: ~3.5 hours (tests first, then implementation)  
**Independent Test Criteria**: 
- Config instantiation with defaults passes all 13 parameter checks
- Type validation rejects invalid types with clear error messages
- Constraint validation rejects invalid values (margin_type, multiplier, number_of_orders)
- All 4 acceptance scenarios executable as automated tests
- Test Case 3 validates exact canonical defaults

### Test Tasks (Write First — All Will Fail Initially)

- [ ] T016 [P] [US1] Write unit test for Config instantiation with no parameters in core-engine/domain/config/config_test.go:
  - Create Config with NewConfig()
  - Assert all 13 parameters set to canonical defaults
  - Assert trading_pair = "LTC/USDT", price_entry = 2.0, etc.
  - **Test Data**: Test Case 3 exact values

- [ ] T017 [P] [US1] Write unit test for Config instantiation with custom trading_pair in core-engine/domain/config/config_test.go:
  - Create Config with WithTradingPair("BTC/USDT")  
  - Assert provided trading_pair stored correctly
  - Assert all other 12 parameters use defaults
  - Assert validation passes

- [ ] T018 [P] [US1] Write unit test for invalid trading_pair type (number instead of string) in core-engine/domain/config/config_test.go:
  - Attempt Config with trading_pair = 123 (invalid type)
  - Assert NewConfig returns validation error
  - Assert error message contains "trading_pair"
  - **Expected Error**: "Config validation failed: trading_pair=123 (type must be string)"

- [ ] T019 [P] [US1] Write unit test for invalid margin_type in core-engine/domain/config/config_test.go:
  - Attempt Config with margin_type = "leverage" (invalid enum)
  - Assert NewConfig returns ValidationError
  - Assert error message: "margin_type must be 'cross' or 'isolated', got 'leverage'"

- [ ] T020 [P] [US1] Write unit test for invalid multiplier (less than 1) in core-engine/domain/config/config_test.go:
  - Attempt Config with multiplier = 0
  - Assert NewConfig returns ValidationError with message "multiplier must be >= 1"

- [ ] T021 [P] [US1] Write unit test for invalid number_of_orders (zero or negative) in core-engine/domain/config/config_test.go:
  - Attempt Config with number_of_orders = 0
  - Assert NewConfig returns ValidationError with message "number_of_orders must be >= 1"

- [ ] T022 [P] [US1] Write unit test for negative account_balance in core-engine/domain/config/config_test.go:
  - Attempt Config with account_balance = -100
  - Assert NewConfig returns ValidationError with message "account_balance must be non-negative"

- [ ] T023 [P] [US1] Write unit test for Config edge case: minimum balances (0.01) in core-engine/domain/config/config_test.go:
  - Create Config with account_balance = "0.01"
  - Assert validation passes
  - Assert account_balance stored as Decimal "0.01"

- [ ] T024 [P] [US1] Write unit test for Acceptance Scenario 1 ("all 13 parameters stored correctly") in core-engine/domain/config/config_test.go:
  - Create Config with all 13 parameters explicitly provided (non-default values)
  - Assert each parameter retrieved via getter matches provided value exactly
  - **Test Data**: Use custom values (e.g., trading_pair="BTC/USD", price_entry=3.5, etc.)

- [ ] T025 [P] [US1] Write unit test for Acceptance Scenario 2 ("defaults applied when missing") in core-engine/domain/config/config_test.go:
  - Create Config with only trading_pair provided
  - Assert all 12 omitted parameters match canonical defaults exactly
  - **Test Data**: Test Case 3

- [ ] T026 [P] [US1] Write unit test for Acceptance Scenario 3 ("type validation with clear error") in core-engine/domain/config/config_test.go:
  - Test multiple type violations (string for multiplier, int for price_entry)
  - Assert each returns validation error with parameter name and reason

- [ ] T027 [P] [US1] Write unit test for Acceptance Scenario 4 ("edge-case numeric values pass") in core-engine/domain/config/config_test.go:
  - Create Config with edge cases: account_balance=0.01, amount_per_trade=0.5
  - Assert validation passes (no range constraints imposed)

- [ ] T028 [P] [US1] Write unit test for Config serialization to JSON in core-engine/domain/config/config_test.go:
  - Create Config with known values
  - Call ToJSON()
  - Parse JSON, verify all Decimal fields preserve precision
  - Assert no precision loss (e.g., 2.0 not truncated to 2)

- [ ] T029 [P] [US1] Write unit test for Config deserialization from JSON in core-engine/domain/config/config_test.go:
  - Create Config, serialize to JSON, deserialize
  - Assert round-trip produces identical Config (SC-005)
  - Verify all Decimal precision preserved

- [ ] T030 [P] [US1] Write unit test for Config getters (all 13 parameters) in core-engine/domain/config/config_test.go:
  - Verify each getter (TradingPair(), StartDate(), PriceEntry(), ..., ExitOnLastOrder()) returns correct type
  - Assert no mutations possible (read-only)

### Implementation Tasks (Write After Tests Fail)

- [ ] T031 [US1] Implement ConfigImpl struct in core-engine/domain/config/config.go with 13 fields:
  - tradingPair: string
  - startDate: string
  - endDate: string
  - priceEntry: decimal.Decimal
  - priceScale: decimal.Decimal
  - amountScale: decimal.Decimal
  - numberOfOrders: int
  - amountPerTrade: decimal.Decimal
  - marginType: string
  - multiplier: decimal.Decimal
  - takeProfitDistancePercent: decimal.Decimal
  - accountBalance: decimal.Decimal
  - monthlyAddition: decimal.Decimal
  - exitOnLastOrder: bool

- [ ] T032 [US1] Implement NewConfig() constructor in core-engine/domain/config/config.go:
  - Initialize all 13 parameters with canonical defaults (from T013-T015)
  - Apply functional options if provided
  - Call Validate() before returning
  - Return error if validation fails (not a Config instance)

- [ ] T033 [US1] Implement Option type and all 13 With*() functional options in core-engine/domain/config/config.go:
  - WithTradingPair(pair string) Option
  - WithStartDate(date string) Option
  - ... (continue for all 13)
  - WithExitOnLastOrder(exit bool) Option

- [ ] T034 [US1] Implement Validate() method in core-engine/domain/config/config.go:
  - FR-003: Type validation for all 13 parameters
  - FR-009: margin_type ∈ {'cross', 'isolated'}
  - FR-010: multiplier >= 1
  - FR-011: number_of_orders >= 1
  - FR-012: All numeric parameters >= 0
  - Return ValidationError with actionable message on failure
  - Complete in <1ms (SC-004)

- [ ] T035 [US1] Implement all 13 getter methods in core-engine/domain/config/config.go:
  - TradingPair() string
  - StartDate() string
  - EndDate() string
  - PriceEntry() decimal.Decimal
  - ... (continue for all 13)
  - ExitOnLastOrder() bool

- [ ] T036 [US1] Implement ToJSON() method in core-engine/domain/config/config.go:
  - Serialize all 13 Config parameters to JSON
  - Use shopspring/decimal's json.Marshaler for Decimal fields
  - Preserve all Decimal precision
  - Return JSON string (no data loss, SC-005)

- [ ] T037 [US1] Implement FromJSON() method in core-engine/domain/config/config.go:
  - Deserialize JSON to Config struct
  - Validate all parameters after deserialization
  - Verify round-trip fidelity (parse twice, compare)

- [ ] T038 [US1] Run Phase 3 test suite in core-engine/domain/config/:
  - Execute `go test ./... -v -run ".*US1.*"`
  - Verify all tests T016-T030 pass (green)
  - Assert no failing or skipped tests (SC-003 requirement)
  - Assert latency <1ms for Config instantiation

---

## Phase 4: User Story 2 (Price Sequence Computation) — TDD Approach

**Goal**: Implement Price Sequence formula $P_n$ with exact Decimal values  
**User Story**: US2 - Compute Price Sequence $P_n$  
**Priority**: P1  
**Duration**: ~3 hours  
**Independent Test Criteria**:
- ComputePriceSequence() produces exact canonical values (Test Case 1)
- All N prices computed correctly in strict decreasing order
- Recurrence relation verified for each price level
- All 4 acceptance scenarios pass
- Zero precision loss

### Test Tasks (Write First — All Will Fail Initially)

- [ ] T039 [P] [US2] Write unit test for Price Sequence canonical test (Test Case 1) in core-engine/domain/config/sequences_test.go:
  - Create Config with: current_price=100, price_entry=2.0, price_scale=1.1, number_of_orders=3
  - Call ComputePriceSequence(100)
  - Assert prices: P_0=100.00, P_1=98.00, P_2=95.84400000, P_3=93.52457520
  - Use DecimalEqual helper (T010) with zero tolerance (exact match required)
  - **Test Data**: Canonical Test Case 1 values

- [ ] T040 [P] [US2] Write unit test for price sequence monotonicity in core-engine/domain/config/sequences_test.go:
  - Create multiple Config instances with valid price_entry>0, price_scale>0
  - For each: call ComputePriceSequence(), verify strictly decreasing (P_0 > P_1 > ... > P_N-1)
  - Use AssertMonotonicDecreasing helper (T011)
  - **Test Cases**: Test with price_scale=1.0, 1.1, 2.0; price_entry=0.5, 2.0, 5.0

- [ ] T041 [P] [US2] Write unit test for price sequence scale factor (Acceptance Scenario 3) in core-engine/domain/config/sequences_test.go:
  - Compute price sequence for two configs: one with price_scale=1.0, one with price_scale=2.0
  - Verify that with larger scale, price deviations increase faster
  - Assert successive differences multiply by scale factor correctly

- [ ] T042 [P] [US2] Write unit test for recurrence relation (Acceptance Scenario 4) in core-engine/domain/config/sequences_test.go:
  - For each P_n, verify it matches P_{n-1} * (1 - delta/100 * s_p^{n-1})
  - Use exact arithmetic: compute expected and compare with DecimalEqual
  - **Formula**: P_n = P_{n-1} * (1 - price_entry/100 * price_scale^(n-1))

- [ ] T043 [P] [US2] Write unit test for edge case: price_scale=1.0 (uniform spacing) in core-engine/domain/config/sequences_test.go:
  - Create Config with price_scale=1.0, price_entry=2.0, number_of_orders=5
  - Verify prices form uniform decreasing sequence
  - Assert each difference equals price_entry/100 * P_prev

- [ ] T044 [P] [US2] Write unit test for edge case: number_of_orders=1 in core-engine/domain/config/sequences_test.go:
  - Create Config with number_of_orders=1
  - Call ComputePriceSequence(100)
  - Assert result is [100.00] (single element, no safety orders)

- [ ] T045 [P] [US2] Write unit test for edge case: current_price=0 or negative in core-engine/domain/config/sequences_test.go:
  - Attempt ComputePriceSequence(0) and ComputePriceSequence(-50)
  - Assert SequenceComputationError returned (prices must be positive)

- [ ] T046 [P] [US2] Write unit test for Acceptance Scenario 1 (exact price computation) in core-engine/domain/config/sequences_test.go:
  - Given P_0=100, delta=2.0, price_scale=1.1, N=3
  - Verify P_1 = 98.00, P_2 = 96.0396, P_3 = 94.07950484
  - Compare with test data from quickstart.md

- [ ] T047 [P] [US2] Write unit test for Acceptance Scenario 2 (monotonicity guarantee) in core-engine/domain/config/sequences_test.go:
  - For all valid parameter combinations: verify P_1 < P_0 always holds
  - Test with various current_price, price_entry, price_scale values

### Implementation Tasks (Write After Tests Fail)

- [ ] T048 [US2] Implement ComputePriceSequence(currentPrice decimal.Decimal) method in core-engine/domain/config/sequences.go:
  - Implements FR-004 & FR-005
  - P_0 = currentPrice
  - P_1 = P_0 * (1 - priceEntry/100)
  - For n >= 2: P_n = P_{n-1} * (1 - priceEntry/100 * priceScale^{n-1})
  - Use decimal.Pow for exponentiation (priceScale^{n-1})
  - Return []*decimal.Decimal array of length numberOfOrders
  - Validate currentPrice > 0; return error if invalid

- [ ] T049 [US2] Implement price sequence computation with exact Decimal rounding in core-engine/domain/config/sequences.go:
  - Use ROUND_HALF_UP semantics (shopspring/decimal default)
  - All intermediate calculations via Decimal.Mul(), Div(), Sub()
  - Final prices match canonical test data exactly (T039)

- [ ] T050 [US2] Implement PriceSequence type methods in core-engine/domain/config/config.go:
  - IsMonotonicDecreasing() bool
  - Min() *decimal.Decimal
  - Max() *decimal.Decimal
  - Return error if any prices nil or invariants violated

- [ ] T051 [US2] Run Phase 4 test suite in core-engine/domain/config/:
  - Execute `go test ./... -v -run ".*US2.*"`
  - Verify all tests T039-T047 pass (green)
  - Assert no failing or skipped tests (SC-003)
  - Verify canonical Test Case 1 matches exactly

---

## Phase 5: User Story 3 (Amount Sequence Computation) — TDD Approach

**Goal**: Implement Amount Sequence formula $A_n$ with sum preservation  
**User Story**: US3 - Compute Amount Sequence $A_n$  
**Priority**: P1  
**Duration**: ~3.5 hours  
**Independent Test Criteria**:
- ComputeAmountSequence() produces exact canonical values (Test Case 2)
- Sum invariant preserved: sum(A_n) = C*m exactly (SC-007)
- Normalization factor R computed exactly
- All 5 acceptance scenarios pass
- Zero precision loss via geometric scaling

### Test Tasks (Write First — All Will Fail Initially)

- [ ] T052 [P] [US3] Write unit test for Amount Sequence canonical test (Test Case 2) in core-engine/domain/config/sequences_test.go:
  - Create Config with: amount_per_trade=1000, amount_scale=2.0, multiplier=1, number_of_orders=3
  - Call ComputeAmountSequence()
  - Assert R = 7.00
  - Assert amounts: A_0=142.85714286, A_1=285.71428571, A_2=571.42857143
  - Assert sum = 1000.00 (exact, zero rounding loss)
  - Use DecimalEqual helper with zero tolerance
  - **Test Data**: Canonical Test Case 2 values

- [ ] T053 [P] [US3] Write unit test for amount sequence sum invariant in core-engine/domain/config/sequences_test.go:
  - Create multiple Config instances with valid amount_scale>0, multiplier>=1
  - For each: ComputeAmountSequence(), verify sum = amount_per_trade * multiplier exactly
  - Use AssertSumInvariant helper (T012)
  - **Test Cases**: Various amount_per_trade (10, 100, 1000), multiplier (1, 2, 3), amount_scale (1.5, 2.0, 3.0)

- [ ] T054 [P] [US3] Write unit test for normalization factor R in core-engine/domain/config/sequences_test.go:
  - For various amount_scale and number_of_orders:
  - Verify R = (amount_scale^N - 1) / (amount_scale - 1) computed correctly
  - Test edge case: amount_scale=1.0 → R=N (uniform distribution)

- [ ] T055 [P] [US3] Write unit test for amount sequence scaling (Acceptance Scenario 4) in core-engine/domain/config/sequences_test.go:
  - Create Config with multiplier=2
  - Compute AmountSequence
  - Verify each A_n multiplied by 2 compared to multiplier=1 case
  - Assert sum = amount_per_trade * 2

- [ ] T056 [P] [US3] Write unit test for amount sequence geometric ordering in core-engine/domain/config/sequences_test.go:
  - For amount_scale > 1: verify A_0 < A_1 < ... < A_{N-1}
  - For amount_scale = 1.0: verify all A_n equal (uniform)
  - For amount_scale < 1 (if supported): verify A_0 > A_1 > ... (decreasing)

- [ ] T057 [P] [US3] Write unit test for edge case: amount_scale=1.0 in core-engine/domain/config/sequences_test.go:
  - Create Config with amount_scale=1.0, amount_per_trade=1000, number_of_orders=3
  - Verify R = 3 (N)
  - Verify all amounts equal: 1000/3 = 333.33333333

- [ ] T058 [P] [US3] Write unit test for dynamic amount_per_trade (Acceptance Scenario 5) in core-engine/domain/config/sequences_test.go:
  - Create Config with amount_per_trade=0.5 (fraction of equity)
  - Note: This is deferred to runtime; Config stores raw value
  - Verify ComputeAmountSequence uses provided amount_per_trade as-is (no interpretation in Config)

- [ ] T059 [P] [US3] Write unit test for edge case: number_of_orders=1 in core-engine/domain/config/sequences_test.go:
  - Create Config with number_of_orders=1
  - Call ComputeAmountSequence()
  - Assert result is [amount_per_trade * multiplier] (single element)

- [ ] T060 [P] [US3] Write unit test for Acceptance Scenario 1 (exact amount computation) in core-engine/domain/config/sequences_test.go:
  - Given C=1000, s_a=2.0, m=1, N=3
  - Verify A_0=142.85714286, A_1=285.71428571, A_2=571.42857143
  - Verify sum = 1000 exactly

- [ ] T061 [P] [US3] Write unit test for Acceptance Scenario 2 (sum validation) in core-engine/domain/config/sequences_test.go:
  - Compute amounts for various configs
  - Verify sum(A_n) = C*m exactly (no rounding loss)
  - Test all combinations: amount_per_trade x multiplier x amount_scale x number_of_orders

### Implementation Tasks (Write After Tests Fail)

- [ ] T062 [US3] Implement ComputeAmountSequence() method in core-engine/domain/config/sequences.go:
  - Implements FR-006 & FR-007
  - Compute R = (amountScale^N - 1) / (amountScale - 1), handling amountScale=1.0 case → R=N
  - For each i: A_i = amountPerTrade * multiplier * amountScale^i / R
  - Use decimal.Pow for exponentiation
  - Return []*decimal.Decimal array of length numberOfOrders
  - Verify sum invariant: sum(A_n) must equal amountPerTrade * multiplier exactly

- [ ] T063 [US3] Implement amount sequence computation with exact Decimal arithmetic in core-engine/domain/config/sequences.go:
  - ROUND_HALF_UP semantics throughout
  - All operations via decimal.Decimal (no float conversions)
  - Final amounts match canonical test data exactly (T052)
  - Sum invariant maintained to last digit (SC-007)

- [ ] T064 [US3] Implement AmountSequence type methods in core-engine/domain/config/config.go:
  - Sum() (decimal.Decimal, error) — returns total capital
  - Min() *decimal.Decimal — returns smallest order
  - Max() *decimal.Decimal — returns largest order
  - Verify sum invariant; return SumInvariantViolation error if violated

- [ ] T065 [US3] Run Phase 5 test suite in core-engine/domain/config/:
  - Execute `go test ./... -v -run ".*US3.*"`
  - Verify all tests T052-T061 pass (green)
  - Assert no failing or skipped tests (SC-003)
  - Verify canonical Test Case 2 matches exactly
  - Verify sum invariant holds for all test cases

---

## Phase 6: User Story 4 (Constraint Validation) — TDD Approach

**Goal**: Comprehensive validation of Config against all domain constraints  
**User Story**: US4 - Validate Configuration Against Domain Constraints  
**Priority**: P2  
**Duration**: ~2 hours  
**Independent Test Criteria**:
- All constraint validations work correctly (FR-009 through FR-012)
- Invalid configs rejected with actionable errors
- Edge cases (E1–E5) handled correctly
- All 5 acceptance scenarios pass

### Test Tasks (Write First — All Will Fail Initially)

- [ ] T066 [P] [US4] Write unit test for margin_type validation (Acceptance Scenario 1) in core-engine/domain/config/config_test.go:
  - Create Config with margin_type='cross' → should pass
  - Create Config with margin_type='isolated' → should pass
  - Create Config with margin_type='leverage' → should fail with clear error

- [ ] T067 [P] [US4] Write unit test for multiplier constraint (Acceptance Scenario 2) in core-engine/domain/config/config_test.go:
  - Create Config with multiplier >= 1 → should pass
  - Create Config with multiplier < 1 (e.g., 0.5) → should fail
  - Create Config with multiplier = 0 → should fail
  - Assert error message references multiplier constraint

- [ ] T068 [P] [US4] Write unit test for number_of_orders constraint (Acceptance Scenario 3) in core-engine/domain/config/config_test.go:
  - Create Config with number_of_orders >= 1 → should pass
  - Create Config with number_of_orders = 0 → should fail
  - Create Config with number_of_orders = -5 → should fail
  - Assert error message references minimum orders constraint

- [ ] T069 [P] [US4] Write unit test for realistic cryptocurrency trading parameters (Acceptance Scenario 5) in core-engine/domain/config/config_test.go:
  - Create Config with realistic values: trading_pair='BTC/USDT', account_balance=5000, amount_per_trade=100
  - Assert validation passes
  - Assert all 13 parameters are correct types and values

- [ ] T070 [P] [US4] Write unit test for all numeric constraints together in core-engine/domain/config/config_test.go:
  - Test all non-negative constraints: price_entry, price_scale, amount_scale, amount_per_trade, account_balance, monthly_addition, multiplier
  - Create configs with negative values for each
  - Assert each returns validation error with parameter name

- [ ] T071 [P] [US4] Write unit test for start_date <= end_date constraint in core-engine/domain/config/config_test.go:
  - Create Config with start_date='2024-01-02' <= end_date='2024-01-05' → should pass
  - Create Config with start_date='2024-01-10' > end_date='2024-01-05' → should fail
  - Assert clear error message

- [ ] T072 [P] [US4] Write unit test for edge case (E3): number_of_orders=1 in core-engine/domain/config/config_test.go:
  - Create Config with number_of_orders=1
  - Assert validation passes (no extra constraint requiring N >= 2)
  - Verify only P_0 and A_0 computed (no safety orders)

- [ ] T073 [P] [US4] Write unit test for edge case (E5): very small account_balance in core-engine/domain/config/config_test.go:
  - Create Config with account_balance=0.01 (minimum)
  - Assert validation passes (no arbitrary range constraints)
  - Create Config with account_balance=0 → should fail (strictly positive)

### Implementation Tasks (Write After Tests Fail)

- [ ] T074 [US4] Enhance Validate() method in core-engine/domain/config/config.go with all constraints:
  - FR-009: margin_type ∈ {'cross', 'isolated'} — already in T034, verify coverage
  - FR-010: multiplier >= 1 — already in T034, verify coverage
  - FR-011: number_of_orders >= 1 — already in T034, verify coverage
  - FR-012: All numeric non-negative — already in T034, verify coverage
  - Add: start_date <= end_date (handle ISO 8601 format)
  - Add: price_entry > 0, price_scale > 0, amount_scale > 0 (geometric parameters required)
  - All error messages contain parameter name and actionable reason

- [ ] T075 [US4] Add edge case handling in Validate() for E1–E5 in core-engine/domain/config/config.go:
  - E1: amount_per_trade <= 1.0 → Store as-is; runtime interpretation for equity fraction
  - E2: amount_scale = 1.0 → Handled in ComputeAmountSequence (R=N, uniform ordering)
  - E3: number_of_orders = 1 → Allowed; ComputePriceSequence/ComputeAmountSequence return single-element arrays
  - E4: Invalid margin_type → Rejected in validation
  - E5: Very small account_balance → Allowed (>=0.01); trading feasibility separate concern

- [ ] T076 [US4] Run Phase 6 test suite in core-engine/domain/config/:
  - Execute `go test ./... -v -run ".*US4.*"`
  - Verify all tests T066-T073 pass (green)
  - Assert no failing or skipped tests (SC-003)

---

## Phase 7: Polish & Integration

**Goal**: Documentation, error handling, and cross-cutting concerns  
**Duration**: ~2 hours  
**Independent Test Criteria**:
- All 15 FRs have passing test coverage (SC-003)
- SDD traceability documented (FR-015)
- All 3 canonical test cases pass
- 100% of 18 BDD acceptance scenarios executable

### Tasks

- [ ] T077 [P] Create comprehensive docstrings in core-engine/domain/config/config.go:
  - Document each method with SDD section references
  - Include formula descriptions (FR-004, FR-006)
  - Document canonical test data references
  - Example: "// ComputePriceSequence computes the price sequence using formula from SDD §2.1, Eq. E2.1"

- [ ] T078 [P] Create comprehensive docstrings in core-engine/domain/config/sequences.go:
  - Document geometric scaling formulas
  - Document edge cases (amount_scale=1.0, number_of_orders=1)
  - Include test case references

- [ ] T079 [P] Add SDD traceability comments throughout core-engine/domain/config/config.go:
  - Mark each Config parameter with SDD Section 4.1 reference
  - Mark validation constraints with FR numbers (FR-009 through FR-012)
  - Mark sequence formulas with SDD §2.1 and §2.2 references

- [ ] T080 [P] Create core-engine/domain/config/README.md with comprehensive documentation:
  - Package purpose and DCA strategy overview
  - All 13 Config parameters with defaults and constraints
  - Price Sequence formula (SDD §2.1)
  - Amount Sequence formula (SDD §2.2)
  - Canonical test data (Test Cases 1, 2, 3) with exact expected values
  - Edge case handling (E1–E5)
  - Example usage code (Config instantiation, sequence computation)

- [ ] T081 [P] Add example code in core-engine/domain/config/README.md:
  - Full worked example: Create Config → Validate → Compute sequences → Verify canonical data
  - Error handling patterns (ValidationError, SequenceComputationError)
  - Serialization/deserialization round-trip

- [ ] T082 Create comprehensive FR-to-test mapping document in core-engine/domain/config/:
  - FR-001: Tests T016-T019, T024 (Config struct with 13 parameters)
  - FR-002: Tests T016, T025 (canonical defaults)
  - FR-003: Tests T018-T022, T026 (type validation)
  - FR-004: Tests T039-T046 (Price Sequence formula)
  - FR-005: Tests T039-T046 (Price Sequence array output)
  - FR-006: Tests T052-T062 (Amount Sequence formula)
  - FR-007: Tests T052-T062, T064 (Amount Sequence array, sum invariant)
  - FR-008: Test T058 (dynamic amount_per_trade interpretation)
  - FR-009: Tests T019, T066 (margin_type validation)
  - FR-010: Tests T020, T067 (multiplier constraint)
  - FR-011: Tests T021, T068 (number_of_orders constraint)
  - FR-012: Tests T022, T070 (non-negative constraint)
  - FR-013: All tests (Decimal fixed-point arithmetic)
  - FR-014: Tests T028-T029 (serialization)
  - FR-015: Documentation (this task T082, T077-T080)

- [ ] T083 [P] Create test summary document in core-engine/domain/config/:
  - List all 51 tasks
  - Count tests per phase: Phase 3 (15 tests), Phase 4 (9 tests), Phase 5 (10 tests), Phase 6 (8 tests)
  - List all 18 BDD acceptance scenarios with test task numbers
  - Confirm all 3 canonical test cases covered

- [ ] T084 [P] Add error handling best practices documentation in core-engine/domain/config/README.md:
  - How to handle ValidationError (type assert, extract parameter name)
  - How to handle SequenceComputationError (retry with different params?)
  - How to verify sum invariant and precision

- [ ] T085 Run full test suite with all phases in core-engine/domain/config/:
  - Execute `go test ./... -v`
  - Count passing tests (target: all tests passing)
  - Verify no failing or skipped tests (SC-003: 100% pass rate)
  - Assert latency <1ms for Config instantiation (SC-001)

- [ ] T086 Generate test coverage report in core-engine/domain/config/:
  - Execute `go test ./... -cover`
  - Target coverage: >95% for all package code
  - Identify any uncovered branches and add tests if needed

- [ ] T087 Run canonical test data verification in core-engine/domain/config/:
  - Verify Test Case 1 (Price Sequence): P values match exactly
  - Verify Test Case 2 (Amount Sequence): A values match exactly, sum=1000.00
  - Verify Test Case 3 (Defaults): All 13 defaults match SDD Table 4.1
  - Assert zero precision loss (SC-002)

- [ ] T088 Create BDD acceptance test summary in core-engine/domain/config/:
  - Document 18 acceptance scenarios (4 per user story)
  - Map each scenario to test task number
  - Confirm all scenarios are Given/When/Then executable

- [ ] T089 Verify constitution gates before merge in core-engine/domain/config/:
  - ✅ Green Light Protocol: All tests green (SC-003)
  - ✅ Fixed-Point Arithmetic: All math via decimal.Decimal, ROUND_HALF_UP (FR-013)
  - ✅ BDD Acceptance: All 18 scenarios executable (test coverage)
  - ✅ SDD Canonical Truth: Test Cases 1, 2, 3 pass (SC-002)
  - ✅ No live trading: Config is data structure only (FR-001)

- [ ] T090 Create INTEGRATION_CHECKLIST.md in core-engine/domain/config/:
  - Before merging to main: confirm all 51 tasks complete
  - All tests passing, no skipped tests
  - All 15 FRs have dedicated test coverage
  - All canonical test data verified
  - SDD traceability complete
  - Documentation complete and reviewed
  - Zero TODO/FIXME comments in code

---

## Implementation Strategy & MVP Scope

### MVP Definition (Minimal Viable Product)

**Complete by end of Phase 4 (US1 + US2)** to get working, testable product:
- ✅ Config entity instantiation with all 13 parameters + canonical defaults (US1)
- ✅ Config validation (type checking + constraint checking) (US1)
- ✅ Price Sequence computation with exact Decimal values (US2)
- ✅ Canonical test data validation (Test Cases 1, 3)
- ✅ BDD acceptance scenario coverage for US1 & US2

**Phase out to production**:
- Deploy core-engine/domain/config/ as library in backtest orchestrator
- Verify canonical test data matches legacy Python bot output exactly
- Proceed with US3 (Amount Sequence) + US4 (Constraint Validation) incrementally

### Incremental Delivery Phases

1. **MVP (Phase 1-2 + Phase 3-4)**: Config + Price Sequence (32 tasks, ~6.5 hours)
   - Enables early validation against canonical data
   - Allows parallel team effort on other features
   - Blocking: US1 must complete before US2

2. **Phase 2 (Phase 5-6)**: Amount Sequence + Full Validation (18 tasks, ~5.5 hours)
   - Adds complete formula coverage
   - Integrates full domain constraint validation
   - Can run in parallel with other domain features after Phase 4

3. **Phase 3 (Phase 7)**: Polish & Documentation (14 tasks, ~2 hours)
   - Finalize SDD traceability
   - Complete documentation and examples
   - Verification and integration checklist

### Parallelization Across Teams

After **Phase 2 completion** (US1 complete), assign separate teams:
- **Team A**: US2 (Price Sequence tests + implementation, T039-T051) — 9 tasks, ~3 hours
- **Team B**: US3 (Amount Sequence tests + implementation, T052-T065) — 14 tasks, ~3.5 hours  
- **Team C**: US4 (Constraint Validation tests + implementation, T066-T076) — 11 tasks, ~2 hours
- **Parallel**: Phase 7 documentation (T077-T090) — 14 tasks, ~2 hours (can start after T034)

### Dependency Verification (Before Proceeding to Next Phase)

- **Phase 1 → Phase 2**: All project setup tasks complete (T001-T009)
- **Phase 2 → Phase 3**: Test helpers functional (T010-T015)
- **After Phase 3 → Phase 4**: All US1 tests passing (T016-T030), Config implementation complete (T031-T038)
- **After Phase 3 → Phase 5/6**: Config interface stable, ready for consumption by sequences

---

## Success Criteria (From Spec)

### Test Coverage (SC-003)
- [ ] All 15 FRs (FR-001–FR-015) have passing automated test cases
- [ ] Zero failing tests, zero skipped tests before merge
- [ ] Test tasks: T016-T030 (US1), T039-T047 (US2), T052-T061 (US3), T066-T073 (US4)

### Canonical Data Validation (SC-002)
- [ ] Test Case 1 (Price Sequence): P values exact to last digit
- [ ] Test Case 2 (Amount Sequence): A values exact, sum=C*m exactly
- [ ] Test Case 3 (Defaults): All 13 parameters match SDD Table 4.1 exactly
- [ ] Test tasks: T016 (defaults), T039 (prices), T052 (amounts)

### Performance (SC-001 & SC-004)
- [ ] Config instantiation <1ms (task T038, T085)
- [ ] Validation  <1ms (task T034, T085)
- [ ] All test latencies recorded in T085-T086

### BDD Acceptance (SC-010)
- [ ] 18 acceptance scenarios (4 per user story) executable as tests
- [ ] Mapping in task T088
- [ ] All Given/When/Then scenarios automated

### SDD Traceability (FR-015, SC-008)
- [ ] All formulas documented with SDD section references
- [ ] All parameters documented against SDD Table 4.1
- [ ] Documentation complete in T077-T082
- [ ] Verification in T089

---

## Summary: By the Numbers

| Metric | Count |
|--------|-------|
| **Total Tasks** | 51 |
| **Test Tasks** | 28 |
| **Implementation Tasks** | 17 |
| **Documentation/Verification Tasks** | 6 |
| **Parallelizable Tasks [P]** | 18 |
| **Total Estimated Duration** | ~13.5 hours |
| **MVP Duration (Phases 1-4)** | ~6.5 hours |
| **Canonical Test Cases** | 3 |
| **BDD Acceptance Scenarios** | 18 |
| **Functional Requirements** | 15 |
| **Success Criteria** | 10 |
| **Edge Cases** | 5 (E1–E5) |

---

## Files Created/Modified

```
core-engine/domain/config/
├── go.mod                    # Go module definition (T001)
├── config.go                 # Config interface + implementation (T031-T037, T077)
├── sequences.go              # Price/Amount sequence computation (T048-T050, T062-T064, T078)
├── config_test.go            # Config tests (T016-T030, T066-T073)
├── sequences_test.go         # Sequence tests (T039-T047, T052-T061)
├── errors.go                 # Error types (T006)
├── README.md                 # Documentation (T004, T080-T081)
└── INTEGRATION_CHECKLIST.md  # Pre-merge verification (T090)
```

---

## Next Steps (Post-Task Generation)

1. **Assign tasks to team members** based on parallelization opportunities
2. **Set up git branch** `001-core-domain-config` for feature development
3. **Create project board** linking tasks to PRs and reviews
4. **Run Phase 1 tasks** (T001-T009) immediately to unblock downstream work
5. **Execute Phase 2 & 3 tasks** in sequence (dependency chain)
6. **After Phase 3 completion**, parallelize Phase 4, 5, 6 across 3 teams
7. **Verify canon data** in Phase 7 (T087) before merge
8. **Constitutional gate review** (T089) before main branch merge

---

**Generated by**: /speckit.tasks workflow  
**Date**: 2026-03-08  
**Feature**: 001-core-domain-config (Core Domain Configuration Data Contract and Order Sequence Math)  
**Branch**: `001-core-domain-config`  
**Go Version**: 1.20+  
**Key Dependency**: github.com/shopspring/decimal v1.3.1
