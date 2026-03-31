package orchestrator

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// T013: Write 100 events → Close() → read file → assert 100 lines, each parses, schema_version==1
func TestWideEventEnricher_Write100Events(t *testing.T) {
	dir := t.TempDir()
	runID := "test-100"

	enricher, err := NewWideEventEnricher(dir, runID)
	require.NoError(t, err)

	for i := 0; i < 100; i++ {
		enricher.Emit(WideEvent{
			SchemaVersion: 1,
			RunID:         runID,
			EventType:     "price_changed",
			Symbol:        "BTCUSDC",
			Timestamp:     time.Date(2025, 1, 1, 0, i, 0, 0, time.UTC),
			CandleClose:   NewWideDecimal(decimal.NewFromInt(int64(97000 + i))),
		})
	}

	stallDur, err := enricher.Close()
	require.NoError(t, err)
	assert.GreaterOrEqual(t, stallDur, time.Duration(0))

	// Verify file contents
	filePath := filepath.Join(dir, runID+".jsonl")
	f, err := os.Open(filePath)
	require.NoError(t, err)
	defer f.Close()

	scanner := bufio.NewScanner(f)
	lineCount := 0
	for scanner.Scan() {
		line := scanner.Bytes()
		var we WideEvent
		require.NoError(t, json.Unmarshal(line, &we), "line %d must parse as WideEvent", lineCount)
		assert.Equal(t, 1, we.SchemaVersion, "schema_version on line %d", lineCount)
		assert.Equal(t, runID, we.RunID)
		lineCount++
	}
	require.NoError(t, scanner.Err())
	assert.Equal(t, 100, lineCount, "expected exactly 100 lines in JSONL file")
}

// T014: Lossless delivery — write events equal to channel capacity, assert all appear
func TestWideEventEnricher_LosslessDelivery(t *testing.T) {
	dir := t.TempDir()
	runID := "test-lossless"

	enricher, err := NewWideEventEnricher(dir, runID)
	require.NoError(t, err)

	// Write exactly channel capacity events
	const count = wideEventChannelCap
	for i := 0; i < count; i++ {
		enricher.Emit(WideEvent{
			SchemaVersion:     1,
			RunID:             runID,
			EventType:         "price_changed",
			GlobalCandleCount: int64(i + 1),
		})
	}

	stallDur, err := enricher.Close()
	require.NoError(t, err)
	_ = stallDur

	// Count lines in file
	filePath := filepath.Join(dir, runID+".jsonl")
	f, err := os.Open(filePath)
	require.NoError(t, err)
	defer f.Close()

	scanner := bufio.NewScanner(f)
	lineCount := 0
	for scanner.Scan() {
		lineCount++
	}
	require.NoError(t, scanner.Err())
	assert.Equal(t, count, lineCount, "all %d events must be written (lossless)", count)
}

// Supplemental: OutputPath returns the correct file path
func TestWideEventEnricher_OutputPath(t *testing.T) {
	dir := t.TempDir()
	runID := "test-path"

	enricher, err := NewWideEventEnricher(dir, runID)
	require.NoError(t, err)

	expected := filepath.Join(dir, runID+".jsonl")
	assert.Equal(t, expected, enricher.OutputPath())

	_, err = enricher.Close()
	require.NoError(t, err)
}

// Supplemental: Close on empty enricher (no events emitted)
func TestWideEventEnricher_CloseEmpty(t *testing.T) {
	dir := t.TempDir()
	runID := "test-empty"

	enricher, err := NewWideEventEnricher(dir, runID)
	require.NoError(t, err)

	stallDur, err := enricher.Close()
	require.NoError(t, err)
	assert.Equal(t, time.Duration(0), stallDur)

	// File should exist but be empty
	info, err := os.Stat(filepath.Join(dir, runID+".jsonl"))
	require.NoError(t, err)
	assert.Equal(t, int64(0), info.Size())
}
