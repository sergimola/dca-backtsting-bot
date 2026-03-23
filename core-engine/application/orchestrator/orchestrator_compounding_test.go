package orchestrator

import (
	"testing"
	"time"

	domainconfig "dca-bot/core-engine/domain/config"
	"dca-bot/core-engine/domain/position"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

// capturingPSM is a test-only PositionStateMachine that:
//  1. Records the amounts slice passed to each NewPosition call.
//  2. Fires a TradeClosedEvent with a known profit on the specified call index.
type capturingPSM struct {
	capturedAmounts [][]decimal.Decimal
	processCallIdx  int
	closeOnIdx      int    // 0-based ProcessCandle call index that fires TradeClosedEvent
	closeProfit     string // profit string injected into TradeClosedEvent
}

func (m *capturingPSM) NewPosition(tradeID string, ts time.Time, prices, amounts []decimal.Decimal) (*position.Position, error) {
	amountsCopy := make([]decimal.Decimal, len(amounts))
	copy(amountsCopy, amounts)
	m.capturedAmounts = append(m.capturedAmounts, amountsCopy)
	return position.NewPosition(tradeID, ts, prices, amounts), nil
}

func (m *capturingPSM) ProcessCandle(pos *position.Position, candle *position.Candle) ([]position.Event, error) {
	idx := m.processCallIdx
	m.processCallIdx++
	if idx == m.closeOnIdx {
		pos.State = position.StateClosed
		return []position.Event{
			&position.TradeClosedEvent{
				RunID:        pos.TradeID,
				TradeID:      pos.TradeID,
				Timestamp:    candle.Timestamp,
				ClosingPrice: candle.Close.String(),
				Profit:       m.closeProfit,
			},
		}, nil
	}
	return nil, nil
}

// TestTS013_OrchestratorCompoundingIntegration — T018 — verifies end-to-end that the
// Orchestrator passes its live runningBalance to ComputeAmountSequence when opening a
// new position, so that a compounded account balance is reflected in the amounts grid.
//
// Setup:
//
//	initialBalance = 1000, amountPerTrade = 1.0 (100% of balance), N = 1, multiplier = 1
//
// Sequence:
//
//	Candle 1: orch.position == nil → Trade 1 opens; amounts must sum to 1000
//	          capturingPSM fires Profit="4000" → runningBalance: 1000 → 5000
//	Candle 2: orch.position == nil → Trade 2 opens; amounts must sum to 5000
func TestTS013_OrchestratorCompoundingIntegration(t *testing.T) {
	// Arrange: domain config with percentage-mode amountPerTrade, N=1
	domCfg, err := domainconfig.NewConfig(
		domainconfig.WithAccountBalance(decimal.NewFromInt(1000)),
		domainconfig.WithAmountPerTrade(decimal.NewFromInt(1)), // 1.0 = 100% of balance
		domainconfig.WithNumberOfOrders(1),
		domainconfig.WithMultiplier(decimal.NewFromInt(1)),
	)
	require.NoError(t, err, "NewConfig should succeed")

	psm := &capturingPSM{
		closeOnIdx:  0,      // close Trade 1 on the first ProcessCandle call (candle 1)
		closeProfit: "4000", // after close: runningBalance = 1000 + 4000 = 5000
	}

	orch, err := NewOrchestrator(psm, &OrchestratorConfig{
		BacktestID:   "t018-compounding",
		DomainConfig: domCfg,
	})
	require.NoError(t, err)

	// Two candles: candle 1 opens + immediately closes Trade 1 (via mock);
	// candle 2 opens Trade 2 with the updated runningBalance.
	csvData := `symbol,timestamp,open,high,low,close,volume
BTCUSDC,2024-01-01T00:00:00Z,50000,50000,50000,50000,1.0
BTCUSDC,2024-01-01T00:01:00Z,50000,50000,50000,50000,1.0`

	_, runErr := orch.RunBacktest(CandlesFromCSVString(t, csvData))
	require.NoError(t, runErr)

	// Assert: exactly two NewPosition calls (one per trade)
	require.Len(t, psm.capturedAmounts, 2, "expected two NewPosition calls")

	// Trade 1: amounts must sum to 1000 (V = 1000 × 1.0 × 1 = 1000)
	sum1 := decimal.Zero
	for _, a := range psm.capturedAmounts[0] {
		sum1 = sum1.Add(a)
	}
	require.True(t, sum1.Equal(decimal.NewFromInt(1000)),
		"Trade 1 amounts sum: expected 1000, got %s", sum1)

	// Trade 2: amounts must sum to 5000 (V = (1000+4000) × 1.0 × 1 = 5000)
	sum2 := decimal.Zero
	for _, a := range psm.capturedAmounts[1] {
		sum2 = sum2.Add(a)
	}
	require.True(t, sum2.Equal(decimal.NewFromInt(5000)),
		"Trade 2 amounts sum: expected 5000, got %s", sum2)
}
