/**
 * Trade Event Contracts
 *
 * Represents the Event Bus event types that flow from the Go Core Engine.
 * These are IMMUTABLE events describing what happened during the backtest.
 * The API MUST parse these from ndjson (newline-delimited JSON) stdout.
 */

/**
 * TradeEvent - Union type of all possible Event Bus events
 *
 * The Core Engine emits events in execution order, one per line (ndjson format).
 * Each line is a complete JSON object, parseable independently.
 *
 * Example ndjson output:
 * {"type":"PositionOpened","timestamp":1704067200000,"entry_price":"100.50","position_id":"pos-001"}
 * {"type":"OrderFilled","timestamp":1704067260000,"order_id":"ord-001","price":"99.50","quantity":"10.25"}
 * {"type":"OrderFilled","timestamp":1704067320000,"order_id":"ord-002","price":"98.50","quantity":"10.25"}
 * {"type":"PositionClosed","timestamp":1704067380000,"close_price":"101.00","pnl":"15.50"}
 */
export type TradeEvent =
  | PositionOpenedEvent
  | OrderFilledEvent
  | PositionClosedEvent
  | LiquidationEvent
  | GapDownEvent;

/**
 * PositionOpenedEvent - Triggered when a position is first opened
 * Occurs at the start of backtest strategy execution
 */
export interface PositionOpenedEvent {
  type: 'PositionOpened';

  /** Unix timestamp (milliseconds) when position was opened */
  timestamp: number;

  /** Entry price as decimal string (8 decimal places) */
  entry_price: string;

  /** Initial position quantity (base currency amount) */
  initial_quantity: string;

  /** Unique position identifier */
  position_id: string;

  /** Initial position state after opening */
  position_state: PositionState;
}

/**
 * OrderFilledEvent - Triggered each time a DCA order fills at current market price
 * Multiple fills can occur for a single position
 */
export interface OrderFilledEvent {
  type: 'OrderFilled';

  /** Unix timestamp (milliseconds) when order filled */
  timestamp: number;

  /** Unique order identifier */
  order_id: string;

  /** Fill price as decimal string (8 decimal places) */
  price: string;

  /** Quantity filled as decimal string */
  quantity: string;

  /** Updated position state after this fill */
  position_state: PositionState;

  /** Fee paid for this fill as decimal string */
  fee?: string;
}

/**
 * PositionClosedEvent - Triggered when position is closed (user exit or take-profit)
 * Includes P&L calculation
 */
export interface PositionClosedEvent {
  type: 'PositionClosed';

  /** Unix timestamp (milliseconds) when position closed */
  timestamp: number;

  /** Close price as decimal string (8 decimal places) */
  close_price: string;

  /** Total profit/loss as decimal string (positive for gain, negative for loss) */
  pnl: string;

  /** Reason for closure (e.g., "take_profit", "user_exit", "stop_loss") */
  close_reason: string;

  /** Final position state (status = CLOSED) */
  position_state: PositionState;
}

/**
 * LiquidationEvent - Triggered when position is forcefully closed due to margin requirement
 * Indicates a critical event in position lifecycle
 */
export interface LiquidationEvent {
  type: 'LiquidationEvent';

  /** Unix timestamp (milliseconds) when liquidation occurred */
  timestamp: number;

  /** Price at which liquidation was executed */
  liquidation_price: string;

  /** Liquidation fee charged as decimal string */
  liquidation_fee: string;

  /** Realized loss due to liquidation and fees */
  realized_loss: string;

  /** Final position state (status = LIQUIDATED) */
  position_state: PositionState;

  /** Reason liquidation occurred */
  reason: string;
}

/**
 * GapDownEvent - Triggered when market price gaps down past multiple limit orders
 * Important for Gap-Down Paradox rule verification
 */
export interface GapDownEvent {
  type: 'GapDownEvent';

  /** Unix timestamp (milliseconds) when gap-down was detected */
  timestamp: number;

  /** Previous candle's high price (before gap) */
  previous_high: string;

  /** Current candle's low price (after gap) */
  current_low: string;

  /** Orders that were filled due to gap-down (at their pre-calculated limit prices) */
  filled_orders: GapDownFill[];

  /** Updated position state after gap-down processing */
  position_state: PositionState;
}

/**
 * GapDownFill - Represents a single order fill that occurred due to gap-down
 * Gap-down fills occur at the order's original limit price, not the gap-down price
 */
export interface GapDownFill {
  /** Order ID that was filled */
  order_id: string;

  /** Pre-calculated limit price (order fills at this price, not the current price) */
  limit_price: string;

  /** Quantity filled */
  quantity: string;

  /** Fee for this fill */
  fee: string;
}

/**
 * PositionState - Snapshot of position attributes at a specific point in time
 * Embedded in every trade event to track position evolution
 */
export interface PositionState {
  /** Current position status: OPEN, CLOSED, LIQUIDATED */
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';

  /** Total accumulated quantity (sum of all fills) */
  quantity: string;

  /** Average cost per unit (weighted average of all fills) */
  average_cost: string;

  /** Current margin ratio (mmr) based on latest market price */
  margin_ratio: string;

  /** Configured maximum margin ratio allowed before liquidation */
  max_margin_ratio: string;

  /** Current leverage multiplier */
  leverage: string;

  /** Total fees paid so far */
  total_fees: string;

  /** Current unrealized P&L (based on latest price) */
  unrealized_pnl?: string;

  /** Timestamp of last state update */
  last_update_time: number;
}

/**
 * NDJSON PARSING PATTERN (implementation guide)
 *
 * export class EventBusParser {
 *   static parseNdjsonStream(inputStream: NodeJS.ReadableStream): Promise<TradeEvent[]> {
 *     const events: TradeEvent[] = [];
 *
 *     return new Promise((resolve, reject) => {
 *       const lineStream = inputStream.pipe(split());
 *
 *       lineStream.on('data', (line: string) => {
 *         if (!line.trim()) return; // Skip empty lines
 *
 *         try {
 *           const json = JSON.parse(line);
 *           const event = this.parseEvent(json);
 *           if (event) events.push(event);
 *         } catch (error) {
 *           reject(new Error(`Failed to parse event: ${line}`));
 *         }
 *       });
 *
 *       lineStream.on('end', () => resolve(events));
 *       lineStream.on('error', reject);
 *     });
 *   }
 *
 *   private static parseEvent(json: Record<string, unknown>): TradeEvent | null {
 *     const type = json.type as string;
 *
 *     switch (type) {
 *       case 'PositionOpened':
 *         return json as PositionOpenedEvent;
 *       case 'OrderFilled':
 *         return json as OrderFilledEvent;
 *       case 'PositionClosed':
 *         return json as PositionClosedEvent;
 *       case 'LiquidationEvent':
 *         return json as LiquidationEvent;
 *       case 'GapDownEvent':
 *         return json as GapDownEvent;
 *       default:
 *         console.warn(`Unknown event type: ${type}`);
 *         return null;
 *     }
 *   }
 * }
 */
