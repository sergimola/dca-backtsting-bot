package orchestrator

import (
	"context"
	"fmt"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/shopspring/decimal"
)

// ClickHouseCandleLoader streams 1-minute OHLCV candles directly from ClickHouse
// over a native TCP connection.  It satisfies the CandleLoader interface and returns
// candles one-by-one so the orchestrator loop never holds the full dataset in memory.
//
// Constitution requirements:
//   - Go engine connects to CH directly (no Node relay)
//   - Query uses FINAL for accurate deduplication
//   - ORDER BY timestamp ASC ensures monotone delivery to the PSM
type ClickHouseCandleLoader struct {
	conn   driver.Conn
	rows   driver.Rows
	ctx    context.Context
	cancel context.CancelFunc
	// Fields for the pre-flight COUNT query used by Count().
	symbol string
	start  time.Time
	end    time.Time
}

// NewClickHouseCandleLoader opens a native TCP connection to ClickHouse and
// executes the candle-range query.  The caller owns the returned loader and
// MUST call Close() when done.
//
//   - cfg.Addr must be "host:9000" (native TCP port, NOT the HTTP port 8123)
//   - symbol: uppercase without slash, e.g. "BTCUSDT"
//   - startDate/endDate: RFC 3339 strings, e.g. "2025-01-01T00:00:00Z"
func NewClickHouseCandleLoader(
	cfg ClickHouseConfig,
	symbol string,
	startDate string,
	endDate string,
) (*ClickHouseCandleLoader, error) {
	start, err := time.Parse(time.RFC3339, startDate)
	if err != nil {
		return nil, fmt.Errorf("invalid start_date %q: %w", startDate, err)
	}
	end, err := time.Parse(time.RFC3339, endDate)
	if err != nil {
		return nil, fmt.Errorf("invalid end_date %q: %w", endDate, err)
	}

	conn, err := clickhouse.Open(&clickhouse.Options{
		Addr: []string{cfg.Addr},
		Auth: clickhouse.Auth{
			Database: cfg.Database,
			Username: cfg.User,
			Password: cfg.Password,
		},
		// BlockBufferSize controls how many blocks are buffered client-side.
		// 10 blocks ≈ low memory, good streaming throughput for 1-min candles.
		BlockBufferSize: 10,
	})
	if err != nil {
		return nil, fmt.Errorf("clickhouse.Open: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	rows, err := conn.Query(ctx,
		`SELECT symbol, timestamp, open, high, low, close, volume
		   FROM market_data FINAL
		  WHERE symbol    = ?
		    AND timestamp >= ?
		    AND timestamp <= ?
		  ORDER BY timestamp ASC`,
		symbol, start, end,
	)
	if err != nil {
		cancel()
		conn.Close() //nolint:errcheck
		return nil, fmt.Errorf("clickhouse query: %w", err)
	}

	return &ClickHouseCandleLoader{
		conn:   conn,
		rows:   rows,
		ctx:    ctx,
		cancel: cancel,
		symbol: symbol,
		start:  start,
		end:    end,
	}, nil
}

// NextCandle reads the next row from the result set.
// Returns (nil, nil) at the end of the stream (EOF).
// Returns (nil, err) on any scan or network error.
func (cl *ClickHouseCandleLoader) NextCandle() (*Candle, error) {
	if !cl.rows.Next() {
		if err := cl.rows.Err(); err != nil {
			return nil, fmt.Errorf("rows iteration error: %w", err)
		}
		return nil, nil // EOF
	}

	var (
		symbol    string
		ts        time.Time
		open64    float64
		high64    float64
		low64     float64
		close64   float64
		volume64  float64
	)

	if err := cl.rows.Scan(&symbol, &ts, &open64, &high64, &low64, &close64, &volume64); err != nil {
		return nil, fmt.Errorf("rows.Scan: %w", err)
	}

	return &Candle{
		Symbol:    symbol,
		Timestamp: ts.UTC(),
		Open:      decimal.NewFromFloat(open64),
		High:      decimal.NewFromFloat(high64),
		Low:       decimal.NewFromFloat(low64),
		Close:     decimal.NewFromFloat(close64),
		Volume:    decimal.NewFromFloat(volume64),
	}, nil
}

// Count executes a pre-flight SELECT count(*) for the configured query range.
// Used by the progress ticker in main.go to compute accurate completion percentages.
// Returns (0, err) on failure; the caller should fall back to EstimatedCandleCount.
func (cl *ClickHouseCandleLoader) Count() (int64, error) {
	var count uint64
	row := cl.conn.QueryRow(cl.ctx,
		`SELECT count(*) FROM market_data FINAL WHERE symbol = ? AND timestamp >= ? AND timestamp <= ?`,
		cl.symbol, cl.start, cl.end,
	)
	if err := row.Scan(&count); err != nil {
		return 0, fmt.Errorf("candle COUNT query: %w", err)
	}
	return int64(count), nil
}

// Close releases the ClickHouse row set and connection.
// Safe to call multiple times.
func (cl *ClickHouseCandleLoader) Close() error {
	cl.cancel()
	var rowErr error
	if cl.rows != nil {
		rowErr = cl.rows.Close()
	}
	if cl.conn != nil {
		_ = cl.conn.Close()
	}
	return rowErr
}

// LoadAll materializes all candles from the result set into a single []Candle slice.
// Used by batch execution mode to cache candle data in RAM for sharing across workers.
// After calling LoadAll, subsequent NextCandle calls will return (nil, nil) (EOF).
func (cl *ClickHouseCandleLoader) LoadAll() ([]Candle, error) {
	var candles []Candle
	for {
		c, err := cl.NextCandle()
		if err != nil {
			return nil, err
		}
		if c == nil {
			break
		}
		candles = append(candles, *c)
	}
	return candles, nil
}
