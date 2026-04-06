# Tasks: Annualized Return (IRR / Money-Weighted Return)

**Input**: Design documents from `specs/020-annualized-return/`  
**Branch**: `020-annualized-return`  
**Total tasks**: 24  
**Phases**: Setup (1) → Foundation (2) → US1 (7) → US2 (9) → US3 (2) → Polish (3)

---

## Phase 1: Setup

**Purpose**: Verify Green Light Protocol — all existing tests must be green before any changes land.

- [X] T001 Run `npm test` in `orchestrator/api/` and `npm test -- --watchAll=false` in `frontend/` and confirm all existing tests pass (Green Light Protocol gate — MUST be green before writing any code)

**Checkpoint**: Zero test failures in both test suites.

---

## Phase 2: Foundation (Blocking Prerequisites)

**Purpose**: Type interface changes that every user story depends on. Must be complete before any US work runs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Add `annualizedReturn?: number | null` to `StoredPnlSummary` in `orchestrator/api/src/types/index.ts` (insert after `winRate?: number` — preserves backward compatibility for all existing callers)
- [X] T003 [P] Add `annualizedReturn?: number | null` to the inline `pnlSummary` shape of `BatchRunResult` in `orchestrator/api/src/types/optimizer.ts` (line ~183 — `pnlSummary?: { roi: number; maxDrawdown: number; totalFees: number; }` gains the new optional field)

**Checkpoint**: `tsc --noEmit` in `orchestrator/api/` exits 0. All existing callers of `StoredPnlSummary` and `BatchRunResult` compile without change (field is optional).

---

## Phase 3: User Story 1 — Annualized Return on Single Run Results (Priority: P1) 🎯 MVP

**Goal**: Every completed single-run backtest result includes `pnlSummary.annualizedReturn` in its payload. The UI displays it alongside ROI/MaxDrawdown. No database or sweep changes required.

**Independent Test**: Run a backtest with known deposit timestamps and final balance. Assert that `pnlSummary.annualizedReturn` in the result payload matches the IRR computed from those cash flows (verified by `IrrCalculator.test.ts` canonical cases + `BackgroundWorker` integration).

### Tests for User Story 1 (TDD — write first, ensure FAIL before T005)

- [X] T004 [P] [US1] Create `orchestrator/api/src/services/IrrCalculator.test.ts` with the 10 binding test cases from `data-model.md`: 5 canonical (TC-1 through TC-5) and 5 edge cases (EC-1 through EC-5) — all MUST FAIL red before T005 is written:
  - `TC1_SimpleOneYear`: cashFlows `[-1000, +1100]` at `[0.0, 1.0]` → `10.0000`
  - `TC2_SixMonth`: cashFlows `[-1000, +1050]` at `[0.0, 0.5]` → `10.2500`
  - `TC3_MidYearDeposit`: cashFlows `[-1000, -500, +1650]` at `[0.0, 0.5, 1.0]` → `10.0000`
  - `TC4_FullLoss`: cashFlows `[-1000, +0]` at `[0.0, 1.0]` → `-100.0000`
  - `TC5_BreakEven`: cashFlows `[-1000, +1000]` at `[0.0, 1.0]` → `0.0000`
  - `EC1_NoCapital`: `accountBalance = "0"`, no deposits → `null`
  - `EC2_AllPositive`: no outflows → `null`
  - `EC3_SubThirtyDays`: 15-day backtest with profitable return → non-null large positive
  - `EC4_ZeroFinalBalance`: terminal balance = 0 → `-100`
  - `EC5_BreakEvenExact`: identical invested and terminal → `0.0000`
  - `TC6_TwoDeposits`: cashFlows `[-1000, -500, -500, +2400]` at `[0.0, 0.5, 1.0, 1.5]` → exact IRR within ±0.0001 (covers US1 Acceptance Scenario 1 BDD case — 2 periodic deposits)

### Implementation for User Story 1

