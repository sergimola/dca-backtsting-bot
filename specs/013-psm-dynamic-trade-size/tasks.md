# Tasks: PSM Dynamic Trade Sizing from Compounding Balance

**Feature Branch**: `013-psm-dynamic-trade-size`
**Input**: Design documents from `specs/013-psm-dynamic-trade-size/`
**Prerequisites**: [plan.md](plan.md) ✅ | [spec.md](spec.md) ✅ | [research.md](research.md) ✅ | [data-model.md](data-model.md) ✅ | [contracts/](contracts/) ✅

**Scope**: 3 files modified — all in `core-engine/`. No TypeScript, API, or UI changes.

**Green Light Protocol**: All existing `go test ./...` must be green before implementation begins. The signature change in Phase 2 will break compilation until Phase 3 (call site updates) is applied in the same commit. Phases 2–3 are applied atomically to keep the repo green at all times.

---

## Phase 1: Setup

**Purpose**: Confirm baseline Green Light before any changes are made.

- [X] T001 Verify all existing tests pass

---

## Phase 2: Foundational — Signature Refactor (Blocks All User Stories)

**Purpose**: Update `ComputeAmountSequence` and `ComputeBaseQuantities` signatures in `core-engine/domain/config/sequences.go`, and update every call site atomically so the repo never has a broken build. These two tasks MUST land in the same commit.

**⚠️ CRITICAL**: T002 + T003 + T004 must be committed together. T002 changes the signature; T003 and T004 restore compilation. A partial commit with only T002 applied will fail `go build`.

- [X] T002 [core-engine] Refactor `ComputeAmountSequence`
- [X] T003 [P] [core-engine] Update `ComputeBaseQuantities` signature
- [X] T004 [P] [core-engine] Update orchestrator.go call site to pass `orch.runningBalance`

**Checkpoint**: `go build ./...` passes. All existing tests compile and pass (they have not yet been updated in `sequences_test.go`, which will fail to compile — apply T005 in the same commit).

---

## Phase 3: User Story 1 — Compounding Percentage Scales With Growing Equity (Priority: P1) 🎯 MVP

**Goal**: Prove that `V = dynamicBalance × apt × multiplier` when `apt ≤ 1.0`, using the live Orchestrator balance rather than the static config balance.

**Independent Test**: `go test ./domain/config/... -run "TestUS3|TestTS013_US1"` passes with V=5000 for balance=5000, apt=1.0.

### Tests for User Story 1

> **Write these FIRST — they must FAIL before T002 is applied (TDD Red state)**

- [X] T005 [P] [core-engine] [US1] Add `TestTS013_US1_PercentageUsesDynamicBalance`
- [X] T006 [P] [core-engine] [US1] Add `TestTS013_US1_HalfPercentageOfGrownBalance`
- [X] T007 [P] [core-engine] [US1] Add `TestTS013_US1_PercentageWithMultiplier`

### Call Site Migration for User Story 1

> **Update existing test call sites to restore compilation after T002**

- [X] T008 [core-engine] [US1] Update all 10 existing `ComputeAmountSequence()` calls in sequences_test.go
  - T052 `TestUS3_CanonicalAmountSequence` → `cfg.ComputeAmountSequence(decimal.Zero)` (apt=1000, absolute)
  - T053 `TestUS3_SumInvariant` (all cases) → `cfg.ComputeAmountSequence(decimal.Zero)` (all apt > 1.0)
  - T054 `TestUS3_NormalizationFactorR` → `cfg.ComputeAmountSequence(decimal.Zero)` (apt=7, absolute)
  - T055 `TestUS3_MultiplierScalesAmounts` (both cfgM1 and cfgM2) → `(decimal.Zero)` each (apt=1000)
  - T056 `TestUS3_AmountsGeometricOrdering` → `cfg.ComputeAmountSequence(decimal.Zero)` (apt=1000)
  - T057 `TestUS3_UniformDistribution_ScaleOne` → `cfg.ComputeAmountSequence(decimal.Zero)` (apt=300)
  - T058 `TestUS3_FractionalAmountPerTradeScaledByBalance` → `cfg.ComputeAmountSequence(mustDecimal("1000"))` (apt=0.5, percentage — must pass explicit balance to replicate previous implicit DefaultAccountBalance=1000)
  - T059 `TestUS3_SingleOrderReturnsTotal` → `cfg.ComputeAmountSequence(decimal.Zero)` (apt=1000)
  - T060 `TestUS3_AcceptanceScenario1_ExactAmounts` → `cfg.ComputeAmountSequence(decimal.Zero)` (apt=1000)
  - T061 `TestUS3_AcceptanceScenario2_SumPreservation` (all cases) → `cfg.ComputeAmountSequence(decimal.Zero)` (all apt > 1.0)

