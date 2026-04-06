# Data Model: Annualized Return (IRR / Money-Weighted Return)

**Feature**: 020-annualized-return  
**Date**: 2026-04-06

---

## New Service Module (`orchestrator/api/src/services/IrrCalculator.ts`)

### `CashFlow` (internal type)

```typescript
interface CashFlow {
  t: number;       // Fractional years from backtest start (computed as days / 365.25)
  amount: number;  // Signed amount — NEGATIVE for outflows (investments), POSITIVE for inflows
}
```

This is an internal type used within `IrrCalculator.ts` only — not exported.

### `computeAnnualizedReturn` (exported function)

```typescript
export function computeAnnualizedReturn(
  tradeEvents: StoredTradeEvent[],
  startDate: string,      // ISO 8601 UTC — backtest config start_date — anchors t=0
  accountBalance: string  // Initial account balance as a decimal string (first outflow)
): number | null
```

**Returns**: `annualizedReturn` as a plain `number` (e.g., `10.0000`), or `null` on solver failure / no capital deployed. The caller is responsible for rounding to 4dp before serialization.

**Cash-flow construction rules**:

| Source | Time | Amount | Sign |
|--------|------|--------|------|
| `accountBalance` config field | `t = 0` (start_date) | `parseFloat(accountBalance)` | Negative (outflow) |
| `DEPOSIT` event | `(Date.parse(event.rawTimestamp) - Date.parse(startDate)) / (365.25 * 86400000)` | `event.balance` | Negative (outflow, injection amount) |
| Last event in `tradeEvents` | `(Date.parse(last.rawTimestamp) - Date.parse(startDate)) / (365.25 * 86400000)` | `last.balance` | Positive (terminal inflow) |

**Edge case rules**:

| Condition | Return Value |
|-----------|-------------|
| `accountBalance == "0"` AND no `DEPOSIT` events | `null` |
| Terminal balance == `0` | `-100` (i.e., -100.0000% annualised) |
| All cash flows non-negative (no outflows) | `null` |
| Newton-Raphson diverges AND bisection fails | `null` |

**Solver specification**:

```
NPV(r) = sum of [ CF_i / (1+r)^t_i ] where all computations use Decimal.js (precision=20)

Newton-Raphson:
  initial guess r0 = 0.1
  iterate: r_n+1 = r_n - NPV(r_n) / NPV'(r_n)
  dNPV/dr = sum of [ -t_i * CF_i / (1+r)^(t_i+1) ]
  convergence: |NPV(r_n)| < 1e-10 OR |r_n+1 - r_n| < 1e-12
  max iterations: 100
  divergence condition: (1 + r_n) <= 0

Bisection fallback (if NR diverges or derivative too small):
  bracket: r_lo = -0.9999, r_hi = 100.0
  iterate: r_mid = (r_lo + r_hi) / 2
  select half where sign(NPV(r_mid)) != sign(NPV(r_lo))
  max iterations: 100
  convergence: |r_hi - r_lo| < 1e-12
```

---

## Modified Type: `StoredPnlSummary` (`orchestrator/api/src/types/index.ts`)

**Current**:
```typescript
export interface StoredPnlSummary {
  roi: number;
  maxDrawdown: number;
  totalFees: number;
  winRate?: number;
}
```

**After**:
```typescript
export interface StoredPnlSummary {
  roi: number;
  maxDrawdown: number;
  totalFees: number;
  winRate?: number;
  annualizedReturn?: number | null;  // IRR as % per year; null if not computable
}
```

**Rationale**: Optional (`?`) preserves backward compatibility with all existing call sites that construct `StoredPnlSummary` without this field.

---

## Modified Type: `BatchRunResult.pnlSummary` (`orchestrator/api/src/types/optimizer.ts`)

The `pnlSummary` shape within batch results must also accept `annualizedReturn`. The existing type re-uses `StoredPnlSummary` — no separate change needed if the interface is already shared.

> **Implementation note**: If `optimizer.ts` has an inline `pnlSummary` type (not referencing `StoredPnlSummary`), it must also be updated to add `annualizedReturn?: number | null`.

---

## Modified DB Schema: `sweepRunSummaries` (`orchestrator/api/src/db/schema.ts`)

