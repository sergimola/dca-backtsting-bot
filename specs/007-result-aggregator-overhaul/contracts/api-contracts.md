# Contracts: Result Aggregator Overhaul

**Date**: 2026-03-14

## External Interface Changes

This feature introduces **no changes to the external REST API** exposed by `orchestrator/api`. The `POST /backtest` endpoint contract, request/response shape, and `BacktestResult` JSON schema stored to disk are all unchanged.

## Internal Interface Changes (frontend ↔ orchestrator/api)

The shape of the `BacktestResults` TypeScript type returned by `getResults()` is unchanged. Only the **semantic content** of two fields changes:

| Field | Before | After |
|-------|--------|-------|
| `tradeEvents[].trade_id` | Go engine UUID/run-ID (same for all trades) | Sequential integer string: `"1"`, `"2"`, `"3"`, … |
| `tradeEvents[].fee` for EXIT events | Always `0` (SellOrderExecuted was not processed) | Actual exit fee from `SellOrderExecuted.fee` |
| `safetyOrderUsage[0].level` | `"0"` (phantom SO0 from entry) | Does not exist; array starts at `"1"` |

These are **backwards-incompatible within the frontend** — any test that asserts `trade_id` equals a specific UUID or that `safetyOrderUsage[0].level === "0"` must be updated.

## PnlSummary Storage Schema (persisted JSON)

`pnl_summary.safety_order_usage_counts` no longer contains key `"0"`. Existing stored result files on disk may still contain `"0"` keys from the old code — they will render correctly after the loop-start fix (`i=1`) since the old key `"0"` will never match any `i` in the new loop.
