// Package position implements the Position State Machine (PSM)
// for backtesting DCA trading strategies with strict pessimistic execution.
//
// The PSM processes 1-minute OHLCV candles and manages position lifecycle:
// IDLE → OPENING → SAFETY_ORDER_WAIT → CLOSED
//
// All monetary calculations use shopspring/decimal with ROUND_HALF_UP mode
// for exact parity with the Python canonical bot.
package position
