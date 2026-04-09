---
description: "Task list for 021-roi-unification"
---

# Tasks: Unified ROI Calculation

**Input**: Design documents from `specs/021-roi-unification/`
**Branch**: `021-roi-unification`
**Path convention**: `orchestrator/ui/` = `frontend/` in this workspace — all task paths prefixed with `orchestrator/ui/src/` map to `frontend/src/` on disk.
**Total tasks**: 15
**Parallel opportunities**: T002 (Phase 1 — write tests before impl); T005 (US1 — update test concurrently with impl); T010, T012 (US3+US4 verification)

---

## Phase 1: Setup (Shared Utility Foundation)

**Purpose**: Create the single shared ROI utility and its tests. This is the only new file and is
**blocking** — both US1 and US2 depend on it being correct before any hook/component changes.

- [X] T001 [P] Create `orchestrator/ui/src/__tests__/services/roiCalculator.test.ts` — write 5 canonical test cases from spec (no-additions baseline, with-additions, 12-month additions, zero-denominator guard, additions-only); all tests must fail at this point (Red phase)
- [X] T002 Create `orchestrator/ui/src/services/roiCalculator.ts` — export `calculateRoi(netProfit, initialBalance, totalAdditions): number` using Decimal.js; return 0 when denominator ≤ 0; make all T001 tests pass (Green phase)
- [X] T003 Run `npm test -- --testPathPattern=roiCalculator` in `orchestrator/ui/` — all tests must pass (Green Light before any further changes)

**Checkpoint**: `calculateRoi` utility is fully tested and passing. US1 and US2 work can begin in parallel.

---

## Phase 2: Foundational (No additional prerequisites — utility from Phase 1 is sufficient)

*No separate foundational phase required. The shared utility from Phase 1 is the only prerequisite.*

---

## Phase 3: User Story 1 — Single Run Dashboard Shows Correct ROI (Priority: P1) 🎯 MVP

**Goal**: The full results dashboard consumes `pnlSummary.roi` directly from the engine instead of re-deriving ROI locally from `netProfit / accountBalance`.

**Independent Test**: After T005 and T006, run `npm test -- --testPathPattern=useResultsMetrics` — the roi assertion must expect `5.0` (the `pnlSummary.roi` mock value), not the re-derived `1.3`.

- [X] T004 [US1] In `orchestrator/ui/src/hooks/useResultsMetrics.ts` — remove `const roi = accountBalance > 0 ? (netProfit / accountBalance) * 100 : 0` and replace with `const roi = pnlSummary.roi` (engine value direct pass-through); remove the stale comment "ROI is relative to initial account balance only"
- [X] T005 [P] [US1] In `orchestrator/ui/src/__tests__/hooks/useResultsMetrics.test.ts` — update "computes roi based on accountBalance" test: change expected value from `1.3` to `5.0` (the `pnlSummary.roi` from the mock), and update the comment/description to reflect the new source
- [X] T006 [US1] Run `npm test -- --testPathPattern=useResultsMetrics` in `orchestrator/ui/` — all tests must pass

**Checkpoint**: Full dashboard ROI now equals `pnlSummary.roi`. US1 independently verifiable via test suite.

---

## Phase 4: User Story 2 — Run List Rows Show Correct ROI (Priority: P2)

**Goal**: RunCard in the run list always displays `pnlSummary.roi` directly; the inline `(np / balance) * 100` re-derivation is removed. `metricsCalculator.ts` no longer computes or returns `roi`.

**Independent Test**: After T009, run `npm test` — no test should reference `metrics.roi` or expect the old derived value in RunCard-related tests.

- [X] T007 [US2] In `orchestrator/ui/src/services/metricsCalculator.ts` — remove `roi` field from `NetMetrics` interface and remove the `const roi = accountBalance > 0 ? (netProfit / accountBalance) * 100 : 0` computation and its return; update the return statement to `{ netProfit, closedTradesCount }`
- [X] T008 [US2] In `orchestrator/ui/src/components/RunCard.tsx` — replace the `displayNetRoi` derivation block: remove `(np / balance) * 100` branch; set `displayNetRoi = completedResults.pnlSummary.roi` for both the tradeEvents-present and tradeEvents-empty paths. Keep `displayNetProfit = metrics?.netProfit` when tradeEvents are available; keep the existing `(pnlSummary.roi / 100) * balance` fallback for the dollar amount when tradeEvents are empty
- [X] T009 [US2] Run `npm test` in `orchestrator/ui/` — full suite must pass (Green Light)

