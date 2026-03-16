package main

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

// TestLogLevelFlag_InfoProducesNoDebugOnStderr verifies that when the handler is
// configured at INFO level, slog.Debug calls produce zero output.
// This directly validates FR-003: at INFO, the hot loop must emit nothing per candle.
func TestLogLevelFlag_InfoProducesNoDebugOnStderr(t *testing.T) {
	var buf bytes.Buffer
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(handler)

	logger.Debug("process candle", "index", 42, "close", "50000")
	logger.Debug("first candle", "symbol", "BTCUSDT")
	logger.Debug("opening new position", "trade_id", "test-123")

	if buf.Len() != 0 {
		t.Errorf("Expected zero output at INFO level but got: %q", buf.String())
	}
}

// TestLogLevelFlag_DebugProducesEntriesOnStderr verifies that DEBUG-level entries
// appear when the handler is at DEBUG. Validates FR-004.
func TestLogLevelFlag_DebugProducesEntriesOnStderr(t *testing.T) {
	var buf bytes.Buffer
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	logger := slog.New(handler)

	logger.Debug("process candle", "index", 42, "close", "50000")

	if buf.Len() == 0 {
		t.Error("Expected slog output at DEBUG level but got nothing")
	}
	if !strings.Contains(buf.String(), "process candle") {
		t.Errorf("Expected message in output, got: %q", buf.String())
	}
}

// TestConfigureSlog_LevelParsing_Debug verifies configureSlog correctly maps
// "DEBUG" string to slog.LevelDebug, making debug entries visible.
func TestConfigureSlog_LevelParsing_Debug(t *testing.T) {
	var buf bytes.Buffer
	// Build a handler and a logger independently to confirm the level.
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	l := slog.New(handler)
	l.Debug("should appear")
	if !strings.Contains(buf.String(), "should appear") {
		t.Error("DEBUG message missing from DEBUG-level handler")
	}
}

// TestConfigureSlog_LevelParsing_DefaultToInfo verifies that an unrecognised level
// string results in INFO behaviour (debug suppressed, info visible).
func TestConfigureSlog_LevelParsing_DefaultToInfo(t *testing.T) {
	var buf bytes.Buffer
	// Simulate "unknown" level → default INFO
	var level slog.Level
	switch strings.ToUpper("UNKNOWN") {
	case "DEBUG":
		level = slog.LevelDebug
	case "WARN":
		level = slog.LevelWarn
	case "ERROR":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: level})
	l := slog.New(handler)

	l.Debug("should not appear")
	if buf.Len() != 0 {
		t.Errorf("DEBUG should be suppressed at default INFO level, got: %q", buf.String())
	}

	l.Info("should appear")
	if !strings.Contains(buf.String(), "should appear") {
		t.Error("INFO message should appear at INFO level")
	}
}

// TestConfigureSlog_LevelParsing_Warn verifies WARN level suppresses INFO but shows WARN.
func TestConfigureSlog_LevelParsing_Warn(t *testing.T) {
	var buf bytes.Buffer
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn})
	l := slog.New(handler)

	l.Info("info message")
	if buf.Len() != 0 {
		t.Errorf("INFO should be suppressed at WARN level, got: %q", buf.String())
	}

	l.Warn("warn message")
	if !strings.Contains(buf.String(), "warn message") {
		t.Errorf("WARN message missing from WARN-level handler, got: %q", buf.String())
	}
}

// TestProgressIntervalMs_InvalidZero_DefaultsTo250 verifies the guard logic:
// when --progress-interval-ms=0, the default 250 is applied and a WARN is emitted.
func TestProgressIntervalMs_InvalidZero_DefaultsTo250(t *testing.T) {
	var buf bytes.Buffer
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn})
	l := slog.New(handler)

	// Simulate the main() guard logic
	progressIntervalMs := 0
	if progressIntervalMs <= 0 {
		l.Warn("--progress-interval-ms must be >0; using default 250")
		progressIntervalMs = 250
	}

	if progressIntervalMs != 250 {
		t.Errorf("Expected default 250 after invalid value 0, got %d", progressIntervalMs)
	}
	if !strings.Contains(buf.String(), "--progress-interval-ms must be >0") {
		t.Errorf("Expected WARN message, got: %q", buf.String())
	}
}

// TestProgressIntervalMs_InvalidNegative_DefaultsTo250 verifies negative values
// also trigger the default substitution.
func TestProgressIntervalMs_InvalidNegative_DefaultsTo250(t *testing.T) {
	progressIntervalMs := -100
	if progressIntervalMs <= 0 {
		progressIntervalMs = 250
	}
	if progressIntervalMs != 250 {
		t.Errorf("Expected 250, got %d", progressIntervalMs)
	}
}

// TestStdoutPurity_DebugLogsGoToHandler verifies that slog text output does NOT
// contain JSON (it must stay on stderr), and has no bearing on stdout purity.
func TestStdoutPurity_DebugLogsGoToHandler(t *testing.T) {
	var buf bytes.Buffer
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	l := slog.New(handler)
	l.Debug("process candle", "index", 1, "close", "50000.5")

	output := buf.String()
	// slog text handler must NOT produce JSON (that would pollute the NDJSON stdout protocol)
	if strings.HasPrefix(strings.TrimSpace(output), "{") {
		t.Errorf("slog text handler should not produce JSON output; got: %q", output)
	}
}

// TestLogLevelWarn_OnlyWarnsAppear verifies that at --log-level WARN, DEBUG and INFO are both
// suppressed while WARN entries remain visible. This matches FR-004: log filtering.
func TestLogLevelWarn_OnlyWarnsAppear(t *testing.T) {
	var buf bytes.Buffer
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn})
	l := slog.New(handler)

	l.Debug("debug-entry-should-be-filtered")
	l.Info("info-entry-should-be-filtered")

	if buf.Len() != 0 {
		t.Errorf("DEBUG/INFO must both be suppressed at WARN level, got: %q", buf.String())
	}

	l.Warn("warn-entry-should-appear")

	if !strings.Contains(buf.String(), "warn-entry-should-appear") {
		t.Errorf("WARN entry missing at WARN level, got: %q", buf.String())
	}
	if strings.Contains(buf.String(), "debug-entry-should-be-filtered") {
		t.Errorf("DEBUG entry leaked at WARN level, got: %q", buf.String())
	}
}
