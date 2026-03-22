# Research: Feature 012 — Monthly Capital Injection

**Phase**: 0 — Pre-design research  
**Branch**: `012-monthly-capital-injection`  
**Date**: 2026-03-16

---

## 1. Resolved: Go Engine Config Layer — Status

**Question**: Are `EngineRequest.MonthlyAddition`, `buildConfigFromRequest` parsing, and `domain/config.Config.MonthlyAddition()` already implemented, or do they need to be written?

**Decision**: Already fully implemented. No changes required.

**Rationale**: Direct codebase inspection confirmed:
- `EngineRequest` in `core-engine/cmd/engine/main.go` already contains `MonthlyAddition string \`json:"monthly_addition,omitempty"\``.
- `buildConfigFromRequest` already parses it with `decimal.NewFromString`, defaulting to `config.DefaultMonthlyAddition` on an empty string, and wires it via `config.WithMonthlyAddition(monthlyAddition)`.
- `domain/config/config.go` already stores `monthlyAddition decimal.Decimal`, exposes `MonthlyAddition() decimal.Decimal`, and has `WithMonthlyAddition()` functional option.
- `DefaultMonthlyAddition = decimal.NewFromFloat(0.0)` is already defined.

**Alternatives considered**: Writing them from scratch (rejected — implementation already present and tested).

---

## 2. Resolved: Orchestrator Monthly Trigger — Current Behavior vs. Target

**Question**: How does the Orchestrator currently handle monthly additions, and what exactly must change?

**Decision**: Replace the calendar-month trigger with a fixed 43,200-candle global counter.

**Current behavior** (from `orchestrator.go`):
- A local `runningBalance decimal.Decimal` and `lastMonth int` are declared as loop-local variables.
- The trigger fires only when `orch.position == nil` (i.e., between trades) and only when the calendar month changes (`candleMonth > lastMonth`).
- This has two bugs: (a) a monthly boundary crossed while a trade is open is silently skipped; (b) the trigger is calendar-based, not candle-count-based, so it misfires on sparse data or non-1m timeframes.

**Target behavior**:
- `globalCandleCount int64` and `runningBalance decimal.Decimal` move to the `Orchestrator` struct (persist across `RunBacktest` invocations if needed, reset at the top of each `RunBacktest` call).
- Increment `globalCandleCount` on every candle, regardless of position state.
- When `globalCandleCount % 43200 == 0 && !monthlyAdd.IsZero()`: increment `runningBalance`; if position open, also increment `position.AccountBalance` and append `MonthlyAdditionEvent`.
- Profit carryover: when `TradeClosedEvent` is found, parse `tce.Profit` via `decimal.NewFromString` and add to `runningBalance`.