**Checkpoint**: Run list ROI equals engine value for all run cards. US2 independently verifiable.

---

## Phase 5: User Story 3 — Sweep Leaderboard ROI Matches Single-Run ROI (Priority: P2)

**Goal**: Verify that the sweep leaderboard continues to display `pnlSummary.roi` directly (no change required in leaderboard code) and that the annualized return is consistent. Confirm no regression.

**Independent Test**: Run `npm test -- --testPathPattern=LeaderboardGrid|QuantMatrix` — both must pass with no changes.

- [X] T010 [P] [US3] Verify SC-004: run `grep -rn "netProfit / " frontend/src/components/optimizer/ --include="*.ts" --include="*.tsx"` — confirm zero matches exist; report findings
- [X] T011 [US3] Run `npm test -- --testPathPattern=LeaderboardGrid|QuantMatrix` — all existing tests must pass without modification (regression proof)

**Checkpoint**: Leaderboard confirmed to use engine-sourced ROI only. No code changes needed for US3.

---

## Phase 6: User Story 4 — Annualized Return Consistent Across All Surfaces (Priority: P3)

**Goal**: Confirm that `annualizedReturn` pass-through in `useResultsMetrics.ts` is unchanged and that no frontend site re-derives it. Verify via existing tests only.

**Independent Test**: Run `npm test -- --testPathPattern=useResultsMetrics` — the `annualizedReturn` pass-through test (`passes through annualizedReturn from pnlSummary`) must still pass after US1 changes.

- [X] T012 [P] [US4] Verify no local annualizedReturn re-derivation: run `grep -rn "annualizedReturn" frontend/src --include="*.ts" --include="*.tsx"` — confirm every hit is a pass-through (`pnlSummary.annualizedReturn`) not a computation; report findings
- [X] T013 [P] [US4] In `orchestrator/ui/src/__tests__/hooks/useResultsMetrics.test.ts` — add a test: "passes through annualizedReturn from pnlSummary": mock `pnlSummary.annualizedReturn = 8.5`, assert `result.current.annualizedReturn === 8.5` (covers SC-003/US4-AC1)
- [X] T014 [US4] Run `npm test -- --testPathPattern=useResultsMetrics` in `orchestrator/ui/` — all tests including the new T013 pass

**Checkpoint**: Annualized return confirmed consistent. All tests green.

---

## Final Phase: Polish & Cross-Cutting

- [X] T015 Run `npm test` one final time in `orchestrator/ui/` and verify 0 failing tests, 0 failing assertions related to roi or annualizedReturn; confirm SC-004 (zero ROI re-derivation sites outside `roiCalculator.ts`) by running: `grep -rn "netProfit / " frontend/src --include="*.ts" --include="*.tsx"`

---

## Dependencies (story completion order)

```
Phase 1 (T001–T003) ──► US1 (T004–T006) ──► US2 (T007–T009) ──► Final (T015)
                    ├──► US3 (T010–T011) ──► Final (T015)
                    └──► US4 (T012–T014) ──► Final (T015)
```

US3 and US4 depend only on Phase 1 and can run in parallel with US1/US2.

## Parallel Execution Examples

**After Phase 1 is complete (T001–T003), develop in parallel:**

- Workstream A: `T004` → `T005` → `T006` (US1 — dashboard hook)
- Workstream B: `T010`, `T011`, `T012` (US3 + US4 — verification tasks, read-only)

**After US1 (T004–T006) is complete:**
- `T007` → `T008` → `T009` (US2 — metricsCalculator + RunCard)

## Implementation Strategy

**MVP** = Phase 1 + US1 (T001–T006): The shared utility is created and the full dashboard shows correct ROI. This alone fixes the most visible user-facing bug and is independently deliverable.

**Full delivery** = add US2 (T007–T009): Run list cards also show correct ROI. Eliminates all duplicate derivation sites.

US3 consists of verification tasks only (T010–T011). US4 adds one new test (T013) plus verification (T012, T014). Both run alongside US1/US2 after Phase 1 completes.
