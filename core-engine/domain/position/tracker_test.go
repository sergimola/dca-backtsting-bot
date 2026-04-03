package position

import "testing"

func TestKpiTracker(t *testing.T) {
	tests := []struct {
		name                    string
		positions               []struct{ openMs, closeMs int64; soFilled int }
		backendEnd              *struct{ openMs, lastCandleMs int64; soFilled int }
		wantLongestDurationMs   int64
		wantMaxSafetyOrders     int
	}{
		{
			name: "three positions — max duration is the largest",
			positions: []struct{ openMs, closeMs int64; soFilled int }{
				{openMs: 0, closeMs: 3_600_000, soFilled: 1},
				{openMs: 4_000_000, closeMs: 11_200_000, soFilled: 2},
				{openMs: 12_000_000, closeMs: 13_800_000, soFilled: 0},
			},
			wantLongestDurationMs: 7_200_000,
			wantMaxSafetyOrders:   2,
		},
		{
			name: "safety order depth max across positions",
			positions: []struct{ openMs, closeMs int64; soFilled int }{
				{openMs: 0, closeMs: 1_000_000, soFilled: 3},
				{openMs: 2_000_000, closeMs: 3_000_000, soFilled: 2},
			},
			wantLongestDurationMs: 1_000_000,
			wantMaxSafetyOrders:   3,
		},
		{
			name: "open-at-end uses OnBacktestEnd",
			positions: []struct{ openMs, closeMs int64; soFilled int }{
				{openMs: 0, closeMs: 500_000, soFilled: 1},
			},
			backendEnd:            &struct{ openMs, lastCandleMs int64; soFilled int }{openMs: 600_000, lastCandleMs: 5_000_000, soFilled: 4},
			wantLongestDurationMs: 4_400_000,
			wantMaxSafetyOrders:   4,
		},
		{
			name: "zero safety orders triggered",
			positions: []struct{ openMs, closeMs int64; soFilled int }{
				{openMs: 0, closeMs: 1_000_000, soFilled: 0},
				{openMs: 2_000_000, closeMs: 4_000_000, soFilled: 0},
			},
			wantLongestDurationMs: 2_000_000,
			wantMaxSafetyOrders:   0,
		},
		{
			name:                  "no positions opened — both KPIs zero",
			positions:             nil,
			wantLongestDurationMs: 0,
			wantMaxSafetyOrders:   0,
		},
		{
			name: "single position with safety order depth 2",
			positions: []struct{ openMs, closeMs int64; soFilled int }{
				{openMs: 1_000_000, closeMs: 4_600_000, soFilled: 2},
			},
			wantLongestDurationMs: 3_600_000,
			wantMaxSafetyOrders:   2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var k KpiTracker
			for _, p := range tt.positions {
				k.OnPositionClose(p.openMs, p.closeMs, p.soFilled)
			}
			if tt.backendEnd != nil {
				k.OnBacktestEnd(tt.backendEnd.openMs, tt.backendEnd.lastCandleMs, tt.backendEnd.soFilled)
			}
			if k.LongestTradeDurationMs != tt.wantLongestDurationMs {
				t.Errorf("LongestTradeDurationMs = %d, want %d", k.LongestTradeDurationMs, tt.wantLongestDurationMs)
			}
			if k.MaxSafetyOrdersUsed != tt.wantMaxSafetyOrders {
				t.Errorf("MaxSafetyOrdersUsed = %d, want %d", k.MaxSafetyOrdersUsed, tt.wantMaxSafetyOrders)
			}
		})
	}
}
