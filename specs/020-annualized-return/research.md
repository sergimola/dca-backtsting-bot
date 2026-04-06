# Research: Annualized Return (IRR / Money-Weighted Return)

**Feature**: 020-annualized-return  
**Date**: 2026-04-06  
**Status**: Complete

---

## Q1: What numerical method is most appropriate for IRR on DCA cash-flow shapes?

**Finding**: DCA cash-flow series have a predictable shape: one large initial outflow at t=0, N smaller periodic outflows (DEPOSIT events), and one large terminal inflow at the end. This shape (all negatives before the one positive) has a unique IRR by Descartes' rule of signs. Newton-Raphson converges reliably in 5–20 iterations for typical DCA rates (-50% to +500% annualised). Divergence only occurs at extreme rates or degenerate inputs.

**Decision**: Newton-Raphson as primary solver (100 iterations, 1e-10 tolerance), with bisection over [-0.9999, 100.0] as fallback. Bisection is guaranteed to converge for the sign-changing interval implied by the DCA cash-flow shape (NPV at r=-0.9999 is positive; NPV at r=100 is deeply negative for any realistic terminal value). 100 iterations of bisection on [-0.9999, 100.0] gives precision of ~100/2^100 ≈ 7.9e-29, far exceeding the required 4 decimal-place output.

**Rationale**: The two-phase approach (NR + bisection fallback) is the industry standard for IRR in financial software (Excel, NumPy NPV). It is also recommended in all major numerical analysis textbooks for polynomial root-finding. A pure bisection approach would be adequate but is ~10× slower; a pure NR approach occasionally diverges for long backtests with very high return rates.

**Alternatives considered**:
- Pure bisection: Simpler but 3–5× more iterations needed; rejected for performance
- Brent's method: Optimal hybrid, but adds code complexity; overkill for < 5 ms budget
- MIRR (Modified IRR): Requires assumed reinvestment rate — introduces user-facing parameter; rejected per spec (no config change needed)

---

## Q2: How does Decimal.js handle the fractional exponents needed for IRR discount factors?

**Finding**: IRR requires computing `(1 + r)^t` where `t` is a fractional year (e.g., 0.5, 0.2493). Decimal.js v10.x provides `Decimal.pow(base, exp)` for arbitrary precision fractional exponents via its internal `ln`/`exp` implementation. This is exact to the configured precision (`Decimal.set({ precision: 20 })` is conservative). The call `new Decimal(1).plus(r).pow(t)` works correctly for both positive and negative `r` when `r > -1`.

**Decision**: Use `new Decimal(1).plus(r).pow(new Decimal(t))` for discount factors. Set `Decimal.precision = 20` at module load. Return final `annualizedReturn` rounded to 4 decimal places via `.toDecimalPlaces(4)`.

**Rationale**: `Decimal.pow` with exponent as a Decimal (not number) ensures no floating-point contamination. Setting precision to 20 is far above the required 4dp output, providing a safe margin for accumulated rounding in the NPV summation.

**Alternatives considered**:
- `Math.pow(1 + r_number, t)` — violates Fixed-Point Arithmetic constitution gate; rejected outright
- Logarithm identity `exp(t * ln(1+r))` with Decimal.ln + Decimal.exp — equivalent to what `Decimal.pow` does internally; no advantage to doing manually

---

## Q3: What is the `rawTimestamp` format on `StoredTradeEvent`, and is it reliable for IRR timing?

**Finding**: The Go engine emits `tradeEvents` as NDJSON. `rawTimestamp` is an ISO 8601 UTC string (e.g., `"2024-03-15T14:22:00Z"`). The TypeScript API wraps it as-is in `StoredTradeEvent.rawTimestamp: string`. JavaScript `Date.parse(rawTimestamp)` returns Unix milliseconds reliably for ISO 8601 UTC strings. Fractional years are computed as `(Date.parse(eventTimestamp) - Date.parse(startDate)) / (365.25 * 24 * 60 * 60 * 1000)`.

