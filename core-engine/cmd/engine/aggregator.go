package main

import (
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"time"

	"dca-bot/core-engine/application/orchestrator"
	"dca-bot/core-engine/domain/position"

	"github.com/shopspring/decimal"
)

// aggregationResult is the intermediate output of aggregateBacktestEvents.
// It is consumed by main() to build the final EngineResultPayload.
type aggregationResult struct {
	PnlSummary        PnlSummaryOutput
	SafetyOrderCounts map[int]int
	StopLossCount     int
	TakeProfitCount   int
}

// decStr parses a decimal string, returning decimal.Zero on any error.
// Mirrors the TypeScript pattern: parseFloat(d.field ?? '0').
func decStr(s string) decimal.Decimal {
	d, err := decimal.NewFromString(s)
	if err != nil {
		return decimal.Zero
	}
	return d
}

// aggregateBacktestEvents ports ResultAggregator.aggregateGoEvents() to Go.
//
// Walks the event stream once, accumulating:
//   - entryFees from PositionOpened.entry_fee
//   - tradingFees from BuyOrderExecuted.fee + SellOrderExecuted.fee
//   - realizedPnl from PositionClosed.profit (accumulated across multiple trades)
//   - totalAdditions from monthly.addition events (FR-019)
//   - maxDrawdown via peak-equity tracking after each PositionClosed
//   - safetyOrderCounts keyed by 0-based soIndex (orderNumber - 1)
//
// ROI denominator = accountBalance + totalAdditions (FR-020).
// If finalPos is non-nil and still open, the unrealized P&L of the open
// position is folded into the ROI numerator so that:
//   ROI = (realizedPnl + unrealizedPnl) / totalInvested × 100
// All arithmetic is performed with decimal.Decimal.
// float64 conversion is done only when constructing PnlSummaryOutput fields.
func aggregateBacktestEvents(events []orchestrator.Event, accountBalance decimal.Decimal, finalPos *position.Position, lastClose decimal.Decimal) aggregationResult {
	var (
		entryFees      decimal.Decimal
		tradingFees    decimal.Decimal
		realizedPnl    decimal.Decimal
		totalAdditions decimal.Decimal
		peakEquity     decimal.Decimal
		maxDrawdown    decimal.Decimal
		stopLossCount  int
		takeProfitCount int
	)
	safetyOrderCounts := make(map[int]int)

	for _, ev := range events {
		switch ev.Type {
		case orchestrator.EventTypePositionOpened:
			if toe, ok := ev.Data.(*position.TradeOpenedEvent); ok {
				entryFees = entryFees.Add(decStr(toe.EntryFee))
			}

		case orchestrator.EventTypeBuyOrderExecuted:
			if boe, ok := ev.Data.(*position.BuyOrderExecutedEvent); ok {
				tradingFees = tradingFees.Add(decStr(boe.Fee))
				soIndex := boe.OrderNumber - 1
				safetyOrderCounts[soIndex]++
			}

		case orchestrator.EventType("SellOrderExecuted"):
			if soe, ok := ev.Data.(*position.SellOrderExecutedEvent); ok {
				tradingFees = tradingFees.Add(decStr(soe.Fee))
			}

		case orchestrator.EventTypePositionClosed:
			if tce, ok := ev.Data.(*position.TradeClosedEvent); ok {
				realizedPnl = realizedPnl.Add(decStr(tce.Profit))

				// 019-engine-stop-loss: track close reasons for win rate
				switch tce.Reason {
				case "stop_loss":
					stopLossCount++
				case "take_profit":
					takeProfitCount++
				}

				// Peak-equity drawdown tracking.
				runningEquity := accountBalance.Add(realizedPnl)
				if runningEquity.GreaterThan(peakEquity) {
					peakEquity = runningEquity
				}
				if peakEquity.IsPositive() {
					drawdown := peakEquity.Sub(runningEquity).
						Div(peakEquity).
						Mul(decimal.NewFromInt(100))
					if drawdown.GreaterThan(maxDrawdown) {
						maxDrawdown = drawdown
					}
				}
			}

		case orchestrator.EventType("monthly.addition"):
			// FR-019: accumulate capital injections into totalAdditions.
			// These are excluded from fees/PnL but widen the ROI denominator (FR-020).
			mae, ok := ev.Data.(*position.MonthlyAdditionEvent)
			if !ok {
				slog.Warn("aggregateBacktestEvents: unexpected monthly.addition data type", "type", fmt.Sprintf("%T", ev.Data))
				continue
			}
			totalAdditions = totalAdditions.Add(decStr(mae.AdditionAmount))
		}
	}

	totalFees := entryFees.Add(tradingFees)

	// Compute unrealized PnL from the final open position (if any).
	// unrealizedPnl = positionQuantity × lastClose − totalDeployedCost − feesAccumulated
	// This gives the mark-to-market value delta of the open position.
	unrealizedPnl := decimal.Zero
	if finalPos != nil && finalPos.State != position.StateClosed && finalPos.PositionQuantity.IsPositive() && lastClose.IsPositive() {
		marketValue := finalPos.PositionQuantity.Mul(lastClose)
		deployedCost := decimal.Zero
		for _, o := range finalPos.Orders {
			deployedCost = deployedCost.Add(o.QuoteAmount)
		}
		unrealizedPnl = marketValue.Sub(deployedCost).Sub(finalPos.FeesAccumulated)
	}

	// ROI = (realizedPnl + unrealizedPnl) / (accountBalance + totalAdditions) × 100 (FR-020)
	roiDenominator := accountBalance.Add(totalAdditions)
	roi := decimal.Zero
	if roiDenominator.IsPositive() {
		roi = realizedPnl.Add(unrealizedPnl).Div(roiDenominator).Mul(decimal.NewFromInt(100))
	}

	// 019-engine-stop-loss FR-014: Win Rate = TPs / (TPs + SLs), decimal-computed
	winRate := decimal.Zero
	totalClosedBySLOrTP := takeProfitCount + stopLossCount
	if totalClosedBySLOrTP > 0 {
		winRate = decimal.NewFromInt(int64(takeProfitCount)).
			Div(decimal.NewFromInt(int64(totalClosedBySLOrTP))).
			Round(8)
	}

	return aggregationResult{
		PnlSummary: PnlSummaryOutput{
			Roi:         roi.InexactFloat64(),
			MaxDrawdown: maxDrawdown.InexactFloat64(),
			TotalFees:   totalFees.InexactFloat64(),
			WinRate:     winRate.InexactFloat64(),
		},
		SafetyOrderCounts: safetyOrderCounts,
		StopLossCount:     stopLossCount,
		TakeProfitCount:   takeProfitCount,
	}
}

