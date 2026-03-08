/**
 * EventBusParser - Parse ndjson Event Bus output from Core Engine
 *
 * Transforms newline-delimited JSON strings into typed TradeEvent objects.
 * Validates event structure and nested PositionState objects.
 */

import { TradeEvent, PositionState } from '../types/index';
import { ParseError } from '../types/errors';

/**
 * Validates and parses a single ndjson event line into a TypeScript TradeEvent
 *
 * @param line - Single line from ndjson output (complete JSON object)
 * @param lineNumber - Line number (for error reporting)
 * @returns Parsed and validated TradeEvent
 * @throws ParseError if JSON invalid or schema mismatch
 *
 * @example
 * const line = '{"type":"PositionOpened",...}';
 * const event = parseEventLine(line, 1);  // Returns typed TradeEvent
 */
export function parseEventLine(line: string, lineNumber: number): TradeEvent {
  // Skip empty lines
  if (!line.trim()) {
    throw new ParseError(lineNumber, line, 'Empty line');
  }

  // Parse JSON
  let parsed: any;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new ParseError(
      lineNumber,
      line,
      `Invalid JSON at line ${lineNumber}: ${String(error)}`
    );
  }

  // Validate event type field exists
  if (!parsed.type) {
    throw new ParseError(
      lineNumber,
      line,
      `Missing 'type' field at line ${lineNumber}`
    );
  }

  // Validate based on event type
  const eventType = parsed.type;

  // Validate common fields (all events must have these)
  if (typeof parsed.timestamp !== 'number') {
    throw new ParseError(
      lineNumber,
      line,
      `Missing or invalid 'timestamp' at line ${lineNumber}`
    );
  }

  if (!parsed.position_state) {
    throw new ParseError(
      lineNumber,
      line,
      `Missing 'position_state' at line ${lineNumber}`
    );
  }

  // Validate nested PositionState
  try {
    validatePositionState(parsed.position_state);
  } catch (error) {
    throw new ParseError(
      lineNumber,
      line,
      `Invalid position_state at line ${lineNumber}: ${String(error)}`
    );
  }

  // Validate event-specific fields
  switch (eventType) {
    case 'PositionOpened':
      return validatePositionOpenedEvent(parsed, lineNumber, line);

    case 'OrderFilled':
      return validateOrderFilledEvent(parsed, lineNumber, line);

    case 'PositionClosed':
      return validatePositionClosedEvent(parsed, lineNumber, line);

    case 'LiquidationEvent':
      return validateLiquidationEvent(parsed, lineNumber, line);

    case 'GapDownEvent':
      return validateGapDownEvent(parsed, lineNumber, line);

    default:
      throw new ParseError(
        lineNumber,
        line,
        `Unknown event type: "${eventType}" at line ${lineNumber}`
      );
  }
}

/**
 * Validates PositionState object structure
 */
function validatePositionState(state: any): PositionState {
  const required = [
    'quantity',
    'average_cost',
    'total_invested',
    'leverage_level',
    'status',
    'last_update_timestamp',
  ];

  for (const field of required) {
    if (!(field in state)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const validStatuses = ['OPEN', 'CLOSED', 'LIQUIDATED'];
  if (!validStatuses.includes(state.status)) {
    throw new Error(`Invalid status: ${state.status}`);
  }

  return state as PositionState;
}

function validatePositionOpenedEvent(
  event: any,
  lineNumber: number,
  line: string
): TradeEvent {
  const required = ['position_id', 'entry_price', 'initial_quantity', 'entry_fee'];

  for (const field of required) {
    if (!(field in event)) {
      throw new ParseError(lineNumber, line, `Missing required field: ${field}`);
    }
  }

  return event as TradeEvent;
}

function validateOrderFilledEvent(
  event: any,
  lineNumber: number,
  line: string
): TradeEvent {
  const required = ['order_id', 'price', 'quantity', 'fee', 'safety_order_index'];

  for (const field of required) {
    if (!(field in event)) {
      throw new ParseError(lineNumber, line, `Missing required field: ${field}`);
    }
  }

  if (typeof event.safety_order_index !== 'number') {
    throw new ParseError(
      lineNumber,
      line,
      `Invalid safety_order_index: must be number`
    );
  }

  return event as TradeEvent;
}

function validatePositionClosedEvent(
  event: any,
  lineNumber: number,
  line: string
): TradeEvent {
  if (!('close_price' in event)) {
    throw new ParseError(lineNumber, line, 'Missing required field: close_price');
  }

  return event as TradeEvent;
}

function validateLiquidationEvent(
  event: any,
  lineNumber: number,
  line: string
): TradeEvent {
  const required = ['liquidation_price', 'liquidation_fee'];

  for (const field of required) {
    if (!(field in event)) {
      throw new ParseError(lineNumber, line, `Missing required field: ${field}`);
    }
  }

  return event as TradeEvent;
}

function validateGapDownEvent(
  event: any,
  lineNumber: number,
  line: string
): TradeEvent {
  const required = ['gap_from_price', 'gap_to_price', 'filled_orders'];

  for (const field of required) {
    if (!(field in event)) {
      throw new ParseError(lineNumber, line, `Missing required field: ${field}`);
    }
  }

  if (!Array.isArray(event.filled_orders)) {
    throw new ParseError(
      lineNumber,
      line,
      'filled_orders must be an array'
    );
  }

  // Validate each fill in the array
  for (let i = 0; i < event.filled_orders.length; i++) {
    const fill = event.filled_orders[i];
    const fillRequired = ['price', 'quantity', 'safety_order_index'];
    for (const field of fillRequired) {
      if (!(field in fill)) {
        throw new ParseError(
          lineNumber,
          line,
          `Missing required field in filled_orders[${i}]: ${field}`
        );
      }
    }
  }

  return event as TradeEvent;
}

/**
 * Parses complete ndjson output into array of TradeEvents
 *
 * @param ndjsonOutput - Complete ndjson output (newline-separated JSON)
 * @returns Array of validated TradeEvent objects in order
 * @throws ParseError if any line is invalid
 *
 * @example
 * const output = `{"type":"PositionOpened",...}\n{"type":"OrderFilled",...}\n`;
 * const events = parseNdjsonOutput(output);  // Returns TradeEvent[]
 */
export function parseNdjsonOutput(ndjsonOutput: string): TradeEvent[] {
  const lines = ndjsonOutput.split('\n');
  const events: TradeEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines (including final newline)
    if (!line.trim()) {
      continue;
    }

    // Parse and collect event
    const event = parseEventLine(line, i + 1); // Line numbers start at 1
    events.push(event);
  }

  if (events.length === 0) {
    throw new Error('No valid events found in output');
  }

  return events;
}
