# Quickstart: Unified ROI Calculation

**Branch**: `021-roi-unification`

## Prerequisites

- Node.js and npm installed
- Frontend dependencies installed: `cd frontend && npm install`

---

## Verify the fix (manual)

### Step 1 — Run a single backtest with monthly additions

1. Start the app (`npm run dev` in both `orchestrator/api` and `frontend`)
2. Configure a backtest with:
   - Account balance: $1,000
   - Monthly addition: $100
   - Date range: at least 3 months
3. Run the backtest and open the full results dashboard
4. Note the **ROI %** displayed

### Step 2 — Confirm ROI matches the engine value

Open Browser DevTools → Network tab. Find the `/api/backtests/{id}` response.
Check `pnlSummary.roi`. It must equal the displayed ROI to within ±0.01%.

Before this fix: the displayed dashboard ROI was computed as `netProfit / accountBalance × 100`
(ignoring monthly additions), which overstates the return.

After this fix: displayed ROI = `pnlSummary.roi` from the engine, which uses the correct denominator.

### Step 3 — Confirm run list shows the same value

Navigate back to the run list. The run card for the completed run must show the same ROI as the
dashboard.

---

## Run the test suite

```bash
cd frontend
npm test
```

All tests must pass (Green Light Protocol). The relevant tests:

| File | What it proves |
|------|---------------|
| `src/__tests__/services/roiCalculator.test.ts` | Shared utility canonical cases including zero-denominator guard |
| `src/__tests__/hooks/useResultsMetrics.test.ts` | Dashboard hook now emits `pnlSummary.roi`, not a re-derived value |

---

## Regression check

After the fix, backtest runs **without** monthly additions (`monthly_addition = 0`) must show the
same ROI as before. Because `initialBalance + 0 = initialBalance`, the formula is equivalent to
the old one in the zero-addition case. The test suite covers this
(the existing `useResultsMetrics` tests use configs with no monthly addition).
