# Feature Specification: PSM Dynamic Trade Sizing from Compounding Balance

**Feature Branch**: `013-psm-dynamic-trade-size`  
**Created**: 2026-03-22  
**Status**: Implemented  
**Closed**: 2026-03-23  
**Input**: User description: "Update the PSM order grid generation so that trade sizes scale dynamically with the compounding account equity. If AmountPerTrade is a percentage (1.0 = 100%), allocated capital is calculated against the current dynamic account balance. If AmountPerTrade is an absolute value (> 1.0), it remains fixed. Allocated capital is then multiplied by Multiplier for leveraged grid volume."

## Overview

The Orchestrator (Feature 012) now maintains a live `runningBalance` that compounds across trade cycles — accumulating realized profits, losses, and monthly capital additions. When it opens a new trade, it passes this dynamic balance to the Position State Machine (PSM).

Currently, the PSM's grid-sizing formula (`ComputeAmountSequence`) reads the static `AccountBalance` from the initial configuration, entirely ignoring the dynamic balance passed in at trade-open time. This makes compounding inoperative: a strategy configured for 100% allocation will always deploy the original starting capital, never the grown equity.

This feature corrects that by ensuring the order grid is priced against the current live balance when percentage-based allocation is configured.

## Constitution Gates (MANDATORY)

- **Green Light Protocol**: All existing unit tests for `ComputeAmountSequence`, the Orchestrator integration tests, and the PSM canonical integration tests must remain green. New unit tests must prove the two core behaviours (percentage scaling against dynamic balance; absolute amount immunity to balance changes). Zero regressions permitted before merge.
- **Fixed-point arithmetic**: All allocated-capital computations — `amountPerTrade × dynamicBalance` and `V = allocatedCapital × multiplier` — MUST use `decimal.Decimal` (shopspring/decimal). No floating-point at any stage of the sizing calculation.
- **BDD acceptance criteria**: All three user stories below carry explicit Given/When/Then scenarios that cover the compounding percentage path, the absolute-value immunity path, and the zero-balance guard. These form the binding acceptance gate.


## User Scenarios & Testing *(mandatory)*

### User Story 1 — Compounding Percentage Allocation Scales With Growing Equity (Priority: P1)

A quantitative analyst has configured a DCA strategy with `AmountPerTrade = 1.0` (meaning "allocate 100% of my current account balance to each trade"). Over several trade cycles the account has grown from 1,000 USDT to 5,000 USDT through realized profits and monthly additions. When the next trade opens, the order grid must be sized against the current 5,000 USDT equity, not the original 1,000 USDT starting capital. Without this, the "compound" feature is a display lie: the balance grows visually but trading remains frozen at inception size.

**Why this priority**: This is the entire purpose of Feature 013 and the direct enabler of compounding. Every other user story and requirement exists to support or protect this core behaviour.

**Independent Test**: Can be fully tested with a unit test: call the grid-sizing computation with `amountPerTrade = 1.0`, `multiplier = 1`, `dynamicBalance = 5000`, `staticConfigBalance = 1000`. Assert that total deployed capital equals exactly `5000.00000000`, not `1000.00000000`.

**Acceptance Scenarios**:

1. **Given** the static configuration declares `account_balance = "1000"` and `amount_per_trade = "1.0"`, **When** a new trade opens with the Orchestrator's `runningBalance = "5000"`, **Then** the total volume (`V`) used for sizing the order grid equals exactly `"5000.00000000"`.

2. **Given** `amount_per_trade = "0.5"` (50%) and `runningBalance = "4000"`, **When** a new trade opens, **Then** `V` equals exactly `"2000.00000000"` (50% of 4000), regardless of the original configuration balance.

3. **Given** `amount_per_trade = "1.0"` and `multiplier = 3` and `runningBalance = "5000"`, **When** a new trade opens, **Then** `V` equals exactly `"15000.00000000"` (5000 × 3).

---

### User Story 2 — Absolute Amount Allocation Is Immune to Balance Growth (Priority: P2)

A risk-managed strategy is configured with a fixed per-trade allocation: `AmountPerTrade = 500` (meaning "deploy exactly 500 USDT per trade regardless of account size"). As the account compounds, this floor must remain intact — the analyst chose an absolute value precisely to cap per-trade exposure. Whether the account holds 1,000 USDT or 50,000 USDT, each trade grid must be sized at exactly 500 USDT (before applying the Multiplier).

**Why this priority**: Absolute allocation is the primary risk-control tool for users who do not want unbounded position growth. Miscalculating this would create an uncontrolled risk profile that contradicts the user's explicit intent.

