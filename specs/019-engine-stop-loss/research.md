# Research: Engine Stop-Loss Mechanism

**Feature**: 019-engine-stop-loss  
**Date**: April 3, 2026  
**Status**: Complete

---

## Q1: How does `exitOnLastOrder` currently interact with the SL mechanism?

**Finding**: `ExitOnLastOrder` is a `bool` field on `domain/position/position.go:Position`. It is checked inside `minute_loop.go` during Step 3b (after order fills). When `ExitOnLastOrder = true` and `HasMoreOrders` becomes false, the position closes immediately with `Reason = "last_order_filled"`.

**Decision**: When `stop_loss_enabled = true`, the `exitOnLastOrder` check is suppressed — the SL mechanism governs the exit instead. Implementation: add guard at top of the early-exit check: `if pos.ExitOnLastOrder && !pos.StopLossEnabled`.

**Rationale**: The entire purpose of SL is to take over position exit when all orders are filled and the market keeps falling. Allowing `exitOnLastOrder` to fire first would close at a potentially worse time than the SL would select.

**Alternatives considered**: Making the operator choose one or the other via validation. Rejected — too prescriptive; it's cleaner to have SL silently override.

---

## Q2: Where is the pessimistic execution order implemented, and how should SL be inserted?

**Finding**: `minute_loop.go` implements: Step 2 (entry market buy) → Step 3a (fill orders at low) → Step 3b (recalculate aggregates after fills) → Step 3c (liquidation check) → Step 3d (take-profit check). The PESSIMISTIC ORDER GUARANTEE is documented as immutable in the file's header comments.

**Decision**: Insert SL as Step 3c.5 (between liquidation and take-profit). New order: Buy Orders → Liquidation Check → **Stop-Loss Check** → Take-Profit Check. Step 3c.5 evaluates against `candle.Low` for breach detection and contains the timeout counter logic.

**Rationale**: SL fires before TP (pessimistic — worst-case scenario). Liquidation still has absolute priority (exchange-enforced margin call). This exactly matches the spec FR-011/FR-012.

---

## Q3: How does `TradeClosedEvent.Reason` map to win rate calculation?

**Finding**: `TradeClosedEvent.Reason` is a `string` with current values: `"take_profit"`, `"liquidation"`, `"end_of_backtest"`, `"last_order_filled"`. The aggregator in `cmd/engine/aggregator.go` does NOT currently count per-reason — it only accumulates `realizedPnl` from `PositionClosed`. Win rate is computed in the TypeScript API layer from trade events.

**Decision**: 
1. Add `"stop_loss"` as a new reason value in `TradeClosedEvent`.
2. Add `stop_loss_count` tracking in `aggregator.go` by detecting `TradeClosedEvent.Reason == "stop_loss"`.
3. Emit `TotalStopsTriggered` in `EngineResultPayload`.
4. The API layer computes win rate from `total_take_profits` and `total_stops_triggered` in the result payload. Add `TotalTakeProfits` to the result payload too for clean calculation.

**Rationale**: The domain already distinguishes close reasons — minimal change. Aggregator scan-once for SL count.

---

## Q4: How does the wide event `close_reason` field handle stop-loss?

**Finding**: `WideEvent.CloseReason string` is already in the wide event schema. For TP closes it receives `"take_profit"`. For liquidation it receives `"liquidation"`. For SL, we simply pass `"stop_loss"` as the `CloseReason`.

**Decision**: No schema change to `WideEvent` struct. The `event_type` field tracks whether it was `position_opened`, `order_filled`, or `position_closed`. For SL closes: `event_type = "position_closed"` and `close_reason = "stop_loss"`. The wide event enricher already handles `TradeClosedEvent` — it simply needs to propagate the new reason string.

**Rationale**: Zero ClickHouse DDL changes needed. `CloseReason` is `LowCardinality(String)` which accepts any string value.

---

## Q5: Where do SL config parameters flow from EngineRequest through to Position?

