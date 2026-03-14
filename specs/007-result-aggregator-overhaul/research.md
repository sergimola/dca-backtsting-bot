# Research: Result Aggregator Overhaul

**Date**: 2026-03-14  
**Branch**: `007-result-aggregator-overhaul`  
**Sources**: Direct inspection of source files and stored result JSON `9e4e8c78-f53a-4e8b-83f8-5cdeb80a4732.json`

---

## Research Item 1: Go Engine trade_id — Is it unique per trade?

**Question**: Does the Go engine emit a distinct `trade_id` per DCA cycle, or is it shared?

**Finding**: The stored result JSON confirms the `trade_id` value `"-1773441467338497100"` appears on **every** event across **all trades** in the backtest run — including the second `PositionOpened` that starts the next cycle (confirmed at JSON line ~435). The field is a run-scoped identifier, not a trade-scoped one.

**Decision**: Ignore `e.data.trade_id` entirely for grouping. Use an incremental `tradeCounter` variable that increments on each `PositionOpened` event and is assigned to each event's `trade_id` field before pushing to the result array.

**Rationale**: Simple, reliable, source-of-truth for sequencing.

**Alternatives considered**: Using timestamp as key — rejected because multiple events share the same timestamp (e.g., multiple `BuyOrderExecuted` on the same candle).

---

## Research Item 2: SellOrderExecuted — Is it always after PositionClosed?

**Question**: What is the ordering of `PositionClosed` and `SellOrderExecuted` in the event stream? Is the exit fee reliably captured on `SellOrderExecuted`?

**Finding** (confirmed in JSON):
```
Line 402: { type: "PositionClosed",    data: { profit: "-0.05087...", ... } }
Line 416: { type: "SellOrderExecuted", data: { fee: "0.75108...", ... } }  ← same timestamp
```
- `PositionClosed` always comes **before** `SellOrderExecuted` in the array.
- They always share the same timestamp.
- `SellOrderExecuted.fee` is the exit sell fee and is NOT present on `PositionClosed`.
- `PositionClosed.profit` is the authoritative net profit (fee-adjusted).

**Decision**: Use an **imperative sequential loop** (replacing the `.filter().map()` chain) in `backtest-api.ts`:
1. On `PositionClosed`: push a `TradeEvent` with `fee: 0` and hold a reference.
2. On `SellOrderExecuted`: patch `fee` on the previously emitted `PositionClosed` event in-place.

**Rationale**: Avoids a two-pass scan; exploits the guaranteed sequence order; no new data structures required.

**Alternatives considered**:
- Two-pass (pre-scan for SellOrderExecuted, then map) — works but more code.
- Including `SellOrderExecuted` in `FILL_EVENT_TYPES` and rendering it as a UI row — rejected; it would duplicate the EXIT row.

---

## Research Item 3: BuyOrderExecuted.order_number — 1-based or 2-based?

**Question**: What value does `order_number` carry for the first safety order? Is the index 0-based or 1-based from the Go engine?

**Finding** (confirmed in JSON at line ~188):
```json
{ "order_number": 2, "fee": "0.135...", "type": "BuyOrderExecuted" }
```
- The entry order is `order_number: 1` (on `PositionOpened` configured_orders `order_index: 0`).
- The first `BuyOrderExecuted` is `order_number: 2` → SO1.
- The fourth `BuyOrderExecuted` is `order_number: 5` → SO4.

**Existing code in `aggregateGoEvents`**: `soIndex = orderNum - 1` correctly maps 2→1, 3→2, 4→3, 5→4.  
**The only bug**: `PositionOpened` is also writing `safetyOrderUsageCounts[0]`.

**Decision**: Remove the two lines in `aggregateGoEvents` that increment `safetyOrderUsageCounts[0]` for `PositionOpened`. The `BuyOrderExecuted` mapping (`orderNum - 1`) is already correct. Fix is a 2-line deletion.

**Alternatives considered**: Renaming to 1-based by adding 1 everywhere — rejected; the existing `soIndex = orderNum - 1` already produces 1-based output.

---

## Research Item 4: Safety order chart loop — Where is the X-axis data built?

