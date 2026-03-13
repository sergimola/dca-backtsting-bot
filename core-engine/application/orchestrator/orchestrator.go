package orchestrator

import (
	"fmt"
	"io"
	"os"
	"time"

	"dca-bot/core-engine/domain/position"

	"github.com/shopspring/decimal"
)

// marketTolerance is the fixed slippage applied to market-buy execution prices (0.05%).
// When a new position opens, the actual P_0 = candle.Close × (1 + marketTolerance)
// so that safety-order prices (P_1 … P_N) are anchored to the true fill price.
var marketTolerance = decimal.NewFromFloat(0.0005)

// Orchestrator coordinates CSV data loading, PSM position processing, and event capture
type Orchestrator struct {
	psm       position.PositionStateMachine
	eventBus  *EventBus
	config    *OrchestratorConfig
	position  *position.Position
}

// NewOrchestrator creates a new orchestrator instance
// Parameters:
//   - psm: Position State Machine for candle processing
//   - config: Orchestrator configuration
// Returns: Initialized Orchestrator or error
func NewOrchestrator(psm position.PositionStateMachine, config *OrchestratorConfig) (*Orchestrator, error) {
	if psm == nil {
		return nil, fmt.Errorf("PSM cannot be nil")
	}
	if config == nil {
		return nil, fmt.Errorf("config cannot be nil")
	}

	// Pre-allocate EventBus based on estimated candle count
	// Each candle can generate multiple events, estimate ~5 events per candle
	estimatedEventCount := config.EstimatedCandleCount * 5
	if estimatedEventCount == 0 {
		estimatedEventCount = 1000 // Default baseline
	}

	eventBusPtr := NewEventBus(estimatedEventCount)

	orchestrator := &Orchestrator{
		psm:      psm,
		eventBus: eventBusPtr,
		config:   config,
	}

	return orchestrator, nil
}