**Independent Test**: Can be fully tested with a unit test: call the grid-sizing computation with `amountPerTrade = 500`, `multiplier = 1`, `dynamicBalance = 50000`, `staticConfigBalance = 1000`. Assert that total deployed capital equals exactly `500.00000000`.

**Acceptance Scenarios**:

1. **Given** `amount_per_trade = "500"` (absolute value, > 1.0) and `runningBalance = "5000"`, **When** a new trade opens, **Then** `V` equals exactly `"500.00000000"`, identical to the behaviour when `runningBalance = "1000"`.

2. **Given** `amount_per_trade = "500"` and `multiplier = 2` and `runningBalance = "5000"`, **When** a new trade opens, **Then** `V` equals exactly `"1000.00000000"` (500 × 2).

3. **Given** `amount_per_trade = "500"` and `runningBalance = "400"` (balance has fallen below the absolute amount), **When** a new trade opens, **Then** `V` is still calculated as `"500.00000000"` — the system does not silently cap or clamp; the risk guard lives at a higher layer.

---

### User Story 3 — Grid Sizing Boundary: AmountPerTrade = 1.0 Is Treated as 100% Percentage (Priority: P3)

The threshold between percentage and absolute mode is exactly `1.0`. A value of `1.0` means "allocate 100% of the current balance"; any value strictly greater than `1.0` is treated as an absolute USDT amount. This boundary must be unambiguous and consistently applied at the point of grid calculation.

**Why this priority**: The boundary condition is the mathematical pivot of the entire feature. An off-by-one or inclusive/exclusive error here would silently corrupt all trades for users who configure `AmountPerTrade` close to the threshold.

**Independent Test**: Can be fully tested with three boundary unit tests using `dynamicBalance = 2000, multiplier = 1`: (a) `amountPerTrade = 1.0` → `V = 2000`; (b) `amountPerTrade = 1.01` → `V = 1.01`; (c) `amountPerTrade = 0.99` → `V = 1980`. All three must pass simultaneously.

**Acceptance Scenarios**:

1. **Given** `amount_per_trade = "1.0"` (exactly) and `runningBalance = "2000"`, **When** grid sizing is computed, **Then** `V = "2000.00000000"` (treated as 100% percentage).

2. **Given** `amount_per_trade = "1.01"` and `runningBalance = "2000"`, **When** grid sizing is computed, **Then** `V = "1.01000000"` (treated as absolute 1.01 USDT, balance is irrelevant).

3. **Given** `amount_per_trade = "0.5"` and `runningBalance = "2000"`, **When** grid sizing is computed, **Then** `V = "1000.00000000"` (treated as 50% of 2000).

---

### Canonical Test Data & Mathematical Proofs *(MANDATORY FOR CORE DOMAIN)*

The formula for total volume `V` is defined as follows (SDD §2.2):

- **Percentage mode** (`AmountPerTrade ≤ 1.0`): `V = DynamicBalance × AmountPerTrade × Multiplier`
- **Absolute mode** (`AmountPerTrade > 1.0`): `V = AmountPerTrade × Multiplier`

| Input State | Action | Expected Exact Value (Decimal) |
|---|---|---|
| `dynamicBalance=5000`, `apt=1.0`, `m=1` | Compute V (percentage) | `5000.00000000` |
| `dynamicBalance=5000`, `apt=0.5`, `m=1` | Compute V (percentage) | `2000.00000000` |
| `dynamicBalance=5000`, `apt=1.0`, `m=3` | Compute V (percentage × multiplier) | `15000.00000000` |
| `dynamicBalance=5000`, `apt=500`, `m=1` | Compute V (absolute) | `500.00000000` |
| `dynamicBalance=5000`, `apt=500`, `m=2` | Compute V (absolute × multiplier) | `1000.00000000` |
| `dynamicBalance=400`, `apt=500`, `m=1` | Compute V (absolute, balance below floor) | `500.00000000` |
| `dynamicBalance=2000`, `apt=1.0`, `m=1` | Boundary: exactly 1.0 is percentage | `2000.00000000` |
| `dynamicBalance=2000`, `apt=1.01`, `m=1` | Boundary: strictly > 1.0 is absolute | `1.01000000` |

**Rationale**: These values are binding arithmetic specifications. Any implementation producing a different result has a precision or logic error and must not pass review.

### Edge Cases