**Finding**: The flow is:
1. `cmd/engine/main.go` → parses `EngineRequest` JSON from stdin
2. Constructs `domain/config.Config` using functional options
3. Passes `domainConfig` to `orchestrator.OrchestratorConfig{DomainConfig: cfg}`
4. `orchestrator.go` creates `position.NewPosition()` with price/amount grids from config
5. Copies config fields like `ExitOnLastOrder` directly to `pos.ExitOnLastOrder`

**Decision**: Add 4 new fields to `EngineRequest`, map them into `domain/config.Config` via new `With*` options. In `orchestrator.go`, copy the 4 SL fields from `domainConfig` to the Position before first candle. This is exactly how `ExitOnLastOrder` is currently handled.

**Rationale**: Follows the existing pattern exactly. No plumbing changes to the orchestrator — only the same config-to-position copy pattern already used.

---

## Q6: How does the API sweep config pass SL parameters to batch engine runs?

**Finding**: The sweep configuration is serialized as JSON and stored in `sweep_sessions.configSnapshot`. Individual run configs are variations (one per permutation). The batch runner in `cmd/engine/main.go` reads `--batch-config` from a JSON array file emitted by the API.

**Decision**: Add 4 SL fields to the TypeScript `ApiSweepRunConfig` type. The sweep expansion logic (which already handles range/array sweep for parameters like `price_entry`) will treat `stop_loss_percent` and `stop_loss_timeout_minutes` as sweepable using the same mechanism, and `stop_loss_baseline` as a fixed parameter.

**Rationale**: No new sweep expansion mechanism. `stop_loss_baseline` requires single selection (not sweepable per spec FR-018), which the UI enforces via a simple dropdown.

---

## Q7: Should `stop_loss_executed` be a new WideEvent event_type, or use `position_closed` with `close_reason = "stop_loss"`?

**Finding**: The spec FR-021 says emit with `event_type = 'stop_loss_executed'`. The current WideEvent `event_type` values are: `"price_changed"`, `"order_filled"`, `"position_opened"`, `"position_closed"`. Using `position_closed` + `close_reason` is more consistent with the existing schema.

**Decision**: Use `event_type = "position_closed"` and `close_reason = "stop_loss"` for Grafana dashboards — this is consistent with how TP and liquidation closes work. Additionally, the wide event enricher can emit a dedicated `event_type = "stop_loss_executed"` row if FR-021 must be satisfied literally. To keep implementation simple: use `"position_closed"` + `close_reason = "stop_loss"` only (covers all Grafana use cases without schema churn).

**Rationale**: Grafana panels already filter on `close_reason`. Using a new `event_type` would require Grafana query changes. Since ClickHouse `event_type` is `LowCardinality(String)`, both options work — but consistency wins.

---

## Q8: What is the SL trigger price precision? Does it use ROUND_HALF_UP?

**Finding**: All monetary math in the engine uses `shopspring/decimal` with `ROUND_HALF_UP` (per constitution). The SL trigger is: `entry × (1 - percent/100)`. Using `shopspring/decimal.Mul(decimal.NewFromFloat(1).Sub(pct.Div(hundred)))`.

**Decision**: SL trigger computed with `shopspring/decimal`, no explicit rounding — trigger stored at full decimal precision. The breach condition `candle.Low ≤ SL_trigger` is a decimal comparison, so float precision is not an issue.

**Rationale**: Full precision is required (constitution). Rounding a trigger price could cause missed or premature stops.

---

## Technology Decisions Summary

| Decision | Chosen | Rationale |
|----------|--------|-----------|
| SL breach state location | Added to `Position` struct | Follows existing state pattern; breach timestamp is per-position runtime state |
| Config transport | 4 new `domain/config.Config` fields + `With*` options | Mirrors `ExitOnLastOrder` pattern exactly |
| `exitOnLastOrder` override | Guard in `minute_loop.go` with `pos.StopLossEnabled` check | Minimal, clear, reversible |
| Wide events | `close_reason = "stop_loss"`, existing `event_type = "position_closed"` | No DDL change; Grafana compatible |
| Win rate + KPI | New `TotalStopsTriggered`, `TotalTakeProfits` in `EngineResultPayload` | Aggregator clean scan |
| DB migration | New column `total_stops_triggered integer` on `sweep_run_summaries` | Standard Drizzle migration |