**Alternatives considered**:
- Keeping calendar-month trigger but at the Orchestrator level (rejected — spec mandates candle-count based, consistent with PSM's prior approach; calendar month is unreliable for sparse/gap data).
- Keeping local variables (rejected — they reset every `RunBacktest` call and are not accessible outside the loop).

---

## 3. Resolved: PSM Cleanup — Scope and Test Impact

**Question**: Which exact lines must be removed from `minute_loop.go`, and which tests will break?

**Decision**: Remove the `if pos.CandleCount > 0 && pos.CandleCount%43200 == 0 && !pos.MonthlyAddition.IsZero()` block (lines ~87–100). Keep `pos.CandleCount++`.

**Rationale**: After removal, the PSM emits no `MonthlyAdditionEvent` and does not modify `AccountBalance` at the 43,200-candle boundary. The Orchestrator becomes sole emitter.

**Test impact**: `core-engine/domain/position/monthly_addition_test.go` and `canonical_integration_test.go` scenario 7 are affected:
- Tests T088–T091 that assert PSM emits `MonthlyAdditionEvent` at candle 43,200 must be **updated** to describe Orchestrator-level behavior (i.e., the PSM should NOT emit them).
- Test T086 (`CandleCount` increments) is unaffected — `pos.CandleCount++` is kept.
- New Orchestrator-level tests must be written to cover the 43,200-candle tick, profit carryover, and multi-trade balance propagation.

**Alternatives considered**: Leaving the PSM trigger and having the Orchestrator suppress double-injection with a flag (rejected — fragile, adds complexity, and still leaves a conceptual violation of single-responsibility).

---

## 4. Resolved: TypeScript API — Validation Pattern

**Question**: Where exactly is `monthly_addition` validation added, and what is the existing pattern for optional decimal string fields?

**Decision**: Add to both `orchestrator/api/src/types/index.ts` (interface only) and `orchestrator/api/src/types/configuration.ts` (interface + `validateBacktestRequest` function). The `configuration.ts` version is authoritative for validation; `index.ts` is the shared type contract.

**Pattern for optional fields**: The existing `idempotency_key` field is the model:
```typescript
// In validateBacktestRequest, after account_balance validation:
let validatedMonthlyAddition: string = '0';
if (request.monthly_addition !== undefined && request.monthly_addition !== null && request.monthly_addition !== '') {
  if (typeof request.monthly_addition !== 'string') { throw ValidationError(...) }
  validatedMonthlyAddition = validateDecimal(request.monthly_addition);  // may throw
  if (parseFloat(validatedMonthlyAddition) < 0) { throw ValidationError(...) }
}
// In return object:
monthly_addition: validatedMonthlyAddition,
```
The default `'0'` is returned when the field is absent, which the Go engine maps to `decimal.Zero`.

**Alternatives considered**: Zod schema (not in use — existing codebase uses hand-rolled `validateBacktestRequest`); making it required with default in DB layer (rejected — optional field with a server-side default is the correct REST pattern).

---

## 5. Resolved: React UI — Form Field Pattern

**Question**: What is the exact pattern for adding an optional numeric input to `ConfigurationForm.tsx`?

**Decision**: Add `monthlyAddition: string` to `BacktestFormState` (not in `REQUIRED_FIELDS`), add a `validateField` case that allows empty but rejects negative values, add a `FormInput` in the JSX grid, add `''` as the `EMPTY_FORM` default, and coerce to `'0'` in `backtest-api.ts` before sending.

**The three-file touch pattern** for any new optional form field:
1. `frontend/src/services/types.ts` — add `monthlyAddition: string` to `BacktestFormState`
2. `frontend/src/components/ConfigurationForm.tsx` — `EMPTY_FORM`, `validateField` case, `FormInput` JSX
3. `frontend/src/services/backtest-api.ts` — `apiPayload` + `mapConfigToFormState`
4. `frontend/src/components/ConfigSummaryPanel.tsx` — add label entry

**`FormErrors` type note**: `FormErrors` is typed as `Partial<Record<Exclude<keyof BacktestFormState, 'marginType' | 'exitOnLastOrder'>, string>>`. Adding `monthlyAddition` to `BacktestFormState` automatically includes it in `FormErrors` without any type casting.

**Alternatives considered**: Making `monthlyAddition` a number (rejected — same pattern as all other fields, which are strings to avoid JS float coercion).

---

## 6. Resolved: `MonthlyAdditionEvent` Fields — Orchestrator vs PSM Version

**Question**: The PSM's `MonthlyAdditionEvent` emission only sets `AdditionAmount`, `NewBalance`, and `DaysSinceStart`. The event struct also has `PreviousBalance` and `AdditionNumber`. The Orchestrator must populate all fields.

**Decision**: The Orchestrator has access to `orch.runningBalance` (before increment) for `PreviousBalance`, and `globalCandleCount / 43200` for `AdditionNumber`. Populate all fields.

**Concrete Orchestrator emission**:
```go
prevBalance := orch.runningBalance
orch.runningBalance = orch.runningBalance.Add(monthlyAdd)
additionNumber := int(orch.globalCandleCount / 43200)
// if position open:
orch.position.AccountBalance = orch.position.AccountBalance.Add(monthlyAdd)
monthlyEvent := &position.MonthlyAdditionEvent{
    TradeID:        orch.position.TradeID,
    Timestamp:      candle.Timestamp,
    AdditionAmount: monthlyAdd.String(),
    PreviousBalance: prevBalance.String(),
    NewBalance:     orch.position.AccountBalance.String(),
    AdditionNumber: additionNumber,
    DaysSinceStart: int(orch.globalCandleCount / 1440),
}
```

---

## 7. Resolved: Database Schema — No Migration Required

**Question**: Does the `config` JSONB column in Postgres need a schema migration to store `monthly_addition`?

**Decision**: No migration required.

**Rationale**: The `config` column is typed as `jsonb('config').notNull().$type<ApiBacktestRequest>()`. Drizzle stores the full JSON blob verbatim. Adding `monthly_addition` to the TypeScript `ApiBacktestRequest` interface means it is automatically included in the stored blob when present. Historical records without the field will deserialize with `monthly_addition: undefined`, which `mapConfigToFormState` handles via `c.monthly_addition ?? ''`.

---

## Constitution Re-check Post-Research

All gates remain GREEN. No new violations introduced by the research findings:
- The Orchestrator changes are restricted to the application layer; no domain contamination.
- `globalCandleCount` is an `int64` counter — zero monetary arithmetic risk.
- All `decimal.Decimal` operations use `.Add()` and `NewFromString` — fixed-point guaranteed.
- PSM test updates are additive (changing assertions, not bypassing tests).
