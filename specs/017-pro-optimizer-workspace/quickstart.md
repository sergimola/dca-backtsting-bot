# Quickstart: Pro Optimizer Workspace (017)

**Feature Branch**: `017-pro-optimizer-workspace`

---

## Prerequisites

All items from spec 016 (Optimizer Workspace baseline) must be in place:
- Go engine binary at `core-engine/bin/engine` (or `core-engine/bin/engine.exe` on Windows)
- Node.js API running at `http://localhost:4000`
- PostgreSQL running with existing `backtests` table migrated
- ClickHouse running with market data for test pairs (e.g., `BTC/USDC 2025-01`)
- Frontend dev server at `http://localhost:5173`

---

## 1. Apply Database Migrations

```bash
cd orchestrator/api
npx drizzle-kit generate  # generates migration 0003_optimizer_sessions.sql
npx drizzle-kit migrate   # applies to PostgreSQL
```

Verify tables exist:
```sql
\dt sweep_sessions
\dt sweep_run_summaries
```

---

## 2. Rebuild Go Engine

The engine binary must include the `enable_wide_events` field and win rate tracking:

```bash
cd core-engine
go build -o bin/engine ./cmd/engine
# Windows:
go build -o bin/engine.exe ./cmd/engine
```

Run engine tests to verify no regressions:
```bash
go test ./...
```

---

## 3. Run API Tests

```bash
cd orchestrator/api
npx jest
```

New tests to verify:
- `SweepService.pruneConfigs` returns `pruneReasons` with all 5 keys
- `GET /optimizer/sessions` returns empty array when no sessions
- `DELETE /optimizer/session/:id` cascades to `sweep_run_summaries`

---

## 4. Test Global Sidebar Collapse

```bash
cd frontend
npm run dev
```

1. Open `http://localhost:5173`
2. Verify sidebar is expanded by default showing "Backtests" and "Optimizer" tabs
3. Click the collapse toggle → sidebar shrinks to icon-only (`w-14`)
4. Click expand → sidebar returns to full width with labels
5. Click "Optimizer" → navigates to `/optimizer`; sidebar shows sweep history section (empty state: "No sweeps yet")

---

## 5. Test Sweep Execution with Persistence

1. Navigate to `/optimizer`
2. Configure a small sweep (e.g., price_scale: 1.1,1.2,1.3 — 3 run sweep)
3. Click "Launch Sweep"
4. Verify SSE stream shows 3 results in Leaderboard
5. After completion, verify in PostgreSQL:
   ```sql
   SELECT id, trading_pair, total_runs, status FROM sweep_sessions ORDER BY created_at DESC LIMIT 1;
   SELECT run_id, roi, win_rate, capital_efficiency FROM sweep_run_summaries 
     WHERE session_id = '<session_id_from_above>' ORDER BY roi DESC;
   ```
6. Refresh the page → sweep history list should show the completed sweep with correct KPIs

---

## 6. Test Pruning Transparency

1. Configure a sweep with `take_profit_distance_percent` including a value ≤ 0.2
2. Click "Launch Sweep" (or just wait for count debounce)
3. Verify footer shows: `Generated: X | Pruned: Y | Valid: Z`
4. Hover over "Pruned: Y" → tooltip shows breakdown including `guaranteed_fee_loss` count

---

## 7. Test Year-Based Quick Dates

1. Navigate to `/optimizer`
2. In the Configurator, verify buttons: "YTD", "Last 6M", "Last 30D" + "Since 2020" through "Since 2025" + "2020 Only" through "2025 Only"
3. Click "Since 2024" → verify `startDate` field = `2024-01-01T00:00:00Z`, `endDate` = today
4. Click "2023 Only" → verify `startDate` = `2023-01-01T00:00:00Z`, `endDate` = `2023-12-31T23:59:59Z`

---

## 8. Test Sweep Cancellation

1. Launch a sweep with ≥ 20 configurations
2. While running, click "Cancel Sweep"
3. Verify: UI transitions to Quant Matrix with partial results + "Cancelled (N/Total)" indicator
4. Verify in PostgreSQL:
   ```sql
   SELECT status, total_runs FROM sweep_sessions ORDER BY created_at DESC LIMIT 1;
   -- expects: status='cancelled', total_runs = number of rows in sweep_run_summaries
   ```
5. Verify cancelled sweep appears in history list with `(cancelled)` badge

---

## 9. Test Re-run with Details (Promotion)

1. Complete a sweep and view the Leaderboard
2. Click "Re-run with Details" on the top row
3. Verify: new tab opens at `/` with all parameters pre-filled (matching the row's config)
4. Submit the single run
5. Verify: run completes and `backtests` table contains full `trades` JSONB data (wide events persisted)

---

## 10. Test Import/Export in Single Run View

1. Navigate to `/` (Single Run)
2. Click "Export Config" → JSON is copied to clipboard (or shown in modal)
3. Navigate to `/optimizer`, click "Import Config", paste the JSON → configurator fields populate
4. Navigate back to `/`, click "Import Config", paste an optimizer config JSON → single-run fields populate with fixed values

---

## 11. Test Throttled Rendering

Run Jest frontend tests:
```bash
cd frontend
npm run test -- --testPathPattern=useOptimizer
```

The throttle test simulates 200 result events in 1 second and asserts React re-renders ≤ 8 (one per 250ms interval).

---

## 12. Environment Variables

No new environment variables are required. The feature uses:
- `ENABLE_WIDE_EVENTS` (existing, optional) — server-side wide events default
- All existing `CLICKHOUSE_*` and `DATABASE_URL` variables

---

## Troubleshooting

### Sweep history empty after completion
- Check API logs for "failed to persist session" errors
- Verify `DATABASE_URL` is set and PostgreSQL is reachable
- If `persistence_error` SSE event fires: check the warning banner in the UI

### Win rate shows null unexpectedly
- This is correct when no positions closed during the backtest (severe drawdown config)
- Check `total_runs` in the Go batch result for `totalPositionsClosed: 0`

### `capital_efficiency` is null
- This occurs when the Pre-Flight map is unavailable for the run's `run_id`
- Check that `session.preFlightMap` is populated in `OptimizerSessionStore` before execution
