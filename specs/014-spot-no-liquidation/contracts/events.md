# Contracts: Spot Trading Liquidation Bypass (Multiplier = 1)

**Branch**: `014-spot-no-liquidation`

## Scope

This feature modifies only **internal Go struct fields and function-local logic** within the `core-engine` domain. No external interfaces (HTTP API, CLI, CSV input schema, WebSocket events) are changed.

The only behavioral contract that external consumers must be aware of is:

## `liquidation_price` Field in Emitted Events

### `LiquidationPriceUpdatedEvent` (emitted after each safety order fill)

```json
{
  "event_type": "liquidation_price.updated",
  "trade_id": "...",
  "timestamp": "...",
  "liquidation_price": "0",    ← "0" for spot (Multiplier=1); non-zero string for futures
  "current_price": "...",
  "price_ratio": "0"           ← "0" when liquidation_price is "0"
}
```

**Contract**: When `Multiplier = 1`, `liquidation_price` MUST be `"0"` (the string representation of `Decimal("0")`). Consumers MUST treat `"0"` as "no liquidation threshold applies" and MUST NOT display a liquidation indicator to the user for spot positions.

### `BuyOrderExecutedEvent` (emitted for each order fill)

```json
{
  "event_type": "order.buy.executed",
  ...
  "liquidation_price": "0"    ← "0" for spot; formula result for futures
}
```

Same contract as above.

## No Other Interface Changes

- REST API response shapes: unchanged
- CSV candle input schema: unchanged
- Backtest configuration input (JSON): `multiplier` field already exists; no new fields
- `TradeClosedEvent`, `TradeOpenedEvent`, `SellOrderExecutedEvent`: unchanged
