// Package position implements the Position State Machine (PSM) for single-position backtesting.
//
// The Position State Machine governs the lifecycle of a single active trading position during backtesting,
// enforcing the single-position-at-a-time invariant and implementing the Pessimistic Execution "Minute Loop"
// Protocol as defined in the SDD Master Report (Sections 3.1–3.2).
//
// # Core Concepts
//
//   - **State Machine**: Position transitions through states (Idle → Opening → SafetyOrderWait → Closed)
//   - **Minute Loop Protocol**: Processes exactly one 1-minute OHLC candle per iteration in pessimistic order:
//     1. Buy Orders (Process triggered limit orders)
//     2. Liquidation Check (Verify position is not liquidated)
//     3. Take Profit Check (Close position if target reached)
//     4. Re-entry (Allow new position on next candle after closure)
//   - **Gap-Down Paradox**: When price gaps down past multiple order levels, fills are pessimistic (orders
//     filled at their pre-calculated limits, not at the gap-down price)
//   - **Pessimistic Execution**: All order fills assume worst-case pricing
//   - **Decimal Arithmetic**: All prices and amounts use shopspring/decimal for fixed-point precision
//
// # Usage
//
//	sm := NewStateMachine()
//	pos := NewPosition(tradeID, startTime, prices, amounts)
//	pos.AccountBalance = mustDecimal("1000.00")
//
//	for candle := range candleStream {
//		events, err := sm.ProcessCandle(pos, candle)
//		if err != nil {
//			log.Fatal(err)
//		}
//		for _, evt := range events {
//			// Handle event (audit, decision-making, etc.)
//		}
//		if pos.State == StateClosed {
//			// Position closed, ready for re-entry on next candle
//		}
//	}
//
// # State Diagram
//
//	StateIdle
//	   ↓ (first candle: market buy)
//	StateOpening
//	   ├─ (orders filled) → StateSafetyOrderWait
//	   │  ├─ (take-profit reached) → StateClosed
//	   │  ├─ (liquidation triggered) → StateClosed
//	   │  └─ (early exit: all orders filled) → StateClosed [US6]
//	   └─ (gap-down liquidation) → StateClosed
//
// # Events
//
// The state machine emits events for audit and tracking:
//   - TradeOpenedEvent: New position created
//   - BuyOrderExecutedEvent: Buy order filled (safety order)
//   - LiquidationPriceUpdatedEvent: Liquidation price recalculated
//   - TradeClosedEvent: Position closed (reason: take_profit, liquidation, or last_order_filled)
//   - SellOrderExecutedEvent: Position closed via take-profit
//   - PriceChangedEvent: Candle processed
//   - MonthlyAdditionEvent: Capital injection on 30-day cycle
//
// # Key Invariants
//
//   - Single Position: Never two concurrent positions
//   - Order Monotonicity: All prices are strictly decreasing
//   - Quantity Non-Negative: All quantities remain ≥ 0
//   - Liquidation Final: Position closed on liquidation never reopens
//   - Fee Accumulation: Fees only increase or stay same (never decrease)
//   - Average Price Consistency: Average entry price is weighted average of all fills
//
// # Performance
//
// ProcessCandle() must complete in < 1ms per call on typical 10–20 order positions.
// Stress tests verify behavior with 10,000+ candles and 50+ concurrent position simulations.
//
// # Files
//
//   - position.go: Core Position struct and state definitions
//   - minute_loop.go: ProcessCandle() state machine implementation
//   - events.go: Event types and dispatch
//   - errors.go: Error types for invariant violations
//
// # References
//
//   - SDD Master Report Sections 3.1–3.2: Minute Loop Protocol and Pessimistic Execution
//   - SDD Master Report Sections 4.2–4.3: State Machine Architecture
//   - spec.md: Feature specification with acceptance scenarios
package position