// buildTradeEvents ports processGoEventsForFrontend() from BackgroundWorker.ts to Go.
//
// Rules (mirror the TypeScript logic exactly):
//   - tradeCounter increments on every PositionOpened; currentTradeID = string(counter)
//   - PositionOpened    → ENTRY event (uses configured_orders[0] for price/qty/balance)
//   - BuyOrderExecuted  → SAFETY_ORDER event
//   - PositionClosed    → EXIT event with Fee=0 initially; stored as lastExitIdx
//   - SellOrderExecuted → patches the last EXIT event Fee; never emitted as its own event
//   - monthly.addition  → DEPOSIT event (FR-021): balance=addition_amount, price/qty/fee=0
func buildTradeEvents(events []orchestrator.Event) []TradeEventOutput {
	result := make([]TradeEventOutput, 0, len(events)/2)
	tradeCounter := 0
	currentTradeID := "0"
	lastExitIdx := -1 // index into result for SellOrderExecuted fee-patching

	for _, ev := range events {
		switch ev.Type {
		case orchestrator.EventTypePositionOpened:
			toe, ok := ev.Data.(*position.TradeOpenedEvent)
			if !ok {
				continue
			}
			tradeCounter++
			currentTradeID = strconv.Itoa(tradeCounter)
			lastExitIdx = -1

			var price, cost decimal.Decimal
			if len(toe.ConfiguredOrders) > 0 {
				entry := toe.ConfiguredOrders[0]
				price = decStr(entry.Price)
				cost = decStr(entry.Amount)
			}
			qty := decimal.Zero
			if price.IsPositive() {
				qty = cost.Div(price)
			}
			result = append(result, TradeEventOutput{
				Timestamp:    formatUTCTimestamp(ev.Timestamp),
				RawTimestamp: ev.Timestamp.UTC().Format(time.RFC3339),
				EventType:    "ENTRY",
				Price:        price.InexactFloat64(),
				Quantity:     qty.InexactFloat64(),
				Balance:      cost.InexactFloat64(),
				TradeID:      currentTradeID,
				Fee:          decStr(toe.EntryFee).InexactFloat64(),
			})

		case orchestrator.EventTypeBuyOrderExecuted:
			boe, ok := ev.Data.(*position.BuyOrderExecutedEvent)
			if !ok {
				continue
			}
			lastExitIdx = -1
			price := decStr(boe.Price)
			qty := decStr(boe.BaseSize)
			result = append(result, TradeEventOutput{
				Timestamp:    formatUTCTimestamp(ev.Timestamp),
				RawTimestamp: ev.Timestamp.UTC().Format(time.RFC3339),
				EventType:    "SAFETY_ORDER",
				Price:        price.InexactFloat64(),
				Quantity:     qty.InexactFloat64(),
				Balance:      price.Mul(qty).InexactFloat64(),
				TradeID:      currentTradeID,
				Fee:          decStr(boe.Fee).InexactFloat64(),
			})

		case orchestrator.EventTypePositionClosed:
			tce, ok := ev.Data.(*position.TradeClosedEvent)
			if !ok {
				continue
			}
			result = append(result, TradeEventOutput{
				Timestamp:    formatUTCTimestamp(ev.Timestamp),
				RawTimestamp: ev.Timestamp.UTC().Format(time.RFC3339),
				EventType:    "EXIT",
				Price:        decStr(tce.ClosingPrice).InexactFloat64(),
				Quantity:     decStr(tce.Size).InexactFloat64(),
				Balance:      decStr(tce.Profit).InexactFloat64(),
				TradeID:      currentTradeID,
				Fee:          0, // patched by the immediately following SellOrderExecuted
			})
			lastExitIdx = len(result) - 1

		case orchestrator.EventType("SellOrderExecuted"):
			// Patch the fee of the preceding EXIT event.
			// This event is never emitted as its own trade event entry.
			if lastExitIdx >= 0 {
				if soe, ok := ev.Data.(*position.SellOrderExecutedEvent); ok {
					result[lastExitIdx].Fee = decStr(soe.Fee).InexactFloat64()
				}
				lastExitIdx = -1
			}

		case orchestrator.EventType("monthly.addition"):
			// FR-021: emit a DEPOSIT row so the frontend ledger shows capital injections.
			// Price, Quantity, and Fee are zero — Balance carries the injection amount.
			mae, ok := ev.Data.(*position.MonthlyAdditionEvent)
			if !ok {
				slog.Warn("buildTradeEvents: unexpected monthly.addition data type", "type", fmt.Sprintf("%T", ev.Data))
				continue
			}
			result = append(result, TradeEventOutput{
				Timestamp:    formatUTCTimestamp(ev.Timestamp),
				RawTimestamp: ev.Timestamp.UTC().Format(time.RFC3339),
				EventType:    "DEPOSIT",
				Price:        0,
				Quantity:     0,
				Balance:      decStr(mae.AdditionAmount).InexactFloat64(),
				TradeID:      "deposit",
				Fee:          0,
			})
		}
	}

	return result
}

// buildSafetyOrderUsage converts a 0-indexed count map to a sorted []SafetyOrderUsageEntry.
// Keys are soIndex = orderNumber - 1; output level strings are 1-indexed ("1", "2", ...).
func buildSafetyOrderUsage(counts map[int]int) []SafetyOrderUsageEntry {
	keys := make([]int, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Ints(keys)

	entries := make([]SafetyOrderUsageEntry, 0, len(keys))
	for _, k := range keys {
		entries = append(entries, SafetyOrderUsageEntry{
			Level: strconv.Itoa(k + 1),
			Count: counts[k],
		})
	}
	return entries
}

// formatUTCTimestamp formats a UTC time as a locale-style display string.
// Uses UTC so the UI display matches the UTC timestamps stored in ClickHouse.
func formatUTCTimestamp(t time.Time) string {
	return t.UTC().Format("1/2/2006, 3:04:05 PM")
}