**Decision**: Use `Date.parse()` for timestamp arithmetic. Divide by `365.25 * 24 * 60 * 60 * 1000` (milliseconds per Gregorian year) to get fractional years. The `backtest start_date` is the anchor for `t = 0` (the initial balance outflow).

**Rationale**: ISO 8601 UTC parsing is the only timestamp format in the codebase. Using `365.25` (Julian year) is the standard for IRR computation and matches the spec requirement. Using `365` would over-state durations by 0.07% and could shift 4dp results slightly; `365.25` is correct.

**Alternatives considered**:
- `day-of-year / 365` — ignores leap years; max 0.07% error; acceptable but less rigorous
- `dayjs` or `date-fns` library — unnecessary; `Date.parse` covers all ISO 8601 UTC strings used in this codebase

---

## Q4: Does an `IrrCalculator` pattern already exist in the codebase?

**Finding**: No existing IRR or NPV computation exists anywhere in `orchestrator/api/src/`. The closest pattern is in `orchestrator/api/src/analysis/` — but no such directory exists either. The only financial computation is `roi = (finalBalance - totalInvested) / totalInvested * 100` done inline in `BacktestService.ts`. There is no shared math utility module.

**Decision**: Create `orchestrator/api/src/services/IrrCalculator.ts` as a standalone service module exporting a single function `computeAnnualizedReturn(tradeEvents, startDate, accountBalance)`. No additional abstraction layer (no interface, no class) — a plain exported function is sufficient.

**Rationale**: Keeping IRR in `services/` follows existing patterns (`SweepPersistenceService.ts`, `BackgroundWorker.ts` etc. all live there). A standalone function (not a class) is the simplest possible abstraction for a stateless computation.

**Alternatives considered**:
- Inline computation in `BackgroundWorker.ts` — rejected; IRR is non-trivial (Newton-Raphson + bisection) and needs independent unit testing
- Shared `mathUtils.ts` utility — rejected; no other math utils exist; creating one for a single function adds abstraction without value

---

## Q5: How does the Drizzle migration journal work and what index should the new migration use?

**Finding**: Drizzle migration files are hand-written SQL files in `orchestrator/api/drizzle/` named `000N_tag.sql`. The journal at `orchestrator/api/drizzle/meta/_journal.json` is also manually maintained. Current state:
- Journal has entries for idx 0–4 (last: `0004_018_time_in_market_kpis.sql`)
- `0005_019_stop_loss_kpis.sql` **exists on disk** but has **no journal entry** (gap at idx 5)
- The new annualized-return migration will be `0006_020_annualized_return.sql`

**Decision**: The task for the Drizzle migration must add **two** journal entries:
1. idx 5 → `0005_019_stop_loss_kpis` with `when: 1775200000000`
2. idx 6 → `0006_020_annualized_return` with `when: 1775290000000`

And create one new SQL file `0006_020_annualized_return.sql`:
```sql
ALTER TABLE sweep_run_summaries
  ADD COLUMN IF NOT EXISTS annualized_return numeric(10,4);
```

**Rationale**: `ADD COLUMN IF NOT EXISTS` is idempotent — safe for re-runs. The `IF NOT EXISTS` guard prevents errors on fresh DB installs. The journal indices must be sequential; idx 5 was skipped in a previous planning cycle and must be backfilled alongside idx 6.

**Alternatives considered**:
- Skip adding idx 5 now — rejected; running `db:migrate` with a gap causes a journal mismatch error at runtime
- Use Drizzle auto-generation (`drizzle-kit generate`) — this project uses hand-written migrations by convention (see `drizzle/` files vs `schema.ts` divergence); rejected to maintain consistency

---

## Q6: How does the optimizer batch result stream deliver pnlSummary, and where should IRR be injected?