- **Dynamic balance is zero**: If `runningBalance = "0"` and `AmountPerTrade ≤ 1.0`, then `V = 0`. The system must not divide by zero during order distribution, and should produce an empty or rejected grid — the position must not be opened. Guard logic must prevent a trade from being initiated with zero allocated capital.
- **Dynamic balance is negative** (full account loss): Same outcome as zero — the grid size computes to zero or negative; no trade should open. This state implies the simulation has already halted via liquidation logic in prior cycles.
- **AmountPerTrade exactly at boundary (1.0)**: Must be treated as percentage without remainder or ambiguity. `1.0 ≤ 1.0` is true; the percentage branch is taken.
- **Multiplier = 1**: No leverage scaling. `V = DynamicBalance × AmountPerTrade` (or `V = AmountPerTrade` for absolute). This is the most common configuration and must work identically before and after this change.
- **Sum invariant**: The geometric distribution of `V` across `N` order tiers must still sum to exactly `V` after this change. The last-order adjustment that enforces this invariant (present in the current implementation) must continue to function correctly with a dynamic `V`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When `AmountPerTrade ≤ 1.0`, the system MUST compute total grid volume `V` as `DynamicBalance × AmountPerTrade × Multiplier`, where `DynamicBalance` is the live account equity provided by the Orchestrator at trade-open time.
- **FR-002**: When `AmountPerTrade > 1.0`, the system MUST compute total grid volume `V` as `AmountPerTrade × Multiplier`, independent of the `DynamicBalance` value.
- **FR-003**: The `DynamicBalance` used in FR-001 MUST be the value passed by the Orchestrator when requesting a new trade, not the `AccountBalance` stored in the original static configuration.
- **FR-004**: The system MUST use fixed-point decimal arithmetic for all computations in FR-001 and FR-002. No floating-point representation is permissible at any stage of the volume calculation.
- **FR-005**: When `DynamicBalance ≤ 0` and `AmountPerTrade ≤ 1.0`, the system MUST produce `V = 0` and MUST NOT open a new position, emitting a structured warning event describing the zero-capital guard condition.
- **FR-006**: After computing `V` using the dynamic balance, the geometric order-tier distribution (D_n values) MUST still sum exactly to `V`. The existing sum-invariant adjustment MUST remain in place and continue to operate correctly.
- **FR-007**: The static `AccountBalance` in the configuration object MUST remain unchanged by this feature. It continues to serve as the initial seed for the first trade and for display/reporting purposes only; it is not mutated during the backtest.

### Key Entities

- **DynamicBalance**: The live compounding account equity maintained by the Orchestrator. Represents the current total capital available: initial balance + all realized profits/losses + all monthly additions to date. This is the input to FR-001.
- **AmountPerTrade**: A configuration parameter from the static `Config`. When `≤ 1.0`, it is a fraction of `DynamicBalance`. When `> 1.0`, it is a fixed absolute USDT amount. The boundary is inclusive at 1.0 (1.0 is percentage mode).
- **TotalVolume (V)**: The total USDT capital deployed into a single trade grid, computed from `DynamicBalance` and `AmountPerTrade` per FR-001/FR-002. This is then distributed geometrically across `N` order tiers.
- **Multiplier**: A configuration parameter (integer ≥ 1) that scales `V` to apply leverage. A `Multiplier = 3` means the grid deploys 3× the allocated capital.

## Assumptions

- The Orchestrator correctly computes and maintains `runningBalance` as defined in Feature 012. This feature depends on that value being accurate.
- `AmountPerTrade` is validated as non-negative at config parse time (existing FR from Feature 001). This feature adds no new validation for `AmountPerTrade` itself.
- The boundary of `1.0` for percentage vs. absolute mode is established by the existing SDD §2.2 definition and is not changed by this feature — only the input used in the percentage branch changes.
- Existing tests for `ComputeAmountSequence` that hard-code `AccountBalance = "1000"` will need to be updated to pass a `dynamicBalance` parameter. This is an expected testing update, not a regression.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A backtest starting with 1,000 USDT and growing to 5,000 USDT over multiple trade cycles (with `AmountPerTrade = 1.0`) deploys exactly 5,000 USDT worth of grid orders on the first trade after equity reaches 5,000 USDT — verified by inspecting `TradeOpenedEvent` grid amounts.
- **SC-002**: A backtest with `AmountPerTrade = 500` (absolute) deploys exactly 500 USDT on each trade regardless of account equity, with zero variance across 100 consecutive trade cycles at varying account sizes.
- **SC-003**: All existing canonical integration tests and unit tests for `ComputeAmountSequence` remain green after the change.
- **SC-004**: A zero-balance guard prevents any trade from opening when `DynamicBalance ≤ 0` in percentage mode, producing a structured warning instead of a runtime error or silent incorrect sizing.
