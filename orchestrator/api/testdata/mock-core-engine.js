#!/usr/bin/env node

/**
 * mock-core-engine.js - Cross-platform Mock Core Engine Binary
 *
 * Simulates the Go Core Engine binary for integration testing.
 * Reads JSON backtest configuration from stdin and outputs NDJSON lines:
 *   - 2 progress lines  (type="progress")
 *   - 1 result line     (type="result") with the new EngineResultPayload shape
 *
 * Usage:
 *   node mock-core-engine.js [flags]
 *
 * Flags:
 *   --fail           Simulate binary crash (exit 1)
 *   --timeout        Simulate timeout by sleeping indefinitely
 *   --malformed      Output malformed JSON then result
 *   --delay N        Add N seconds delay before outputting events
 *
 * Environment Variables:
 *   MOCK_ENGINE_DEBUG - If set, print debug info to stderr
 */

import * as readline from 'readline';

// Parse command-line flags
let FAIL_MODE     = false;
let TIMEOUT_MODE  = false;
let MALFORMED_MODE = false;
let DELAY_SECONDS = 0;

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--fail')    { FAIL_MODE = true; }
  else if (arg === '--timeout')   { TIMEOUT_MODE = true; }
  else if (arg === '--malformed') { MALFORMED_MODE = true; }
  else if (arg === '--delay')     { DELAY_SECONDS = parseInt(process.argv[++i], 10); }
  // Ignore unknown flags (--log-level, --progress-interval-ms, etc.)
}

// Read JSON config from stdin
let input = '';

const rl = readline.createInterface({
  input:    process.stdin,
  terminal: false,
});

rl.on('line', (line) => { input += line; });

rl.on('close', () => {
  if (process.env.MOCK_ENGINE_DEBUG) {
    process.stderr.write(`[DEBUG] Received config: ${input}\n`);
  }

  const outputEvents = () => {
    // --- Failure modes ---
    if (FAIL_MODE) {
      process.stderr.write('Core Engine binary crashed: segmentation fault\n');
      process.exit(1);
    }

    if (TIMEOUT_MODE) {
      setTimeout(() => {}, 999999999);
      return;
    }

    // --- Malformed line should be silently discarded by readline parser ---
    if (MALFORMED_MODE) {
      process.stdout.write('{"incomplete_json":\n');
    }

    // --- Progress line 1 ---
    process.stdout.write(JSON.stringify({
      type:              'progress',
      percent:           25,
      current_date:      '2025-01-08T00:00:00Z',
      processed_candles: 11160,
      total_candles:     44640,
      current_price:     104.5,
      realized_pnl:      0,
      candles_per_second: 500000,
    }) + '\n');

    // --- Progress line 2 ---
    process.stdout.write(JSON.stringify({
      type:              'progress',
      percent:           50,
      current_date:      '2025-01-15T00:00:00Z',
      processed_candles: 22320,
      total_candles:     44640,
      current_price:     102.0,
      realized_pnl:      4.28,
      candles_per_second: 500000,
    }) + '\n');

    // --- Final result line ---
    process.stdout.write(JSON.stringify({
      type: 'result',
      pnlSummary: {
        roi:         5.5,
        maxDrawdown: 1.2,
        totalFees:   2.5,
      },
      tradeEvents: [
        {
          timestamp:    '1/1/2025, 12:00:00 AM',
          rawTimestamp: '2025-01-01T00:00:00Z',
          eventType:    'ENTRY',
          price:        100.5,
          quantity:     10.25,
          balance:      1031.625,
          trade_id:     '1',
          fee:          1.0,
        },
        {
          timestamp:    '1/8/2025, 12:00:00 AM',
          rawTimestamp: '2025-01-08T00:00:00Z',
          eventType:    'SAFETY_ORDER',
          price:        95.0,
          quantity:     10.25,
          balance:      973.75,
          trade_id:     '1',
          fee:          0.1,
        },
        {
          timestamp:    '1/15/2025, 12:00:00 AM',
          rawTimestamp: '2025-01-15T00:00:00Z',
          eventType:    'EXIT',
          price:        102.0,
          quantity:     20.5,
          balance:      4.28,
          trade_id:     '1',
          fee:          1.4,
        },
      ],
      safetyOrderUsage: [
        { level: '1', count: 1 },
      ],
      executionTimeMs: 120,
      candleCount:     44640,
      eventCount:      12,
    }) + '\n');

    process.exit(0);
  };

  if (DELAY_SECONDS > 0) {
    setTimeout(outputEvents, DELAY_SECONDS * 1000);
  } else {
    outputEvents();
  }
});


