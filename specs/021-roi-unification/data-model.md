# Data Model: Unified ROI Calculation

**Date**: 2026-04-07 | **Branch**: `021-roi-unification`

---

## New Entity: `calculateRoi` utility

**Module**: `frontend/src/services/roiCalculator.ts`

```typescript
// Signature
function calculateRoi(
  netProfit: number,
  initialBalance: number,
  totalAdditions: number
): number

// Returns: ROI as a plain JS `number` (e.g., 5.0 means 5%).
// Decimal.js is used INTERNALLY to perform the division without floating-point
// precision loss. The caller receives a standard number, not a Decimal instance.
// Returns 0 when (initialBalance + totalAdditions) <= 0.
```

**Formula**: `netProfit / (initialBalance + totalAdditions) × 100`

**Test cases** (from canonical spec table):

| netProfit | initialBalance | totalAdditions | Expected result |
|-----------|---------------|----------------|-----------------|
| `50` | `1000` | `0` | `5.0000` |
| `50` | `1000` | `200` | `4.1667` |
| `200` | `1000` | `1200` | `18.1818` |
| `0` | `0` | `0` | `0.0000` (zero-guard) |
| `25` | `0` | `500` | `5.0000` |

---

## Modified Type: `NetMetrics`

**Module**: `frontend/src/services/metricsCalculator.ts`

**Before**:
```typescript
export interface NetMetrics {
  netProfit: number
  roi: number               // ← REMOVED
  closedTradesCount: number
}
```

**After**:
```typescript
export interface NetMetrics {
  netProfit: number
  closedTradesCount: number
}
```

**Rationale**: `roi` is removed because no caller needs `metricsCalculator` to provide it after the
fix. `RunCard.tsx` will consume `pnlSummary.roi` directly. Removing the field makes the type honest
about what the function actually provides (net profit from event aggregation, not ROI from config).

---

## Modified Hook: `useResultsMetrics` return value

**Module**: `frontend/src/hooks/useResultsMetrics.ts`

The `DashboardMetrics` type shape is unchanged (roi field stays). The value source changes:

| Field | Old source | New source |
|-------|-----------|------------|
| `roi` | `netProfit / accountBalance * 100` (frontend re-derivation) | `pnlSummary.roi` (engine value, direct) |
| `annualizedReturn` | `pnlSummary.annualizedReturn` (pass-through) | unchanged |
| `accountEquity` | `trueCapitalAvailable + netProfit` (correct) | unchanged |
| `capitalUtilized` | `totalCapital / trueCapitalAvailable * 100` (correct) | unchanged |
| `netProfit` | sum of EXIT event balances (correct) | unchanged |

---

## Modified Component: `RunCard` display logic

**Module**: `frontend/src/components/RunCard.tsx`

**Before** (simplified):
```typescript
// When tradeEvents present:
displayNetProfit = metrics.netProfit
displayNetRoi   = (metrics.netProfit / accountBalance) * 100   // ← BUG

// When tradeEvents empty:
displayNetProfit = (pnlSummary.roi / 100) * accountBalance
displayNetRoi   = pnlSummary.roi
```

**After**:
```typescript
// Both cases:
displayNetRoi    = completedResults.pnlSummary.roi             // engine is authoritative

// For dollar display:
// When tradeEvents present: use metrics.netProfit (event-derived, accurate)
// When tradeEvents empty:   use (pnlSummary.roi / 100) * accountBalance (existing fallback, acceptable)
```

The `metricsCalculator` is still used for `closedTradesCount` and `netProfit` (dollar amount)
when tradeEvents are available. The roi line in `calculateNetMetrics` is simply deleted.

---

## No schema changes

No database columns, no API request/response shapes, no SSE event fields are modified. The Go engine
is not touched. The orchestrator TS layer is not touched.
