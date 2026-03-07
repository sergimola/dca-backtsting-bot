# DCA Trading Engine — Specification-Driven Development (SDD) Master Report

> **Purpose:** This document is the complete Black-Box extraction of the DCA Trading Engine.  
> A fresh AI instance should be able to rebuild the system from scratch with **zero loss in functional logic** using only this report.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [The Mathematical Blueprint](#2-the-mathematical-blueprint)
3. [The Execution State Machine](#3-the-execution-state-machine)
4. [Universal Data Contract](#4-universal-data-contract)
5. [Discrepancy & "Dirty Code" Audit](#5-discrepancy--dirty-code-audit)
6. [Appendix: File Map](#appendix-file-map)

---

## 1. System Overview

### 1.1 What the System Does

This is a **backtesting / simulation engine** for a Dollar-Cost Averaging (DCA) long-only trading strategy on cryptocurrency pairs. It does NOT execute live trades. It replays historical 1-minute OHLCV candlestick data and simulates order fills using a pessimistic execution model:

1. Check **low** price against buy order triggers (safety orders).
2. Check **low** price against the liquidation threshold.
3. Check **high** price against the take-profit target.

### 1.2 Architectural Layers

The `src/` directory contains the core logic layers:

| Layer | Purpose | Key Files |
|-------|---------|-----------|
| **Legacy (Procedural)** | The original, battle-tested trading simulation. Uses a flat `TradingBot` class. | `trading_bot.py`, `calculate.py`, `liquidation.py`, `models.py`, `config.py`, `mediator.py`, `events.py`, `event_handler.py` |
| **Orchestration** | Selects and manages the test runs and configuration. | `main.py`, `run_manager.py`, `config_manager.py`, `file_manager.py` |
| **I/O** | Market data fetching, Elasticsearch event publishing, file caching. | `binance_data_fetcher.py`, `elastic_client.py`, `event_publisher.py` |

> **Canonical Implementation:** The Legacy (Procedural) bot is the **100% canonical source of truth** for all mathematical and execution logic. A previous attempt at a "Unified" DDD bot was an incomplete/abandoned experiment and must be entirely ignored for this rebuild.

### 1.3 Single-Position Constraint

The system enforces a **single-position-at-a-time** invariant. When a take-profit is hit the position closes and a new one opens immediately on the next candle iteration. There is never concurrent position management.

---

## 2. The Mathematical Blueprint

### 2.0 Precision & Lot Size Constraints (Strict Rule)

All monetary and quantitative calculations **MUST utilize Python's `Decimal` type** with `ROUND_HALF_UP` precision. Infinite float precision is strictly forbidden. 
Furthermore, to accurately simulate exchange constraints, base currency quantities ($Q_n$) must be rounded down (truncated) to the nearest allowed decimal step (lot size) defined by the exchange for that specific trading pair.

### 2.1 Order Sequence Formula — Price Levels $P_n$

The DCA strategy pre-computes an array of `number_of_orders` price levels below the current market price. These are the trigger prices for safety (limit) buy orders.

**Parameters:**
- $P_0$ — Current market price (close of first candle, or the sell price × 1.0005 on re-entry).
- $\delta$ — `price_entry` — the percentage drop for the first safety order (e.g., 2.0 means 2%).
- $s_p$ — `price_scale` — the geometric scale factor applied to the price deviation for each subsequent order.
- $N$ — `number_of_orders` — total number of orders (including the initial market buy).

**Recurrence Relation:**

$$
P_0 = \text{current\_price}
$$

$$
P_1 = P_0 - P_0 \cdot \frac{\delta}{100} = P_0 \left(1 - \frac{\delta}{100}\right)
$$

For $n \geq 2$:

$$
P_n = P_{n-1} - P_{n-1} \cdot \frac{\delta}{100} \cdot s_p^{(n-1)}
$$

$$
\boxed{P_n = P_{n-1} \left(1 - \frac{\delta}{100} \cdot s_p^{(n-1)}\right), \quad n \geq 2}
$$

> **Critical Detail:** The scale $s_p^{(n-1)}$ is always applied relative to the **Index** of the order (not relative to the Initial Entry). Order index 1 gets $s_p^0 = 1$ (no scale), order index 2 gets $s_p^1$, order index 3 gets $s_p^2$, etc. The price difference is always computed from the **Previous Order's price** $P_{n-1}$, not from $P_0$.

### 2.2 Order Sequence Formula — Amounts $A_n$

The total capital allocated to the trade (`amount_per_trade`) is distributed across all $N$ orders using a **geometric weighting** scheme.

**Parameters:**
- $C$ — `amount_per_trade` — total capital for this trade cycle (in quote currency, e.g., USDT).
- $s_a$ — `amount_scale` — geometric scale factor for order sizing.
- $m$ — `multiplier` — leverage multiplier (1 = spot, >1 = margin).
- $N$ — `number_of_orders`.

**Normalization Factor:**

$$
R = \sum_{i=0}^{N-1} s_a^i = \frac{s_a^N - 1}{s_a - 1} \quad \text{(for } s_a \neq 1\text{)}
$$

**Amount for order $n$ (0-indexed):**

$$
\boxed{A_n = C \cdot m \cdot \frac{s_a^n}{R}}
$$

Where $A_n$ is in **quote currency** (e.g., USDT). The actual base currency quantity purchased is $Q_n = A_n / P_n$.

> **Dynamic `amount_per_trade`:** When `amount_per_trade ≤ 1`, it is interpreted as a **fraction** of the total account equity: $C = (\text{account\_balance} + \text{total\_profit}) \times \text{amount\_per\_trade}$.

### 2.3 Dynamic Positioning — Average Entry Price $\bar{P}$

As safety orders fill, the average entry price is recalculated as a **size-weighted average** of all executed orders.

Let $k$ be the number of orders filled so far (1-indexed), and each order $j$ has:
- $P_j$ = execution price
- $Q_j = A_j / P_j$ = base currency quantity

$$
\boxed{\bar{P} = \frac{\sum_{j=1}^{k} P_j \cdot Q_j}{\sum_{j=1}^{k} Q_j} = \frac{\sum_{j=1}^{k} A_j}{\sum_{j=1}^{k} Q_j}}
$$

### 2.4 Take Profit Price $P_{tp}$

After every buy order fill, the take-profit target is recalculated:

$$
\boxed{P_{tp} = \bar{P} \cdot \left(1 + \frac{d_{tp}}{100}\right)}
$$

Where $d_{tp}$ = `take_profit_distance_percent`.

### 2.5 Liquidation Price $P_{liq}$

The liquidation formula models a **cross-margin long position**:

**Parameters:**
- $M$ = total account equity = `account_balance + total_profit`
- $Q$ = total position size (base currency)
- $\bar{P}$ = average entry price
- $\text{mmr}$ = maintenance margin rate (default: `0.0067`)

**Strict Domain Boundary:** The maintenance margin rate MUST be strictly bounded as $0 \le \text{mmr} < 1$. A value of 1.0 or greater will cause a fatal division-by-zero error.

$$
\boxed{P_{liq} = \frac{M - Q \cdot \bar{P}}{Q \cdot (\text{mmr} - 1)}}
$$

If $P_{liq} < 0$, it is clamped to $0$ (meaning liquidation is impossible — the account has sufficient collateral).

**Mechanics:** When `multiplier = 1` (spot), the numerator $M - Q \cdot \bar{P}$ is typically negative, making the fraction negative, and the clamp to 0 means **no liquidation risk on spot**.

**Liquidation Trigger:** Liquidation occurs when the **current price** (specifically the `low` of the candle) drops to or below $P_{liq}$.
**On Liquidation:** The position is closed with a loss equal to the **entire account balance**: `self.profit = -account_balance`.

### 2.6 Fee Model & Asymmetry

Fees are applied per-order (both buy and sell), deducted from position profit.

| Condition | Fee Rate |
|-----------|----------|
| `multiplier == 1` (spot) | 0.075% (`0.00075`) — Binance spot w/ BNB |
| `OrderType.MARKET` (margin) | 0.06% (`0.0006`) |
| `OrderType.LIMIT` (margin) | 0.02% (`0.0002`) |

$$
\text{fee} = P \cdot Q \cdot r_{fee}
$$

**Fee Asymmetry & Deduction:** Fees are deducted exclusively from the Quote Currency (USDT) profit ledger (`position.profit`). Buy fees do NOT reduce the actual Base Currency quantity ($Q_n$) accumulated by the position. This is a simplified ledger approach to maintain sizing consistency.

### 2.7 Profit Calculation

When a position is closed at take-profit:

$$
\boxed{\text{profit} = Q_{total} \cdot (P_{sell} - \bar{P}) - \text{total\_fees}}
$$

Where $Q_{total} = \sum Q_j$ and total_fees includes both buy and sell fees.

### 2.8 Re-Entry Price After Take Profit

When a position closes, the price grid is **re-calculated** using the sell price with a small upward offset:

$$
P_0^{(\text{new})} = P_{sell} \times 1.0005
$$

**Re-entry Ambiguity Resolved:** The new initial market buy based on $P_0^{(\text{new})}$ is evaluated starting on the **next** candle. The bot must strictly NOT re-enter a position within the exact same 1-minute candle that triggered the take-profit.

---

## 3. The Execution State Machine

### 3.1 The "Minute Loop" Protocol

Each iteration of the main loop processes **one 1-minute OHLCV candle** in the following strict sequence:

1. **Monthly Addition Check:** Increment day counter. If 30 days reached, inject capital and dispatch `MonthlyAdditionEvent`.
2. **Dispatch `PriceChangedEvent`**: Broadcast OHLCV data.
3. **Process Buy Orders (`low` price):**
   * If no position, create new Position and dispatch `TradeOpenedEvent`.
   * Check liquidation BEFORE buying if no orders trigger.
   * While `has_more_orders` AND `low` $\le$ trigger:
     * Fill order at $P_n$ (See 3.2 Gap-Down Rule), calculate fees, dispatch `BuyOrderExecutedEvent`.
     * Check liquidation AFTER each fill.
4. **Process Liquidation Break:** If liquidated, BREAK the simulation run completely.
5. **Process Take Profit (`high` price):**
   * If open AND `high` $\ge P_{tp}$:
     * Sell at $P_{tp}$, deduct fees, accumulate profit.
     * Dispatch `TradeClosedEvent` and `SellOrderExecutedEvent`.
     * Recalculate grid for the next candle.
6. **Check Early Exit:** If `early_exit_triggered` AND `exit_on_last_order`, BREAK the simulation.

### 3.2 Pessimistic Execution & The Gap-Down Rule

The check order within a single candle is pessimistic: Buy $\rightarrow$ Liquidate $\rightarrow$ Take Profit.

**The Gap-Down Paradox Rule:** If a candle's `open` gaps down past multiple safety order limit prices, the system must **strictly fill at the pre-calculated limit prices ($P_n$)**. It must ignore any gap-down pricing advantage to maintain the most pessimistic backtest simulation possible. 

### 3.3 State Transition Diagram

                ┌──────────────────┐
                │  POSITION_IDLE   │
                │  (No position)   │
                └────────┬─────────┘
                         │
                First candle processed
                         │
                         ▼
                ┌──────────────────┐
                │ POSITION_OPENING │◄──────────────────────────┐
                │ (Market Buy #1)  │                           │
                └────────┬─────────┘                           │
                         │                                     │
                Order #1 executed                               │
                         │                                     │
                         ▼                                     │
                ┌──────────────────┐                           │
          ┌────►│SAFETY_ORDER_WAIT │                           │
          │     │(Waiting for dip) │                           │
          │     └────────┬─────────┘                           │
          │              │                                     │
          │     low ≤ P[next_order]                            │
          │              │                                     │
          │              ▼                                     │
          │     ┌──────────────────┐                           │
          │     │SAFETY_ORDER_FILL │                           │
          │     │  (Limit Buy #n)  │                           │
          │     └────────┬─────────┘                           │
          │              │                                     │
          │              ├──── More orders? ──► YES ───────┐   │
          │              │                                 │   │
          │              │                                 ▼   │
          │              │                            (loop)   │
          │              │                                 │   │
          │              └──── high ≥ TP? ──► YES ─────────┼───┤
          │              │                                 │   │
          │              └──── NO ─────────────────────────┘   │
          │                                                    │
          │     low ≤ liquidation_price                        │
          │              │                                     │
          │              ▼                                     │
          │     ┌──────────────────┐                           │
          │     │ POSITION_CLOSED  │                           │
          │     │  (Liquidation)   │   ──── BREAK (end run) ───┘*
          │     └──────────────────┘                           
          │                                                    
          │     high ≥ take_profit_price                       
          │              │                                     
          │              ▼                                     
          │     ┌──────────────────┐                           
          │     │ POSITION_CLOSED  │                           
          │     │  (Take Profit)   │   ──── New position opens 
          └─────┤                  │         on next candle    
                └──────────────────┘                           
          │                                                    
          │     end_date reached                               
          │              │                                     
          │              ▼                                     
          │     ┌──────────────────┐                           
          │     │ POSITION_CLOSED  │                           
          │     │(End of Backtest) │   ──── Force close at final candle's close price
                └──────────────────┘                           

### 3.4 Temporal Logic

**Day Counter (Monthly Addition):**
The day counter increments ONLY when `i % 1440 == 0` (every 1440th row). The 30-day check happens **on every candle**, meaning the injection happens on the **first candle** of the 30th day.
*(Bug/Quirk preserved: On the very first candle (`index=0`), `0 % 1440 == 0` is true, so `days` gets incremented to 1 on the first row. The first "month" is actually 29 subsequent day-boundaries).*

---

## 4. Universal Data Contract

### 4.1 The Config Object

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `trading_pair` | `str` | `'LTC/USDT'` | Binance trading pair symbol |
| `start_date` | `str` | `'2024-01-02 14:00:00'` | Backtest start timestamp |
| `end_date` | `str` | `'2024-01-05 14:00:00'` | Backtest end timestamp |
| `price_entry` | `float` | `2.0` | Percentage drop from current price for first safety order |
| `price_scale` | `float` | `1.1` | Geometric multiplier applied to price deviation per order level |
| `amount_scale` | `float` | `2.0` | Geometric multiplier for order sizing (later orders are larger) |
| `number_of_orders` | `int` | `10` | Total number of DCA orders (including initial market buy) |
| `amount_per_trade` | `float` | `17500` | Total capital per trade cycle. If ≤ 1.0, treated as fraction of equity |
| `margin_type` | `str` | `'cross'` | Margin type: `'cross'` or `'isolated'` |
| `multiplier` | `int` | `1` | Leverage multiplier (1 = spot, >1 = margin) |
| `take_profit_distance_percent` | `float` | `0.5` | Percentage above average entry for take-profit target |
| `account_balance` | `float` | `1000` | Starting account balance in quote currency |
| `monthly_addition` | `float` | `0.0` | Monthly capital injection amount (0 = disabled) |
| `exit_on_last_order` | `bool` | `False` | If `True`, simulation stops when the last safety order fills |

### 4.2 OHLCV Contract

| Column | Type | Description |
|--------|------|-------------|
| `timestamp` | `datetime` | **UTC Timezone-Aware** datetime object |
| `open` | `Decimal` | Opening price |
| `high` | `Decimal` | Highest price in the interval |
| `low` | `Decimal` | Lowest price in the interval |
| `close` | `Decimal` | Closing price |
| `volume` | `Decimal` | Trading volume |

**Frequency:** 1-minute candles (`1m` timeframe).

**Data Source & Routing Detail:** Binance API via `ccxt` library, with local filesystem caching. 
- `/` is stripped from pair symbol for Binance API and file paths (e.g., `BTC/USDT` → `BTCUSDT`).
- **Critical Requirement:** Symbols ending in `USDC` use `ccxt.binance()` (spot); others use `ccxt.binanceusdm()` (futures).

### 4.3 Event Schema — Legacy Mediator Events

* **`RunStartedEvent`:** `run_id`, `trading_pair`, `start_date`, `end_date`, `timestamp`
* **`RunFinishedEvent`:** `run_id`, `trading_pair`, `total_profit`, `positions`, `timestamp`
* **`TradeOpenedEvent`:** `run_id`, `trade_id`, `timestamp`, `trading_pair`, `amount`, `configured_orders`, `config` (**Type: strict `Config` dataclass/model, NOT `dict`**)
* **`TradeClosedEvent`:** `run_id`, `trade_id`, `open_timestamp`, `timestamp`, `trading_pair`, `price`, `size`, `profit`, `duration`
* **`BuyOrderExecutedEvent`:** `run_id`, `trade_id`, `timestamp`, `price`, `size`, `order_type`, `liquidation_price`, `order_number`, `fee`
* **`SellOrderExecutedEvent`:** `run_id`, `trade_id`, `timestamp`, `price`, `size`, `profit`
* **`PriceChangedEvent`:** `run_id`, `trading_pair`, `timestamp`, `open`, `high`, `low`, `close`, `volume`
* **`LiquidationPriceUpdatedEvent`:** `run_id`, `trade_id`, `timestamp`, `trading_pair`, `liquidation_price`, `current_price`, `price_ratio`
* **`MonthlyAdditionEvent`:** `run_id`, `timestamp`, `trading_pair`, `addition_amount`, `previous_balance`, `new_balance`, `addition_number`, `days_since_start`

---

## 5. Discrepancy & "Dirty Code" Audit

### 5.1 Bug: Index Out of Bounds on Final Safety Order
When all `number_of_orders` have been filled, `len(self.position.orders)` equals `number_of_orders`, but `self.prices` is 0-indexed. Accessing `self.prices[number_of_orders]` causes an `IndexError`. The legacy code survived this due to Python's short-circuit evaluation in the `if` guard before the while-loop. The new DDD implementation must explicitly guard array bounds.

### 5.2 Known TODO: PriceChangedEvent Row Tracking
The legacy codebase contains a TODO to add an event for each row containing OHLCV data. This is actually already implemented via the `PriceChangedEvent`. The TODO comment is stale.

### 5.3 Known TODO: Liquidation Price Reset on Sell
When a position is closed via take-profit, the liquidation price is manually reset to `0.0` and a `LiquidationPriceUpdatedEvent` is dispatched inline. This side-effect coupling should be handled by the domain's position state transition, not inline in the sell processing loop.

### 5.4 Known TODO: Actions Tracking via Events
The legacy `actions` list is populated inline with append calls. The intention for the refactor is to derive actions solely from the Event Store projections.

### 5.5 Discrepancy: `configured_orders` Always Empty
`TradeOpenedEvent.configured_orders` is always passed as an empty list. The new architecture must populate this with the pre-calculated $P_n$ and $A_n$ grids.

### 5.6 Discrepancy: `LiquidationPriceUpdatedEvent.price_ratio` Never Set
The field `price_ratio: float = 0.0` is declared but the custom init never computes it.

### 5.7 Discrepancy: `BuyOrderExecutedEvent.size` Semantics
In the legacy bot, `size` in `BuyOrderExecutedEvent` is set to `purchase_amount` which is in **quote currency** (USDT), not base currency. This is semantically misleading. The refactored event payload must explicitly delineate `quote_amount` and `base_size`.

### 5.8 Root Script Deviations
The root directory contains experimental scripts that bypass the core logic, hack the `sys.path`, and run custom parallel execution loops. These should NOT be used as architectural references. 

### 5.9 Missing: Decimal Precision in Legacy
The original code utilized standard floats. The new implementation MUST upgrade all models and math operators to `Decimal` as dictated in Section 2.0.

---

## Appendix: File Map

*(Note: Files marked `[ABANDONED]` belonged to the failed DDD refactor attempt and must be ignored).*

src/
├── init.py
├── main.py                          # CLI entry point, orchestration
├── config.py                        # Config class, DEFAULT_CONFIG
├── config_manager.py                # ConfigManager wrapper
├── calculate.py                     # Price and amount grid calculation
├── liquidation.py                   # Liquidation price formula
├── trading_bot.py                   # ★ CANONICAL: Legacy TradingBot
├── models.py                        # Legacy dataclasses
├── events.py                        # Legacy pub/sub Event class
├── mediator.py                      # Mediator singleton
├── event_handler.py                 # Registers mediator handlers
├── event_publisher.py               # Buffered Elasticsearch publisher
├── elastic_client.py                # Elasticsearch client wrapper
├── binance_data_fetcher.py          # OHLCV fetcher with file caching
├── file_manager.py                  # Manages log and result file paths
├── run_manager.py                   # Orchestrates test runs
├── results.py                       # Formatting and comparison
├── user_interface.py                # Interactive CLI menu
├── unified_trading_bot.py           # [ABANDONED]
├── Domain/                          # [ABANDONED]
├── Infrastructure/                  # [ABANDONED]
├── cli/

├── projections/

├── mcp_servers/

├── data/Binance/                    # Cached OHLCV data
└── Web/                             # (Empty — reserved)


---
*End of SDD Master Report v2.0*