**Checkpoint**: `go test ./domain/config/... -run "TestUS3|TestTS013_US1"` — all existing T052–T061 pass; T005–T007 now pass (GREEN).

---

## Phase 4: User Story 2 — Absolute Amount Is Immune to Balance Growth (Priority: P2)

**Goal**: Prove that when `apt > 1.0`, `V = apt × multiplier` regardless of what `dynamicBalance` is passed.

**Independent Test**: `go test ./domain/config/... -run "TestTS013_US2"` passes with V=500 for apt=500, any balance.

### Tests for User Story 2

- [ ] T009 [P] [core-engine] [US2] Add `TestTS013_US2_AbsoluteIgnoresBalance` in `core-engine/domain/config/sequences_test.go`: `apt=500, sa=1.0, m=1, N=1`, call `cfg.ComputeAmountSequence(mustDecimal("50000"))`, assert `sum == "500.00000000"`
- [ ] T010 [P] [core-engine] [US2] Add `TestTS013_US2_AbsoluteWithMultiplier` in `core-engine/domain/config/sequences_test.go`: `apt=500, sa=1.0, m=2, N=1`, call `cfg.ComputeAmountSequence(mustDecimal("50000"))`, assert `sum == "1000.00000000"`
- [ ] T011 [P] [core-engine] [US2] Add `TestTS013_US2_AbsoluteWhenBalanceBelowFloor` in `core-engine/domain/config/sequences_test.go`: `apt=500, sa=1.0, m=1, N=1`, call `cfg.ComputeAmountSequence(mustDecimal("400"))` (balance below floor), assert `sum == "500.00000000"` (no clamping)

**Checkpoint**: `go test ./domain/config/... -run "TestTS013_US2"` — all three new tests pass.

---

## Phase 5: User Story 3 — Boundary Condition apt = 1.0 (Priority: P3)

**Goal**: Prove the `≤ 1.0` boundary is correct: exactly `1.0` is percentage mode; `1.01` is absolute mode.

**Independent Test**: `go test ./domain/config/... -run "TestTS013_US3"` passes all three boundary assertions simultaneously.

### Tests for User Story 3

- [ ] T012 [P] [core-engine] [US3] Add `TestTS013_US3_BoundaryExactlyOneIsPercentage` in `core-engine/domain/config/sequences_test.go`: `apt=1.0, sa=1.0, m=1, N=1`, call `cfg.ComputeAmountSequence(mustDecimal("2000"))`, assert `sum == "2000.00000000"`
- [ ] T013 [P] [core-engine] [US3] Add `TestTS013_US3_BoundaryAboveOneIsAbsolute` in `core-engine/domain/config/sequences_test.go`: `apt=1.01, sa=1.0, m=1, N=1`, call `cfg.ComputeAmountSequence(mustDecimal("2000"))`, assert `sum == "1.01000000"` (absolute 1.01 USDT, balance ignored)
- [ ] T014 [P] [core-engine] [US3] Add `TestTS013_US3_BoundaryHalfPercentage` in `core-engine/domain/config/sequences_test.go`: `apt=0.5, sa=1.0, m=1, N=1`, call `cfg.ComputeAmountSequence(mustDecimal("2000"))`, assert `sum == "1000.00000000"` (50% of 2000)

**Checkpoint**: `go test ./domain/config/... -run "TestTS013_US3"` — all three boundary tests pass.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Guard condition, sum-invariant proof, and Orchestrator-level integration test.

