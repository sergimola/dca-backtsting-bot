package orchestrator

import (
	"fmt"
	"log/slog"
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
	psm               position.PositionStateMachine
	eventBus          *EventBus
	config            *OrchestratorConfig
	position          *position.Position
	globalCandleCount int64
	runningBalance    decimal.Decimal
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

// RunBacktest executes a complete backtest by streaming candles from the provided loader.
// Parameters:
//   - loader: CandleLoader supplying candles in ascending timestamp order
// Returns:
//   - *BacktestRun: Completed backtest with all events captured, or nil on error
//   - error: Loading, validation, or PSM error
// T020-T028: Acceptance test entry point
func (orch *Orchestrator) RunBacktest(loader CandleLoader) (*BacktestRun, error) {
	defer loader.Close() //nolint:errcheck

	// Record start time
	startTime := time.Now().UTC()
	candleCount := 0
	eventCount := 0
	var lastPosition *position.Position // tracks the most-recently active position (even after close)

	// Monthly addition tracking: globalCandleCount drives the 43,200-candle (30-day) boundary.
	// runningBalance accumulates the starting balance + monthly injections + realized profits.
	monthlyAdditionNumber := 0
	orch.globalCandleCount = 0
	if orch.config.DomainConfig != nil {
		orch.runningBalance = orch.config.DomainConfig.AccountBalance()
	}

	// Initialize the backtest run
	backtest := &BacktestRun{
		ID:        orch.config.BacktestID,
		StartTime: startTime,
		EventBus:  orch.eventBus,
	}

	// Main processing loop: iterate through all candles
	for {
		// Load next candle
		candle, err := loader.NextCandle()
		if err != nil {
			return nil, fmt.Errorf("candle loader error at candle %d: %w", candleCount+1, err)
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

			// Structured symbol integrity check (slog.Debug — only visible at --log-level DEBUG)
			configPair := ""
			if orch.config.DomainConfig != nil {
				configPair = orch.config.DomainConfig.TradingPair()
			}
			slog.Debug("first candle",
				"symbol", candle.Symbol,
				"config_pair", configPair,
				"close", candle.Close,
			)
			if candle.Symbol != "" && configPair != "" && candle.Symbol != configPair {
				slog.Warn("symbol mismatch — PSM may ignore candle data",
					"candle_symbol", candle.Symbol,
					"config_pair", configPair,
				)
			}
		}

		// 43,200-candle global tick: fires once every 30 days (30 × 24 × 60).
		// Runs before the position-open guard so runningBalance is current when a new
		// position opens on the same candle as a monthly boundary.
		orch.globalCandleCount++
		if orch.config.DomainConfig != nil {
			monthlyAdd := orch.config.DomainConfig.MonthlyAddition()
			if !monthlyAdd.IsZero() && orch.globalCandleCount%43200 == 0 {
				prevBalance := orch.runningBalance
				monthlyAdditionNumber++
				orch.runningBalance = orch.runningBalance.Add(monthlyAdd)
				// Also inject into the currently open position so its running capital is current
				if orch.position != nil {
					orch.position.AccountBalance = orch.position.AccountBalance.Add(monthlyAdd)
				}
				monthlyEvent := &position.MonthlyAdditionEvent{
					RunID:           backtest.ID,
					Timestamp:       candle.Timestamp,
					AdditionAmount:  monthlyAdd.String(),
					PreviousBalance: prevBalance.String(),
					NewBalance:      orch.runningBalance.String(),
					AdditionNumber:  monthlyAdditionNumber,
					DaysSinceStart:  int(orch.globalCandleCount / 1440),
				}
				if orch.position != nil {
					monthlyEvent.TradeID = orch.position.TradeID
				}
				orchEvent := Event{
					Timestamp: candle.Timestamp,
					Type:      EventType("monthly.addition"),
					Data:      monthlyEvent,
					RawEvent:  monthlyEvent,
				}
				if appendErr := orch.eventBus.Append(orchEvent); appendErr != nil {
					slog.Warn("failed to append monthly addition event", "err", appendErr)
				}
				eventCount++
				slog.Debug("monthly addition applied",
					"global_candle", orch.globalCandleCount,
					"addition_number", monthlyAdditionNumber,
					"added", monthlyAdd,
					"new_balance", orch.runningBalance,
				)
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
					slog.Error("ComputePriceSequence failed", "err", priceErr)
				} else {
					slog.Debug("price sequence computed",
						"actual_entry_price", actualEntryPrice,
						"count", len(priceSeq),
					)
				}
				if priceErr == nil && len(priceSeq) > 0 {
					prices = []decimal.Decimal(priceSeq)
					// ComputeAmountSequence returns USDT dollar amounts (D_n) per order.
					// The PSM execution layer (order_fills, minute_loop) divides by price
					// at fill time to obtain base-currency (BTC) quantities.
					usdtAmounts, amountErr := orch.config.DomainConfig.ComputeAmountSequence(orch.runningBalance)
					if amountErr != nil {
						slog.Error("ComputeAmountSequence failed", "err", amountErr)
					} else {
						slog.Debug("amount sequence computed", "count", len(usdtAmounts))
						if len(usdtAmounts) == len(prices) {
							amounts = []decimal.Decimal(usdtAmounts)
						} else {
							slog.Warn("price/amount count mismatch",
								"prices", len(prices),
								"amounts", len(usdtAmounts),
							)
						}
					}
				}
			}

			slog.Debug("opening new position",
				"trade_id", tradeID,
				"close", candle.Close,
				"prices", len(prices),
				"amounts", len(amounts),
			)
			if len(amounts) > 0 && len(prices) > 0 {
				firstBTCQty := amounts[0].Div(prices[0])
				slog.Debug("order-0 sizing",
					"d0", amounts[0],
					"p0", prices[0],
					"btc_qty", firstBTCQty,
				)
			}

			newPos, err := orch.psm.NewPosition(tradeID, candle.Timestamp, prices, amounts)
			if err != nil {
				slog.Error("NewPosition failed — skipping candle", "err", err)
			} else {
				// Set take-profit distance and account balance from domain config.
				// Use runningBalance (which may have grown via monthly additions) if available.
				if orch.config.DomainConfig != nil {
					newPos.TakeProfitDistance = orch.config.DomainConfig.TakeProfitDistancePercent()
					newPos.AccountBalance = orch.runningBalance
					newPos.ExitOnLastOrder = orch.config.DomainConfig.ExitOnLastOrder()
				}
				orch.position = newPos
				lastPosition = orch.position
			}
		}

		// Feed candle to PSM if position exists (T020, T021, T022, T023)
		slog.Debug("process candle",
			"index", candleCount,
			"ts", candle.Timestamp.Format("2006-01-02T15:04:05Z"),
			"close", candle.Close,
			"position_nil", orch.position == nil,
		)
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
				slog.Debug("PSM events emitted", "candle", candleCount, "count", len(psmEvents))
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
					// Log safety order fills (OrderNumber >= 2; the entry is OrderNumber 1)
					if boe, ok := psmEvent.(*position.BuyOrderExecutedEvent); ok && boe.OrderNumber >= 2 {
						slog.Debug("safety order triggered",
							"candle_ts", candle.Timestamp.Format("2006-01-02T15:04:05Z"),
							"price", boe.Price,
							"order_number", boe.OrderNumber,
						)
					}
				}
			}

			// If the position was closed this candle, notify the progress hook and reset.
			if orch.position.State == position.StateClosed {
				// Find TradeClosedEvent to enrich the debug log and notify the progress ticker.
				var closingPrice, closedProfit string
				for _, psmEv := range psmEvents {
					if tce, ok := psmEv.(*position.TradeClosedEvent); ok {
						closingPrice = tce.ClosingPrice
						closedProfit = tce.Profit
						if orch.config.OnPositionClosed != nil {
							orch.config.OnPositionClosed(tce.Profit)
						}
						// Carry realized profit (or loss) into the running balance
						if profitDec, parseErr := decimal.NewFromString(closedProfit); parseErr == nil {
							orch.runningBalance = orch.runningBalance.Add(profitDec)
						} else {
							slog.Warn("failed to parse profit for running balance update",
								"profit", closedProfit,
								"err", parseErr,
							)
						}
						break
					}
				}
				slog.Debug("position closed — will re-enter next candle",
					"candle", candleCount,
					"closing_price", closingPrice,
					"profit", closedProfit,
				)
				orch.position = nil
			}
		}

		// Notify progress hook (used by cmd/engine progress ticker).
		if orch.config.OnCandleProcessed != nil {
			orch.config.OnCandleProcessed(candleCount, candle.Timestamp, candle.Close)
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