**Current** (last two columns before `createdAt`):
```typescript
totalStopsTriggered: integer('total_stops_triggered').notNull().default(0),
promotedAt:          timestamp('promoted_at', { withTimezone: true }),
```

**After** (new column inserted before `promotedAt`):
```typescript
totalStopsTriggered: integer('total_stops_triggered').notNull().default(0),
annualizedReturn:    numeric('annualized_return', { precision: 10, scale: 4 }),
promotedAt:          timestamp('promoted_at', { withTimezone: true }),
```

**Precision choice**: `numeric(10, 4)` matches `roi`, `maxDrawdown`, and `totalFees`. Stores annualized return as a bare decimal (e.g., `10.0000`). Column is nullable — `null` when IRR is not computable.

---

## New Migration File (`orchestrator/api/drizzle/0006_020_annualized_return.sql`)

```sql
-- Migration: 0006 — Add annualized_return to sweep_run_summaries
-- Feature:   020-annualized-return
-- Date:      2026-04-06

ALTER TABLE sweep_run_summaries
  ADD COLUMN IF NOT EXISTS annualized_return numeric(10,4);
```

`IF NOT EXISTS` guard ensures idempotency on fresh DB installs.

---

## Modified Journal (`orchestrator/api/drizzle/meta/_journal.json`)

Two new entries must be added (idx 5 was previously missing from the journal):

```json
{
  "idx": 5,
  "version": "7",
  "when": 1775200000000,
  "tag": "0005_019_stop_loss_kpis",
  "breakpoints": true
},
{
  "idx": 6,
  "version": "7",
  "when": 1775290000000,
  "tag": "0006_020_annualized_return",
  "breakpoints": true
}
```

> **Important**: Both entries are needed. The current journal ends at idx 4. The SQL file `0005_019_stop_loss_kpis.sql` exists on disk but has no journal entry — it must be added at idx 5 before the new migration at idx 6.

---

## Modified Service: `SweepPersistenceService.ts`

The `persistRunSummary()` call to `db.insert(sweepRunSummaries).values({...})` must include:

```typescript
annualizedReturn: runResult.pnlSummary?.annualizedReturn != null
  ? String(runResult.pnlSummary.annualizedReturn.toFixed(4))
  : null,
```

This converts the `number | null` from `StoredPnlSummary` to a bare numeric string with 4dp (as required by `numeric(10,4)` Drizzle column type) or `null`.

---

## Frontend Type: `PnlSummary` (`frontend/src/services/types.ts`)

```typescript
export interface PnlSummary {
  roi: number;
  maxDrawdown: number;
  totalFees: number;
  winRate?: number;
  annualizedReturn?: number | null;  // IRR as % per year; null = "N/A"
}
```

---

## Canonical Test Cases

These test cases are binding per spec SC-001/SC-002. `IrrCalculator.test.ts` MUST assert these exact outputs (tolerance ±0.0001):

| ID | Cash Flows | Times (years) | Expected `annualizedReturn` | Notes |
|----|-----------|---------------|----------------------------|-------|
| TC-1 | `[-1000, +1100]` | `[0.0, 1.0]` | `10.0000` | Simple 1-year |
| TC-2 | `[-1000, +1050]` | `[0.0, 0.5]` | `10.2500` | 6-month: `(1.05²−1)×100` |
| TC-3 | `[-1000, -500, +1650]` | `[0.0, 0.5, 1.0]` | `10.0000` | Mid-year deposit |
| TC-4 | `[-1000, +0]` | `[0.0, 1.0]` | `-100.0000` | Full loss edge case |
| TC-5 | `[-1000, +1000]` | `[0.0, 1.0]` | `0.0000` | Break-even |

**Edge case tests** (also binding):

| ID | Scenario | Expected |
|----|---------|---------|
| EC-1 | Zero initial balance, no deposits | `null` |
| EC-2 | All cash flows non-negative | `null` |
| EC-3 | Sub-30-day backtest (large annualized projection) | non-null, large positive number |
| EC-4 | Zero final balance (full liquidation) | `-100` |
| EC-5 | Break-even exact | `0.0000` |
