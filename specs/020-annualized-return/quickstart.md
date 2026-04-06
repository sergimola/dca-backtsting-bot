# Quickstart: Annualized Return (IRR) — Development Guide

**Feature**: 020-annualized-return  
**Branch**: `020-annualized-return`

---

## Prerequisites

- Node.js v20+ (project uses v24.11.0)
- `cd orchestrator/api && npm install` (already done if you have the repo checked out)

---

## 1. Run the IRR Calculator Unit Tests

The primary TDD entrypoint for this feature. Tests live at `orchestrator/api/src/services/IrrCalculator.test.ts`.

```bash
cd orchestrator/api
node --experimental-vm-modules node_modules/.bin/jest src/services/IrrCalculator.test.ts --no-coverage
```

Or using the `npm test` script with a filter:

```bash
cd orchestrator/api
npm test -- --testPathPattern=IrrCalculator
```

**Expected output**: All 5 canonical test cases + 5 edge cases pass. Solver output within ±0.0001 of expected values.

---

## 2. Run the Full Test Suite (Green Light Check)

Before merging, the full suite must be green (SC-003):

```bash
cd orchestrator/api
npm test
```

```bash
cd frontend
npm test -- --watchAll=false
```

---

## 3. Apply the Database Migration

After the migration SQL file and journal entry are in place:

```bash
cd orchestrator/api
npm run db:migrate
```

Verify the column was added:

```bash
psql $DATABASE_URL -c "\d sweep_run_summaries" | grep annualized
```

Expected: `annualized_return  | numeric(10,4) | ...`

---

## 4. Verify End-to-End via API

Start the API server and run a test backtest. The result payload should include `annualizedReturn`:

```bash
# Start server
cd orchestrator/api
npm run dev

# Run a quick backtest (requires the Go engine binary)
curl -s -X POST http://localhost:3000/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "trading_pair": "BTCUSDC",
    "account_balance": "1000",
    "base_order": "100",
    "safety_orders": 3,
    "price_deviation": "1.5",
    "take_profit": "2.5",
    "start_date": "2024-01-01T00:00:00Z",
    "end_date": "2024-06-30T23:59:59Z",
    "timeframe": "1m"
  }' | jq '.pnlSummary.annualizedReturn'
```

Expected: a numeric value (e.g., `15.3421`) or `null` if no trades occurred.

---

## 5. Verify Sweep Session Persistence

After running a sweep session, the leaderboard results should include `annualized_return`:

```bash
curl -s http://localhost:3000/session/$SESSION_ID/results | jq '.[0].annualized_return'
```

Expected: `"15.3421"` (4dp numeric string) or `null`.

---

## 6. Check Grafana Leaderboard

Requires the full Docker Compose stack:

```bash
docker-compose up -d
```

Then open `http://localhost:3001/d/sweep-leaderboard` and verify:
- "Best Annualized Return" stat panel is visible
- "Avg Annualized Return" stat panel is visible  
- "Annualized Return %" appears as a column in the Run Leaderboard table

---

## Key Files for This Feature

| File | Purpose |
|------|---------|
| `orchestrator/api/src/services/IrrCalculator.ts` | Newton-Raphson + bisection solver |
| `orchestrator/api/src/services/IrrCalculator.test.ts` | 5 canonical + 5 edge case tests |
| `orchestrator/api/src/types/index.ts` | `StoredPnlSummary.annualizedReturn` field |
| `orchestrator/api/src/db/schema.ts` | Drizzle schema: `annualizedReturn` column |
| `orchestrator/api/drizzle/0006_020_annualized_return.sql` | SQL migration |
| `orchestrator/api/drizzle/meta/_journal.json` | Migration journal (idx 5 + idx 6) |
| `orchestrator/api/src/services/SweepPersistenceService.ts` | Persist `annualizedReturn` to DB |
| `orchestrator/api/src/services/BackgroundWorker.ts` | Compute IRR for single runs |
| `orchestrator/api/src/routes/optimizer.routes.ts` | Inject IRR into batch run stream |
| `frontend/src/services/types.ts` | Frontend `PnlSummary` type |
| `frontend/src/hooks/useOptimizer.ts` | Parse `annualizedReturn` from API |
| `frontend/src/components/PnlSummary.tsx` | Render "Annualized Return (IRR)" card |
| `frontend/src/components/RunCard.tsx` | Add annualizedReturn detail row |
| `grafana/dashboards/04-sweep-leaderboard.json` | 2 stat panels + table column |
| `grafana/dashboards/01-run-overview.json` | annualizedReturn panel |
| `grafana/dashboards/04-sweep-promoted-comparison.json` | annualizedReturn panel |

---

## IRR Math Reference

The IRR `r` satisfies:

$$\sum_{i} \frac{CF_i}{(1+r)^{t_i}} = 0$$

where `CF_i` is the cash flow at fractional year `t_i`. `annualizedReturn = r × 100`.

**Quick mental check**: For cash flows `[-1000, +1100]` at `[0, 1]`:
- NPV(0.1) = -1000 + 1100/1.1 = -1000 + 1000 = 0 ✓  
- → `annualizedReturn = 10.0000`
