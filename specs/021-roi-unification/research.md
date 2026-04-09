# Research: Unified ROI Calculation

**Date**: 2026-04-07 | **Branch**: `021-roi-unification`
**Status**: Complete — all unknowns resolved via codebase analysis

---

## Finding 1 — Canonical ROI formula (authoritative source)

**Decision**: The Go engine is the canonical source. All frontend derivations must match or defer.

**Rationale**: The Go engine formula is defined in two places with identical logic:
- `core-engine/cmd/engine/aggregator.go` lines 137–141:
  ```
  ROI = (realizedPnl + unrealizedPnl) / (accountBalance + totalAdditions) × 100
  ```
- `core-engine/application/orchestrator/batch.go` lines 472–475 (batch/sweep path):
  ```
  roi = realizedPnl / (startBalance + totalAdditions) × 100
  ```
Both paths use `initialBalance + totalAdditions` as the denominator. The result is emitted as
`pnlSummary.roi` (float64 in Go → number in TS). This is the value that should be displayed
directly; no frontend re-derivation is needed.

**Alternatives considered**: Re-deriving on the frontend from trade events (current approach in
`useResultsMetrics`). Rejected because it requires summing DEPOSIT event balances and duplicates
engine logic; any divergence in DEPOSIT event availability causes silent discrepancies.

---

## Finding 2 — Existing ROI computation sites (all bugs confirmed)

Three frontend sites incorrectly divide by `accountBalance` only:

| File | Line | Bug pattern |
|------|------|-------------|
| `frontend/src/hooks/useResultsMetrics.ts` | 104 | `(netProfit / accountBalance) * 100` |
| `frontend/src/services/metricsCalculator.ts` | 46 | `(netProfit / accountBalance) * 100` |
| `frontend/src/components/RunCard.tsx` | 35 | `(np / balance) * 100` (when tradeEvents present) |

The `LeaderboardGrid` does **not** compute ROI — it renders `result.pnlSummary.roi` directly.
The orchestrator TS layer (`BackgroundWorker.ts`, `optimizer.routes.ts`) already uses the correct
denominator (`account_balance + totalDeposits`). Both are out of scope.

**Decision**: Fix all three frontend sites. Approach: consume `pnlSummary.roi` directly from the
engine in all rendering paths. The shared utility (`calculateRoi`) is kept as a well-tested fallback
for the rare case where `pnlSummary.roi` is absent.

---

## Finding 3 — Shared utility placement and interface

**Decision**: New file `frontend/src/services/roiCalculator.ts`. Pure function, no side effects.

**Rationale**: The `services/` directory already contains pure utilities (`formatters.ts`,
`metricsCalculator.ts`). Co-location there is consistent. The function signature:

```typescript
calculateRoi(netProfit: number, initialBalance: number, totalAdditions: number): number
```
Uses `Decimal.js` (already a direct dependency at `^10.6.0`) to avoid float division errors.
Returns `0` when `initialBalance + totalAdditions ≤ 0`.

**Alternatives considered**: Exporting from `metricsCalculator.ts` directly. Rejected because
`metricsCalculator.ts` also deals with trade event aggregation, mixing concerns. A dedicated
`roiCalculator.ts` is easier to test in isolation.

---

## Finding 4 — useResultsMetrics: what changes and what stays

**Decision**: Remove the local ROI derivation; consume `pnlSummary.roi`. Keep `totalAdditions`
extraction for `accountEquity` and `capitalUtilized` calculations.

**Rationale**:
- `accountEquity = (initialBalance + totalAdditions) + netProfit` — correct, keep as-is.
- `capitalUtilized` uses `trueCapitalAvailable = initialBalance + totalAdditions` — also correct, keep.
- The `roi` line today (`netProfit / accountBalance * 100`) is the sole fix target.
- Note: The existing comment at line 103 explicitly states "ROI is relative to initial account
  balance only" which is the wrong design decision. That comment is removed with the fix.

**Test impact**: `useResultsMetrics.test.ts` line 54 currently asserts roi ≈ 1.3 (derived from
`netProfit=15 / accountBalance=1000`). After the fix, the test must assert that roi equals
`pnlSummary.roi` from the mock data, which is `5.0`. The test scenario description needs updating.

---

## Finding 5 — RunCard & metricsCalculator: what changes

**Decision**: In `RunCard.tsx`, replace the inline re-derivation with `pnlSummary.roi` directly.
Remove `roi` from `metricsCalculator.ts` entirely (callers don't need it once RunCard uses the engine value).

**Rationale**: The `calculateNetMetrics` function in `metricsCalculator.ts` returns `{ netProfit, roi, closedTradesCount }`. `RunCard.tsx` uses `netProfit` for display but immediately overwrites the roi with its own inline re-derivation. After the fix:
- `metricsCalculator.ts` returns `{ netProfit, closedTradesCount }` — roi removed since no caller needs it.
- `RunCard.tsx` display logic becomes:
  ```
  displayNetRoi = completedResults.pnlSummary.roi
  displayNetProfit = (pnlSummary.roi / 100) * (initialBalance + totalAdditions)
  ```
  Where `totalAdditions` can be derived from DEPOSIT events if tradeEvents is non-empty, or estimated from `monthlyAddition * months` if tradeEvents is empty (but since we're consuming `pnlSummary.roi` directly for roi display, we only need this for the profit dollar figure).

  **Simplification**: For the net profit dollar display in RunCard, continue using `metrics.netProfit` (event-derived) when tradeEvents are available. When tradeEvents are empty, derive `netProfit = (pnlSummary.roi / 100) * initialBalance` as before (the existing fallback logic is acceptable for the dollar display; improving its precision is out of scope).

---

## Finding 6 — Annualized return: no code change needed

**Decision**: The `annualizedReturn` value is computed entirely in the orchestrator TS layer (already correct) and stored in `pnlSummary.annualizedReturn`. The frontend merely passes it through in `useResultsMetrics` at line 123. No change required.

**Rationale**: The annualized return discrepancy between single-run vs sweep arises from the deposit sourcing difference (actual DEPOSIT events vs synthesized monthly deposits). Both paths are correct; the ±0.1% tolerance from SC-003 is acceptable. No code change needed; promoting a sweep config to a detailed run will naturally produce the engine's own annualized return for that run.

---

## Summary of Changes (all frontend-only)

| File | Change Type | Reason |
|------|-------------|--------|
| `frontend/src/services/roiCalculator.ts` | **NEW** | Shared utility (Decimal.js) |
| `frontend/src/hooks/useResultsMetrics.ts` | **MODIFY** | Consume `pnlSummary.roi` directly |
| `frontend/src/services/metricsCalculator.ts` | **MODIFY** | Remove `roi` from return |
| `frontend/src/components/RunCard.tsx` | **MODIFY** | Use `pnlSummary.roi` for display |
| `frontend/src/__tests__/services/roiCalculator.test.ts` | **NEW** | Unit tests (5 canonical cases) |
| `frontend/src/__tests__/hooks/useResultsMetrics.test.ts` | **MODIFY** | Update roi assertion |

No orchestrator TS layer changes. No Go engine changes. No DB schema changes.