- [X] T005 [US1] Create `orchestrator/api/src/services/IrrCalculator.ts` — export `computeAnnualizedReturn(tradeEvents: StoredTradeEvent[], startDate: string, accountBalance: string): number | null`:
  - Set `Decimal.set({ precision: 20 })` at module scope
  - Build cash flows: initial balance as outflow at `t = 0`; each `DEPOSIT` event as outflow at its `rawTimestamp`; last event's `balance` as terminal inflow
  - Edge guards: zero initial + no deposits → `null`; all flows non-negative → `null`; terminal balance = 0 → `-100`
  - Newton-Raphson: initial guess `r = 0.1`, 100 iterations, convergence `|NPV| < 1e-10` or `|Δr| < 1e-12`, divergence when `(1 + r) ≤ 0`; all intermediate math via Decimal.js (no `Math.pow`)
  - Bisection fallback `[-0.9999, 100.0]`, 100 iterations, convergence `|rHi - rLo| < 1e-12`
  - Return `r.times(new Decimal(100)).toDecimalPlaces(4).toNumber()` on success; `null` if both solvers fail (constitution fix: pure Decimal chain, no native JS `*` operator on Decimal values)
- [X] T006 [US1] Run `npm test -- --testPathPattern=IrrCalculator` in `orchestrator/api/` and confirm all 10 tests pass (SC-001, SC-002 gates)
- [X] T007 [US1] In `orchestrator/api/src/services/BackgroundWorker.ts` — import `{ computeAnnualizedReturn }` from `./IrrCalculator.js`; after the engine result is received and `pnlSummary` is constructed, call `computeAnnualizedReturn(execResult.tradeEvents, config.start_date, String(config.account_balance))` and assign to `execResult.pnlSummary.annualizedReturn`
- [X] T008 [P] [US1] Add `annualizedReturn?: number | null` to `PnlSummary` in `frontend/src/services/types.ts` (insert after `winRate?: number`)
- [X] T009 [P] [US1] In `frontend/src/components/PnlSummary.tsx` — add a MetricCard (or equivalent display primitive) labeled `"Annualized Return (IRR)"` positioned after the ROI/MaxDrawdown cards; render `annualizedReturn != null ? \`${annualizedReturn.toFixed(4)}%\` : "N/A"` (SC-007)
- [X] T010 [P] [US1] In `frontend/src/components/RunCard.tsx` — add an `annualizedReturn` detail row after the Max Drawdown line in the expanded card view; display `annualizedReturn != null ? \`${annualizedReturn.toFixed(4)}%\` : "N/A"` (SC-007)

**Checkpoint**: `IrrCalculator.test.ts` 10/10 green. Single-run backtest payload includes `annualizedReturn`. Frontend renders it with `"N/A"` fallback for null.

---

## Phase 4: User Story 2 — Annualized Return in Sweep Leaderboard (Priority: P2)

**Goal**: `annualized_return` stored in `sweep_run_summaries`, exposed via the session results API, and displayed in the Grafana leaderboard with dedicated stat panels.

**Independent Test**: Run a sweep with two configs over different date ranges. Verify each result record includes a numerically correct `annualizedReturn` in the SSE stream AND the `GET /session/:id/results` endpoint response. Verify `annualized_return` column is queryable in Postgres.

### Implementation for User Story 2

- [X] T011 [P] [US2] Create `orchestrator/api/drizzle/0006_020_annualized_return.sql`:
  ```sql
  -- Migration: 0006 — Add annualized_return to sweep_run_summaries
  -- Feature:   020-annualized-return
  -- Date:      2026-04-06
  ALTER TABLE sweep_run_summaries
    ADD COLUMN IF NOT EXISTS annualized_return numeric(10,4);
  ```
