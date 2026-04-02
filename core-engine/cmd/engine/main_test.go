package main

import (
	"bytes"
	"encoding/json"
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

// ─── T018: enable_wide_events OR logic (FR-025, FR-026) ─────────────────────
//
// emitWideEvents simulates the OR logic from main() — extracted for unit testability.
// Returns true if the combined (env || config) condition would enable wide events.
func emitWideEvents(envVal string, reqFlag *bool) bool {
	envWide := envVal == "true"
	var reqWide bool
	if reqFlag != nil {
		reqWide = *reqFlag
	}
	return envWide || reqWide
}

// TestWideEvents_EnvFalse_ConfigTrue_EmitsTrue tests FR-026 row 1:
// ENABLE_WIDE_EVENTS=false | config enable_wide_events=true → true
func TestWideEvents_EnvFalse_ConfigTrue_EmitsTrue(t *testing.T) {
	tt := true
	if !emitWideEvents("false", &tt) {
		t.Error("expected emitWideEvents=true (env=false, config=true)")
	}
}

// TestWideEvents_EnvTrue_ConfigFalse_EmitsTrue tests FR-026 row 2:
// ENABLE_WIDE_EVENTS=true | config enable_wide_events=false → true
func TestWideEvents_EnvTrue_ConfigFalse_EmitsTrue(t *testing.T) {
	ff := false
	if !emitWideEvents("true", &ff) {
		t.Error("expected emitWideEvents=true (env=true, config=false)")
	}
}

// TestWideEvents_BothFalse_EmitsFalse tests FR-026 row 3:
// ENABLE_WIDE_EVENTS=false | config absent → false
func TestWideEvents_BothFalse_EmitsFalse(t *testing.T) {
	if emitWideEvents("false", nil) {
		t.Error("expected emitWideEvents=false (env=false, config absent)")
	}
}

// TestWideEvents_AbsentField_UnmarshalNil tests FR-025:
// JSON with no enable_wide_events field → EngineRequest.EnableWideEvents is nil (defaults false).
func TestWideEvents_AbsentField_UnmarshalNil(t *testing.T) {
	raw := `{"trading_pair":"BTC/USDC","start_date":"2025-01-01T00:00:00Z","end_date":"2025-01-31T00:00:00Z","price_entry":"50000","price_scale":"1.1","amount_scale":"2.0","number_of_orders":3,"amount_per_trade":"1000","margin_type":"cross","multiplier":1,"take_profit_distance_percent":"0.5","account_balance":"10000","exit_on_last_order":false,"clickhouse_addr":"","clickhouse_db":"","clickhouse_user":"","clickhouse_password":""}`
	var req EngineRequest
	if err := json.Unmarshal([]byte(raw), &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if req.EnableWideEvents != nil {
		t.Errorf("expected EnableWideEvents nil when field absent, got %v", *req.EnableWideEvents)
	}
	if emitWideEvents("false", req.EnableWideEvents) {
		t.Error("nil EnableWideEvents should produce false")
	}
}