- [ ] T015 [P] [core-engine] Add `TestTS013_FR005_ZeroBalanceReturnsError` in `core-engine/domain/config/sequences_test.go`: `apt=1.0`, call `cfg.ComputeAmountSequence(decimal.Zero)`, assert `err != nil` and `err` is `*SequenceComputationError`
- [ ] T016 [P] [core-engine] Add `TestTS013_FR005_NegativeBalanceReturnsError` in `core-engine/domain/config/sequences_test.go`: `apt=0.5`, call `cfg.ComputeAmountSequence(mustDecimal("-100"))`, assert `err != nil` and `err` is `*SequenceComputationError`
- [ ] T017 [P] [core-engine] Add `TestTS013_FR006_SumInvariantPreservedWithDynamicBalance` in `core-engine/domain/config/sequences_test.go`: `apt=1.0, sa=2.0, m=1, N=10`, call `cfg.ComputeAmountSequence(mustDecimal("5000"))`, assert `seq.Sum() == mustDecimal("5000.00000000")` (last-order adjustment fires correctly with dynamic V)
- [ ] T018 [core-engine] Add `TestTS013_OrchestratorCompoundingIntegration` in `core-engine/application/orchestrator/` (add to existing orchestrator integration test file or create `orchestrator_compounding_test.go`): set up a two-trade backtest with `initialBalance="1000"`, `amountPerTrade="1.0"`, `multiplier=1`; close trade 1 with profit `"4000"` (so `runningBalance` becomes `"5000"`); assert the amounts slice used for trade 1 sums to `"1000.00000000"` and the amounts slice used for trade 2 sums to `"5000.00000000"`
- [ ] T019 Run final validation: `go test ./...` from `core-engine/` with zero failures; confirm `go vet ./...` is clean; run the quickstart.md smoke-test commands

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup — Green Light baseline)
    │
    └── Phase 2 (Foundational — T002 + T003 + T004 atomic commit)
            │
            ├── Phase 3 (US1 — T005–T008)     ← MVP, independently testable
            │       │
            │       ├── Phase 4 (US2 — T009–T011)
            │       │
            │       └── Phase 5 (US3 — T012–T014)
            │               │
            │               └── Phase 6 (Polish — T015–T019)
```

### Parallel Opportunities (within phases)

**Phase 2**: T003 and T004 are `[P]` — they can be written simultaneously with T002 since they are in different files. All three land in one commit.

**Phase 3**: T005, T006, T007 are `[P]` — three independent test functions in the same file; can be written simultaneously. T008 (call site migration) must run before the tests compile, so T008 is a prerequisite for T005–T007 to compile, but the test bodies themselves can be authored in parallel.

**Phase 4**: T009, T010, T011 are all `[P]` — independent test functions.

**Phase 5**: T012, T013, T014 are all `[P]` — independent test functions.

**Phase 6**: T015, T016, T017 are `[P]` — independent test functions.

### User Story Independence

- **US1 (Phase 3)**: Fully testable after Phase 2. MVP — if only Phase 3 is implemented, `go test -run TestTS013_US1` already proves the core compounding behaviour.
- **US2 (Phase 4)**: Independent of US1 at the test level. Can be run in parallel with Phase 3.
- **US3 (Phase 5)**: Independent of US1 and US2 at the test level. Can be run in parallel with Phases 3 and 4.
- **Polish (Phase 6)**: Depends on all user stories being complete, but T015–T017 are independent of T018.

### Commit Strategy (Green Light Protocol)

**Commit 1** (atomic, keeps build green):
- T002 (`sequences.go` — new signature + logic)
- T003 (`sequences.go` — `ComputeBaseQuantities` signature)
- T004 (`orchestrator.go` — call site)
- T008 (`sequences_test.go` — existing call site migrations)
- T005, T006, T007 (`sequences_test.go` — US1 new tests, now GREEN because T002 is in same commit)

**Commit 2** (independent, all GREEN):
- T009, T010, T011 (US2 tests)
- T012, T013, T014 (US3 tests)
- T015, T016, T017 (FR-005, FR-006 tests)

**Commit 3**:
- T018 (orchestrator integration test)
- T019 (final validation)