// RunBacktest executes a complete backtest from CSV data
// Parameters:
//   - csvReader: io.Reader with CSV data (symbol,timestamp,open,high,low,close,volume)
// Returns:
//   - *BacktestRun: Completed backtest with all events captured, or nil on error
//   - error: Parsing, validation, or PSM error
// T020-T028: Acceptance test entry point
func (orch *Orchestrator) RunBacktest(csvReader io.Reader) (*BacktestRun, error) {
	// Initialize CSV loader
	csvLoader := NewCSVLoader(csvReader)
	if err := csvLoader.ValidateHeader(); err != nil {
		return nil, fmt.Errorf("CSV header validation failed: %w", err)
	}

	// Record start time
	startTime := time.Now().UTC()
	candleCount := 0
	eventCount := 0
	var lastPosition *position.Position // tracks the most-recently active position (even after close)

	// Initialize the backtest run
	backtest := &BacktestRun{
		ID:        orch.config.BacktestID,
		StartTime: startTime,
		EventBus:  orch.eventBus,
	}

	// Main processing loop: iterate through all candles
	for {
		// Load next candle from CSV (streaming)
		candle, err := csvLoader.NextCandle()
		if err != nil {
			return nil, fmt.Errorf("CSV parsing failed at row %d: %w", candleCount+2, err)
		}

		// EOF reached - processing complete
		if candle == nil {
			break
		}

		// Capture symbol from first candle
		if candleCount == 0 {
			if candle.Symbol != "" {
				backtest.Symbol = candle.Symbol
			}

			// [ENGINE-DEBUG] Symbol integrity check
			configPair := ""
			if orch.config.DomainConfig != nil {
				configPair = orch.config.DomainConfig.TradingPair()
			}
			fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] First candle: Symbol=%q TradingPair(config)=%q candle.Close=%s\n",
				candle.Symbol, configPair, candle.Close)
			if candle.Symbol != "" && configPair != "" && candle.Symbol != configPair {
				fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] WARNING: candle.Symbol %q does not match config TradingPair %q — PSM may ignore candle data\n",
					candle.Symbol, configPair)
			}
		}

		// Open a new position whenever the position slot is empty (first candle or after close)
		if orch.position == nil {
			tradeID := fmt.Sprintf("%s-%d", backtest.ID, time.Now().UnixNano())

			// Apply market-buy slippage: P_0 = candle.Close × (1 + marketTolerance)
			actualEntryPrice := candle.Close.Mul(decimal.NewFromInt(1).Add(marketTolerance))

			var prices []decimal.Decimal
			var amounts []decimal.Decimal
			if orch.config.DomainConfig != nil {
				priceSeq, priceErr := orch.config.DomainConfig.ComputePriceSequence(actualEntryPrice)
				if priceErr != nil {
					fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] ComputePriceSequence error: %v\n", priceErr)
				} else {
					fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] ComputePriceSequence OK: actualEntryPrice=%s resultCount=%d prices=%v\n",
						actualEntryPrice, len(priceSeq), priceSeq)
				}
				if priceErr == nil && len(priceSeq) > 0 {
					prices = []decimal.Decimal(priceSeq)
					// ComputeAmountSequence returns USDT dollar amounts (D_n) per order.
					// The PSM execution layer (order_fills, minute_loop) divides by price
					// at fill time to obtain base-currency (BTC) quantities.
					usdtAmounts, amountErr := orch.config.DomainConfig.ComputeAmountSequence()
					if amountErr != nil {
						fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] ComputeAmountSequence error: %v\n", amountErr)
					} else {
						fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] ComputeAmountSequence OK: count=%d usdtAmounts=%v\n", len(usdtAmounts), usdtAmounts)
						if len(usdtAmounts) == len(prices) {
							amounts = []decimal.Decimal(usdtAmounts)
						} else {
							fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] WARNING: prices count (%d) != amounts count (%d)\n",
								len(prices), len(usdtAmounts))
						}
					}
				}
			}

			fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] Opening new position: tradeID=%q candle.Close=%s prices=%d amounts=%d\n",
				tradeID, candle.Close, len(prices), len(amounts))
			if len(amounts) > 0 && len(prices) > 0 {
				firstBTCQty := amounts[0].Div(prices[0])
				fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] Order-0: D_0=%s USDT / P_0=%s → BTC Qty=%s\n",
					amounts[0], prices[0], firstBTCQty)
			}

			newPos, err := orch.psm.NewPosition(tradeID, candle.Timestamp, prices, amounts)
			if err != nil {
				fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] ERROR: NewPosition failed: %v — skipping candle\n", err)
			} else {
				// Set take-profit distance and account balance from domain config
				if orch.config.DomainConfig != nil {
					newPos.TakeProfitDistance = orch.config.DomainConfig.TakeProfitDistancePercent()
					newPos.AccountBalance = orch.config.DomainConfig.AccountBalance()
					newPos.ExitOnLastOrder = orch.config.DomainConfig.ExitOnLastOrder()
				}
				orch.position = newPos
				lastPosition = orch.position
			}
		}

		// Feed candle to PSM if position exists (T020, T021, T022, T023)
		fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] ProcessCandle candle#%d: ts=%s close=%s positionNil=%v\n",
			candleCount, candle.Timestamp.Format("2006-01-02T15:04:05Z"), candle.Close, orch.position == nil)
		if orch.position != nil {
			// Convert Orchestrator Candle to PSM Candle (compatible structure)
			psmCandle := &position.Candle{
				Timestamp: candle.Timestamp,
				Open:      candle.Open,
				High:      candle.High,
				Low:       candle.Low,
				Close:     candle.Close,
				Volume:    candle.Volume,
			}

			// Process candle through PSM
			psmEvents, err := orch.psm.ProcessCandle(orch.position, psmCandle)
			if err != nil {
				// Log error but continue processing if possible
				_ = err // Ignore for now - backtest continues
			}

			// Wrap PSM events into Orchestrator Event structs (T022: Full fidelity)
			if len(psmEvents) > 0 {
				fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] candle#%d produced %d PSM event(s)\n", candleCount, len(psmEvents))
				for _, psmEvent := range psmEvents {
					orchEvent := Event{
						Timestamp: psmEvent.EventTimestamp(),
						Type:      mapPSMEventToType(psmEvent),
						Data:      psmEvent,
						RawEvent:  psmEvent,
					}

					err := orch.eventBus.Append(orchEvent)
					if err != nil {
						return nil, fmt.Errorf("failed to append event to bus: %w", err)
					}

					eventCount++
				}
			}

			// If the position was closed this candle, reset so the next candle opens a new trade
			if orch.position.State == position.StateClosed {
				fmt.Fprintf(os.Stderr, "[ENGINE-DEBUG] Position closed at candle#%d — resetting for re-entry next candle\n", candleCount)
				orch.position = nil
			}
		}

		candleCount++
	}

	// Record end time (T024)
	endTime := time.Now().UTC()

	// Populate final backtest results
	backtest.CandleCount = candleCount
	backtest.EventCount = eventCount
	backtest.EndTime = endTime
	backtest.EventBus = orch.eventBus
	// FinalPosition: prefer the live open position; fall back to the last closed one
	if orch.position != nil {
		backtest.FinalPosition = orch.position
	} else {
		backtest.FinalPosition = lastPosition
	}

	return backtest, nil
}

// mapPSMEventToType converts PSM event type string to Orchestrator EventType
// Maps domain event types to orchestrator event types (T022: Event fidelity)
func mapPSMEventToType(psmEvent position.Event) EventType {
	if psmEvent == nil {
		return EventType("")
	}

	eventTypeName := psmEvent.EventType()

	// Map PSM event types to orchestrator event types
	switch eventTypeName {
	case "trade.opened":
		return EventTypePositionOpened
	case "order.buy.executed":
		return EventTypeBuyOrderExecuted
	case "liquidation.price.updated":
		return EventType("LiquidationPriceUpdated") // Custom type
	case "trade.closed":
		return EventTypePositionClosed
	case "order.sell.executed":
		return EventType("SellOrderExecuted") // Custom type
	default:
		return EventType(eventTypeName)
	}
}