**Question**: Where exactly is the SO0 phantom bar introduced in the frontend?

**Finding** (in `frontend/src/services/backtest-api.ts`):
```typescript
for (let i = 0; i < numberOfOrders; i++) {  // starts at 0 ← the bug
  const count = (countsByLevel[i] ?? 0) as number;
  safetyOrderUsage.push({ level: String(i), count });
}
```
- `numberOfOrders` = total number of configured orders from the form (e.g., 5 = 1 entry + 4 SOs).
- Loop from `i=0` always pushes `{ level: "0", count: 0 }` as the first element, since `countsByLevel["0"]` doesn't exist in the Go engine output.
- The Go engine already emits `safety_order_usage_counts` with 1-based keys `{"1":9,"2":8,...}`.

**Decision**: Change loop to `for (let i = 1; i < numberOfOrders; i++)`. This yields levels 1 through `numberOfOrders - 1`, matching the actual SO count.

**Rationale**: Minimal change; no structural refactor needed.

**Alternatives considered**: Filtering out zero-count rows — rejected; it would silently hide SO levels that exist but weren't triggered.

---

## Research Item 5: Per-trade gross profit — Where to compute?

**Question**: Should per-trade Gross Profit be computed in `ResultAggregator.ts` (server-side) or in the frontend?

**Finding**: `ResultAggregator.aggregateGoEvents()` produces a single `PnlSummary` for the entire backtest run (all trades summed). It does not output per-trade breakdowns. The per-trade grouping currently happens in `ResultsDashboard.tsx` via `groupByTradeId()`.

**Decision**: Keep per-trade computation entirely on the **frontend** side. The `TradeAccordion` component already has access to all events for a trade (including fees and the exit profit). Gross profit = `PositionClosed.profit (netProfit) + sum(all event fees in the group)`. This requires no server-side changes beyond the existing fee fields on events.

**Arithmetic precision**: Per-trade gross/net displayed as `number` (JavaScript, 2–4 decimal places). The values come from the Go engine's string decimals (up to 30 sig figs) already truncated to `parseFloat`. For display there is no compounding precision risk — this is a single addition. The spec's Decimal.js requirement applies to the fee *summation* operation, which will use `Decimal.js` in the component before converting to JS float for display.

**Rationale**: No API change required; the data already flows to the frontend. Keeps the server aggregator single-responsibility (whole-run totals).

**Alternatives considered**: Adding per-trade breakdown to `PnlSummary` type — rejected as over-engineering; the frontend already has direct access to the raw events.

---

## Research Item 6: TradeEvent type — Do we need new fields?

**Question**: Does `TradeEvent` in `types.ts` need new fields for the Trade Number and gross profit display?

**Finding**: Current `TradeEvent` has `trade_id: string`. If we assign `trade_id = "1"`, `"2"`, etc., then `groupByTradeId` still works and the accordion can render `Trade #${tradeId}` directly. No new field is needed; semantics of `trade_id` change from "engine UUID" to "sequential integer string".

**Decision**: No type change required. `trade_id` is repurposed as the sequential display number string. The `groupByTradeId` function continues to work with no changes.

**Rationale**: Zero-footprint type change; backwards compatible with tests that check `trade_id`.

---

## All NEEDS CLARIFICATION Items: Resolved

| Item | Resolution |
|------|------------|
| Go engine `trade_id` uniqueness | Same ID across entire run — must use incremental counter |
| SellOrderExecuted ordering | Always immediately after PositionClosed in the event array |
| Exit fee location | `SellOrderExecuted.fee` — NOT on `PositionClosed` |
| BuyOrderExecuted `order_number` base | 1-based; first SO is `order_number: 2` → soIndex = `orderNum - 1` = 1 |
| SO chart X-axis loop origin | Loop starts at `i=0` in `backtest-api.ts` — fix: start at `i=1` |
| SO0 bug root cause | `safetyOrderUsageCounts[0]++` in `PositionOpened` handler of `aggregateGoEvents` |
| Per-trade gross computation layer | Frontend `TradeAccordion` using `Decimal.js` addition |
| Type changes needed | None; `trade_id` repurposed to sequential string integer |