- [X] T012 [US2] Update `orchestrator/api/drizzle/meta/_journal.json` — append two entries to the `entries` array: `{ "idx": 5, "version": "7", "when": 1775200000000, "tag": "0005_019_stop_loss_kpis", "breakpoints": true }` and `{ "idx": 6, "version": "7", "when": 1775290000000, "tag": "0006_020_annualized_return", "breakpoints": true }` (idx 5 backfills the missing stop_loss_kpis entry; idx 6 registers the new migration)
- [X] T013 [P] [US2] In `orchestrator/api/src/db/schema.ts` — add `annualizedReturn: numeric('annualized_return', { precision: 10, scale: 4 })` to the `sweepRunSummaries` pgTable definition, inserted between `totalStopsTriggered` and `promotedAt`
- [X] T014 [US2] Run `npm run db:migrate` in `orchestrator/api/` and verify with `psql $DATABASE_URL -c "\d sweep_run_summaries" | grep annualized` that column exists (depends on T011, T012, T013)
- [X] T015 [P] [US2] In `orchestrator/api/src/services/SweepPersistenceService.ts` — in `persistRunSummary()` values object, add: `annualizedReturn: runResult.pnlSummary?.annualizedReturn != null ? new Decimal(runResult.pnlSummary.annualizedReturn).toDecimalPlaces(4).toString() : null` (wraps the stored `number` back through Decimal before stringifying — avoids JS-native `.toFixed()` at the serialization boundary; produces `"10.0000"` or `null` per FR-008)
- [X] T016 [P] [US2] In `orchestrator/api/src/routes/optimizer.routes.ts` — import `{ computeAnnualizedReturn }` from `../services/IrrCalculator.js`; in the `result` event handler, after extracting `pnlSummary`, look up the run config via `runConfigMap.get(event.run_id)` and call `computeAnnualizedReturn(event.tradeEvents, config.start_date, String(config.account_balance))`; assign result to `pnlSummary.annualizedReturn`
- [X] T017 [P] [US2] In `frontend/src/hooks/useOptimizer.ts` — in both the SSE stream parser's map and the `selectHistorySweep` fetch map, parse `annualizedReturn` using `r.annualizedReturn ?? (r as any).annualized_return ?? null` and assign to `pnlSummary.annualizedReturn` (handles camelCase from live stream and snake_case from Postgres DB query)
- [X] T024 [P] [US2] In `frontend/src/components/optimizer/LeaderboardGrid.tsx` — (a) add `'annualizedReturn'` to the `SortKey` union type; (b) add a sort case in the `useMemo` sort: `case 'annualizedReturn': av = a.pnlSummary?.annualizedReturn ?? 0; bv = b.pnlSummary?.annualizedReturn ?? 0; break`; (c) add `<th>` header cell `"Ann. Return %"` with `onClick={() => toggleSort('annualizedReturn')}`; (d) add data cell after the ROI `<td>`: render `r.pnlSummary?.annualizedReturn != null ? \`${r.pnlSummary.annualizedReturn.toFixed(4)}%\` : "N/A"` with same color class as ROI; (e) add `'annualizedReturn'` field to the `exportCSV` headers/rows. This covers both FR-012 (leaderboard UI) and the optimizer quant matrix (QuantMatrix.tsx renders LeaderboardGrid — the fix is inherited, no separate change to QuantMatrix required). SC-004 and SC-007 gates satisfied.
- [X] T018 [P] [US2] In `grafana/dashboards/04-sweep-leaderboard.json`:
  - Add `ROUND(annualized_return::numeric, 4) AS "Annualized Return %"` to the Run Leaderboard rawSql SELECT
  - Add "Best Annualized Return" stat panel: `SELECT MAX(annualized_return) FROM sweep_run_summaries WHERE session_id = '$session_id'` (mirror panel ID pattern of existing "Best ROI" stat at id:3)
  - Add "Avg Annualized Return" stat panel: `SELECT AVG(annualized_return) FROM sweep_run_summaries WHERE session_id = '$session_id'` (mirror "Avg ROI" stat at id:4)
  - Add `fieldConfig` override for `"Annualized Return %"`: unit `"percent"`, color thresholds matching ROI % (green > 0, red < 0)

**Checkpoint**: `annualized_return` column present in Postgres. Session results endpoint includes field. Grafana leaderboard shows two new stat panels and table column.

---

## Phase 5: User Story 3 — Promoted Runs Carry Annualized Return in Analytics (Priority: P3)