**Finding**: `orchestrator/api/src/routes/optimizer.routes.ts` handles `POST /session/:id/execute`. It spawns the engine as a batch process and streams NDJSON lines. When `event.type === 'result'`, it extracts metrics including `pnlSummary` and streams them to the client as SSE events. The `run_id` in the result event maps back to the run config via a `runConfigMap` built from the sweep config before execution starts. That map has `start_date` and `account_balance` for each run.

**Decision**: After extracting `pnlSummary` from a `result` event, call `computeAnnualizedReturn(event.tradeEvents, config.start_date, String(config.account_balance))` and attach the result: `pnlSummary.annualizedReturn = irr`. The `runConfigMap` provides lookup by `run_id`.

**Rationale**: This is the earliest point in the data pipeline where both `tradeEvents` (from the result) and `start_date`/`account_balance` (from the config map) are co-located. Doing it here avoids an extra database round-trip.

**Alternatives considered**:
- Compute IRR inside the Go engine — rejected; spec requires orchestrator-layer computation; Go engine must remain free of analytics logic
- Compute IRR in `SweepPersistenceService` — rejected; by that point `tradeEvents` may not be available (persistence receives a summary object, not raw events)
- Compute IRR in `BackgroundWorker` for single runs — ACCEPTED; single-run path flows through `BackgroundWorker.ts`, so IRR is injected there (parallel to the optimizer path)

---

## Q7: How should `annualizedReturn` flow through the frontend data pipeline to the components?

**Finding**: The frontend receives run results via the `useOptimizer` hook which subscribes to the SSE stream from `POST /session/:id/execute`. Results accumulate in `sweepResults` state as `BatchRunResult[]`. Each `BatchRunResult.pnlSummary` is parsed from the API response. `PnlSummary.tsx` receives `pnlSummary` as a prop and renders MetricCards. `RunCard.tsx` also receives `pnlSummary`. For historical sweeps, `selectHistorySweep` in `useOptimizer.ts` fetches from `GET /session/:id/results` which returns DB-persisted summaries.

**Decision**:
1. `frontend/src/services/types.ts` → add `annualizedReturn?: number | null` to `PnlSummary`
2. `frontend/src/hooks/useOptimizer.ts` → in both the SSE parser and `selectHistorySweep` map, parse `r.annualizedReturn ?? r.annualized_return ?? null` (snake_case from DB, camelCase from live stream)
3. `PnlSummary.tsx` → add MetricCard with `"N/A"` guard
4. `RunCard.tsx` → add line item after Max Drawdown with `"N/A"` guard

**Rationale**: The dual-key parse (`annualizedReturn ?? annualized_return`) handles the camelCase→snake_case impedance mismatch between the live SSE stream (camelCase from TypeScript) and the historical DB query (snake_case from Postgres column names). This pattern is already used by `totalFees` / `total_fees` in the same hook.

**Alternatives considered**:
- Normalize to snake_case in the API — would require changing existing response format; rejected (additive-only constraint)
- Normalize to camelCase in the DB query using `AS "annualizedReturn"` — would work but changes the DB query pattern inconsistently vs other fields

---

## Summary of Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Solver algorithm | Newton-Raphson (primary) + bisection fallback | Industry standard; reliable for DCA cash-flow shapes |
| Fixed-point library | Decimal.js `pow()` with precision=20 | Constitutionally required; reliable for fractional exponents |
| Timestamp arithmetic | `Date.parse()` / 365.25 days/year | ISO 8601 UTC reliable; Julian year standard for IRR |
| Code location | `orchestrator/api/src/services/IrrCalculator.ts` | Follows existing service pattern; testable in isolation |
| Single-run injection point | `BackgroundWorker.ts` post-engine | First point where tradeEvents + start_date are co-located |
| Batch-run injection point | `optimizer.routes.ts` result event handler | runConfigMap provides start_date lookup |
| Migration index | idx 6 (`0006_020_annualized_return.sql`) | idx 5 must be backfilled first (stop_loss_kpis) |
| Frontend parse | `annualizedReturn ?? annualized_return ?? null` | Handles live-stream vs DB impedance mismatch |
