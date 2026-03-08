#!/usr/bin/env node

/**
 * mock-core-engine.js - Cross-platform Mock Core Engine Binary
 *
 * Simulates the Go Core Engine binary for integration testing.
 * Reads JSON backtest configuration from stdin and outputs canonical Event Bus events as ndjson.
 *
 * Usage:
 *   node mock-core-engine.js [flags]
 *
 * Flags:
 *   --fail           Simulate binary crash (exit 1)
 *   --timeout        Simulate timeout by sleeping indefinitely
 *   --malformed      Output malformed JSON
 *   --delay N        Add N seconds delay before outputting events
 *
 * Environment Variables:
 *   MOCK_ENGINE_DEBUG - If set, print debug info to stderr
 *
 * Examples:
 *   # Normal execution: read config, output 5 events
 *   echo '{"entry_price":"100.50",...}' | node mock-core-engine.js
 *
 *   # Simulate crash
 *   echo '{"entry_price":"100.50",...}' | node mock-core-engine.js --fail
 *
 *   # Simulate timeout
 *   echo '{"entry_price":"100.50",...}' | node mock-core-engine.js --timeout
 */

import * as fs from 'fs';
import * as readline from 'readline';

// Parse command-line flags
let FAIL_MODE = false;
let TIMEOUT_MODE = false;
let MALFORMED_MODE = false;
let DELAY_SECONDS = 0;

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--fail') {
    FAIL_MODE = true;
  } else if (arg === '--timeout') {
    TIMEOUT_MODE = true;
  } else if (arg === '--malformed') {
    MALFORMED_MODE = true;
  } else if (arg === '--delay') {
    DELAY_SECONDS = parseInt(process.argv[++i], 10);
  }
}

// Read JSON config from stdin
let input = '';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  input += line;
});

rl.on('close', () => {
  // Debug output
  if (process.env.MOCK_ENGINE_DEBUG) {
    console.error(`[DEBUG] Received config: ${input}`);
  }

  // Helper function to output events with optional delay
  const outputEvents = () => {
    // Simulate failure mode
    if (FAIL_MODE) {
      console.error('Core Engine binary crashed: segmentation fault');
      process.exit(1);
    }

    // Simulate timeout mode
    if (TIMEOUT_MODE) {
      // Sleep indefinitely (will be SIGTERM'd by parent)
      setTimeout(() => {}, 999999999);
      return;
    }

    // Generate canonical Event Bus events as ndjson
    // Events follow the contract defined in contracts/trade-event.ts

    // Event 1: PositionOpenedEvent (t=1000ms)
    console.log(
      JSON.stringify({
        type: 'PositionOpened',
        timestamp: 1000,
        position_id: '550e8400-e29b-41d4-a716-446655440001',
        entry_price: '100.50000000',
        initial_quantity: '10.25000000',
        entry_fee: '1.00000000',
        position_state: {
          quantity: '10.25000000',
          average_cost: '100.50000000',
          total_invested: '1031.62500000',
          leverage_level: '2.00000000',
          status: 'OPEN',
          last_update_timestamp: 1000,
        },
      })
    );

    // Event 2: OrderFilledEvent at price 95 (t=1100ms, safety_order_index=0)
    console.log(
      JSON.stringify({
        type: 'OrderFilled',
        timestamp: 1100,
        order_id: '550e8400-e29b-41d4-a716-446655440002',
        price: '95.00000000',
        quantity: '10.25000000',
        fee: '0.10000000',
        safety_order_index: 0,
        position_state: {
          quantity: '20.50000000',
          average_cost: '97.75000000',
          total_invested: '2042.50000000',
          leverage_level: '2.00000000',
          status: 'OPEN',
          last_update_timestamp: 1100,
        },
      })
    );

    // Event 3: OrderFilledEvent at price 90 (t=1200ms, safety_order_index=1)
    console.log(
      JSON.stringify({
        type: 'OrderFilled',
        timestamp: 1200,
        order_id: '550e8400-e29b-41d4-a716-446655440003',
        price: '90.00000000',
        quantity: '10.25000000',
        fee: '0.10000000',
        safety_order_index: 1,
        position_state: {
          quantity: '30.75000000',
          average_cost: '95.16666667',
          total_invested: '3052.75000000',
          leverage_level: '2.00000000',
          status: 'OPEN',
          last_update_timestamp: 1200,
        },
      })
    );

    // Event 4: GapDownEvent (price drops from 90 to 85, t=1300ms)
    console.log(
      JSON.stringify({
        type: 'GapDownEvent',
        timestamp: 1300,
        gap_from_price: '90.00000000',
        gap_to_price: '85.00000000',
        filled_orders: [
          {
            price: '85.00000000',
            quantity: '10.25000000',
            safety_order_index: 2,
          },
        ],
        position_state: {
          quantity: '41.00000000',
          average_cost: '92.80487805',
          total_invested: '3773.80000000',
          leverage_level: '2.00000000',
          status: 'OPEN',
          last_update_timestamp: 1300,
        },
      })
    );

    // Event 5: PositionClosedEvent (t=2000ms)
    console.log(
      JSON.stringify({
        type: 'PositionClosed',
        timestamp: 2000,
        close_price: '102.00000000',
        position_state: {
          quantity: '41.00000000',
          average_cost: '92.80487805',
          total_invested: '3773.80000000',
          leverage_level: '2.00000000',
          status: 'CLOSED',
          last_update_timestamp: 2000,
        },
      })
    );

    // Output malformed JSON if requested (should be caught by parser)
    if (MALFORMED_MODE) {
      console.log('{"incomplete_json":');
    }

    process.exit(0);
  };

  // Simulate delay if requested
  if (DELAY_SECONDS > 0) {
    setTimeout(outputEvents, DELAY_SECONDS * 1000);
  } else {
    outputEvents();
  }
});
