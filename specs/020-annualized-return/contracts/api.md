# Contract: Annualized Return — API & Service Interfaces

**Branch**: `020-annualized-return` | **Date**: 2026-04-06

---

## Overview

This feature is **additive only**. No existing API endpoints change their schema or behaviour. The `annualizedReturn` field is added as an optional field to existing response shapes. All new interfaces are TypeScript.

---

## 1. `IrrCalculator` Service Contract

**File**: `orchestrator/api/src/services/IrrCalculator.ts`

```typescript
import { StoredTradeEvent } from '../types/index.js';

/**
 * Compute the Internal Rate of Return (IRR) as an annualised percentage.
 *
 * Cash-flow construction:
 *   - Initial outflow: accountBalance at t=0 (backtest start_date)
 *   - DEPOSIT events: event.balance as outflow at event.rawTimestamp
 *   - Terminal inflow: last event's balance at last event's rawTimestamp
 *
 * Returns null when:
 *   - No capital deployed (zero accountBalance + no deposits)
 *   - All cash flows are non-negative (no outflows)
 *   - Both Newton-Raphson and bisection solvers fail to converge
 *
 * Returns -100 when terminal balance is zero (full liquidation).
 *
 * @param tradeEvents  Array of trade events from the Go engine result
 * @param startDate    ISO 8601 UTC string — backtest config start_date — anchors t=0
 * @param accountBalance  Initial account balance as a decimal string (e.g. "1000.00")
 */
export function computeAnnualizedReturn(
  tradeEvents: StoredTradeEvent[],
  startDate: string,
  accountBalance: string,
): number | null;
```

**Behaviour contract**:
- Returns a `number` rounded to 4 decimal places (e.g., `10.0000`) — NOT a string
- MUST use Decimal.js for all intermediate computations (Newton-Raphson, bisection); no `Math.pow` or `number` arithmetic in cash-flow or solver code
- Is synchronous and stateless
- Does not mutate `tradeEvents`

---

## 2. Extended `StoredPnlSummary` Interface

**File**: `orchestrator/api/src/types/index.ts`

```typescript
export interface StoredPnlSummary {
  roi: number;
  maxDrawdown: number;
  totalFees: number;
  winRate?: number;
  annualizedReturn?: number | null;  // NEW — IRR as % per year; null = not computable
}
```

**Backward compatibility**: `annualizedReturn` is optional. All existing code constructing `StoredPnlSummary` without this field continues to compile and function correctly.

---

## 3. `GET /session/:id/results` — Response Change

This endpoint returns persisted `sweep_run_summaries` rows. After the migration, each result object gains:

```typescript
{
  // existing fields
  run_id: string;
  roi: string;                // numeric string, 4dp
  max_drawdown: string;
  total_fees: string;
  win_rate: string;
  capital_efficiency: string;
  // ...
  // NEW field
  annualized_return: string | null;  // bare numeric string "10.0000" or null
}
```

**No breaking change**: existing consumers ignore unknown fields. The field name matches the Postgres column name (snake_case) as returned by Drizzle `.select()`.

---

## 4. SSE Stream Event — `result` Type Change

The SSE stream from `POST /session/:id/execute` emits events of `type: "result"`. After this feature, the `pnlSummary` sub-object gains:

```typescript
interface BatchRunResultEvent {
  type: 'result';
  run_id: string;
  pnlSummary: {
    roi: number;
    maxDrawdown: number;
    totalFees: number;
    winRate?: number;
    annualizedReturn?: number | null;  // NEW
  };
  // ... other fields unchanged
}
```

**No breaking change**: field is optional. Existing SSE consumers (including the frontend before it is updated) ignore the new field.

---

## 5. Frontend `PnlSummary` Interface

**File**: `frontend/src/services/types.ts`

```typescript
export interface PnlSummary {
  roi: number;
  maxDrawdown: number;
  totalFees: number;
  winRate?: number;
  annualizedReturn?: number | null;  // NEW — null renders as "N/A"
}
```

---

## 6. Display Rules (UI Contract)

| Value | Display |
|-------|---------|
| `number` (e.g., `10.2500`) | `"10.2500%"` — append `%` symbol in UI only |
| `null` | `"N/A"` — string literal, not zero, not blank |
| `undefined` (field absent) | `"N/A"` — treat same as null |

This display contract applies to:
- `PnlSummary.tsx` MetricCard: label `"Annualized Return (IRR)"`
- `RunCard.tsx` detail row: label `"Annualized Return"`
- Optimizer leaderboard table: column header `"Annualized Return %"` (no `%` in the data value, only in the header/label)

---

## 7. Database Column Contract

| Table | Column | Type | Nullable |
|-------|--------|------|---------|
| `sweep_run_summaries` | `annualized_return` | `numeric(10,4)` | YES |

Stored as a bare decimal (e.g., `10.0000`). Grafana formats with `%` via its own unit configuration.

---

## 8. Grafana Panel Contract

**Dashboard**: `04-sweep-leaderboard.json`

New leaderboard SQL column:
```sql
ROUND(annualized_return::numeric, 4) AS "Annualized Return %"
```

New stat panels (mirroring existing "Best ROI" / "Avg ROI" at IDs 3/4):
- **"Best Annualized Return"**: `SELECT MAX(annualized_return) FROM sweep_run_summaries WHERE session_id = '$session_id'`
- **"Avg Annualized Return"**: `SELECT AVG(annualized_return) FROM sweep_run_summaries WHERE session_id = '$session_id'`

Field override for `"Annualized Return %"`:
- Unit: `percent` (Grafana `percent` unit appends `%`)
- Color mapping: same thresholds as `ROI %` (green > 0, red < 0)

**Dashboards**: `01-run-overview.json` and `04-sweep-promoted-comparison.json` — add `annualized_return` stat panel alongside existing ROI panel.

---

## 9. No Changes to These Contracts

- Go engine NDJSON protocol — unchanged (engine emits `tradeEvents` as before)
- ClickHouse `sweep_wide_events` schema — unchanged (SC-008)
- Postgres schema for `sweep_sessions` or `sweep_run_results` — unchanged
- Existing API endpoints `/session`, `/session/:id`, `/session/:id/promote` — unchanged