**Goal**: Promoted run analytics dashboards surface `annualized_return` for JOIN queries and side-by-side comparison with ROI.

**Independent Test**: Promote a run. Query `sweep_run_summaries` and verify `annualized_return` is set. Open Grafana run-overview and promoted-comparison dashboards; verify `annualized_return` panel appears alongside ROI.

### Implementation for User Story 3

- [X] T019 [P] [US3] In `grafana/dashboards/01-run-overview.json` — add an `annualized_return` stat panel alongside the existing ROI panel: query `SELECT annualized_return FROM sweep_run_summaries WHERE run_id = '$run_id'`, title `"Annualized Return (IRR)"`, unit `"percent"`, same grid position pattern as ROI
- [X] T020 [P] [US3] In `grafana/dashboards/04-sweep-promoted-comparison.json` — add an `annualized_return` stat/table column alongside the existing ROI column: query via JOIN to `sweep_run_summaries.annualized_return`, title `"Annualized Return %"`, unit `"percent"`

**Checkpoint**: All three user stories independently functional. Promoted-run dashboards show annualized return beside ROI.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final regression verification and TypeScript type safety confirmation.

- [X] T021 [P] Run `npm test` in `orchestrator/api/` and confirm zero regressions across the full test suite (SC-003 — Green Light Protocol gate)
- [X] T022 [P] Run `npm test -- --watchAll=false` in `frontend/` and confirm zero regressions (SC-003)
- [X] T023 Run `npx tsc --noEmit` in both `orchestrator/api/` and `frontend/` and confirm no TypeScript compile errors (validates additive-only changes did not break existing types)

**Checkpoint**: All tests green. Zero TypeScript errors. Feature complete per SC-001–SC-008.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundation (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — T004 [P] can start immediately after Phase 2; T009/T010 depend on T008
- **US2 (Phase 4)**: Depends on Phase 2 + T005 (for `computeAnnualizedReturn`); T011/T013 [P] can run as soon as Phase 2 is done
- **US3 (Phase 5)**: Depends on Phase 4 (database column must exist for Grafana queries)
- **Polish (Phase 6)**: Depends on all user stories complete

### User Story Dependencies

```
T001 (setup)
  └─ T002 + T003 [P] (types)
       ├─ T004 [P] (tests, write-first) ──→ T005 (implementation) ──→ T006 (confirm green)
       │                                        └─ T007 (BackgroundWorker)
       ├─ T008 [P] (frontend types) ──→ T009 [P] + T010 [P] (UI components)
       │
       ├─ T011 [P] (SQL migration) ──→ T012 (journal) ──→ T014 (run migration)
       ├─ T013 [P] (Drizzle schema) ──→ T014
       │
       ├─ T015 [P] (SweepPersistenceService) — depends on T013 + T014
       ├─ T016 [P] (optimizer.routes) — depends on T005 + T002
       ├─ T017 [P] (useOptimizer.ts) — depends on T008
       └─ T018 [P] (Grafana leaderboard) — independent
       └─ T024 [P] (LeaderboardGrid component) — independent
           └─ T019 [P] + T020 [P] (Grafana run-overview + promoted) — depend on T014 (column must exist in DB)
                └─ T021 [P] + T022 [P] + T023 (Polish)
```

### Parallel Opportunities Per Phase

| Phase | Parallel group |
|-------|---------------|
| Phase 2 | T002 + T003 simultaneously |
| Phase 3 | T004 can start with T002/T003; T008 + T009 + T010 can overlap (different files) |
| Phase 4 | T011 + T013 simultaneously; T015 + T016 + T017 + T018 + T024 simultaneously (after T014) |
| Phase 5 | T019 + T020 simultaneously |
| Phase 6 | T021 + T022 simultaneously |

### Implementation Strategy

**MVP (Phase 3 only)**: Implement T001–T010. Single-run results will include `annualizedReturn` in the payload and the frontend will display it. No database changes required. This is independently shippable.

**Full feature (all phases)**: Add Phases 4–6 to persist to Postgres and surface in Grafana leaderboard and analytics dashboards.
