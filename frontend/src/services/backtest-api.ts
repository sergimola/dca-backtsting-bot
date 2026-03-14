import axios from 'axios';
import type { BacktestFormState, BacktestResults } from './types';

const API_BASE_URL = 'http://localhost:4000';

// In-memory cache to bridge the Long-Polling backend with the Polling frontend
const resultCache = new Map<string, any>();

function getHeaders() {
  return { 'Content-Type': 'application/json' };
}

/**
 * Formats a date string to RFC 3339 format (ISO 8601 with Z timezone).
 * - YYYY-MM-DD → YYYY-MM-DDT00:00:00Z (start), YYYY-MM-DDT23:59:59Z (end)
 * - YYYY-MM-DD HH:MM:SS → YYYY-MM-DDTHH:MM:SSZ
 * 
 * This format is expected by the Go engine's time.RFC3339 parser.
 */
function formatApiDate(dateStr: string, isEnd: boolean): string {
  // Case 1: Short format YYYY-MM-DD (10 chars)
  if (dateStr.length === 10) {
    const time = isEnd ? '23:59:59' : '00:00:00';
    return `${dateStr}T${time}Z`;
  }
  // Case 2: Datetime format YYYY-MM-DD HH:MM:SS (19 chars) — replace space with T, append Z
  if (dateStr.length === 19 && dateStr[10] === ' ') {
    return `${dateStr.substring(0, 10)}T${dateStr.substring(11)}Z`;
  }
  // Case 3: Already RFC 3339 or other format — pass through
  return dateStr;
}

export async function submitBacktest(config: BacktestFormState): Promise<{ backtestId: string }> {
  try {
    // Translate Frontend camelCase to Backend strict snake_case
    const apiPayload = {
      trading_pair: config.tradingPair,
      start_date: formatApiDate(config.startDate, false),
      end_date: formatApiDate(config.endDate, true),
      price_entry: config.priceEntry,
      price_scale: config.priceScale,
      amount_scale: config.amountScale,
      number_of_orders: parseInt(config.numberOfOrders, 10),
      amount_per_trade: config.amountPerTrade,
      margin_type: config.marginType,
      multiplier: parseInt(config.multiplier, 10),
      take_profit_distance_percent: config.takeProfitDistancePercent,
      account_balance: config.accountBalance,
      exit_on_last_order: config.exitOnLastOrder,
    };

    console.log('Sending payload to API:', apiPayload);

    // This POST request will block until the Go engine finishes (max 35s)
    const response = await axios.post(`${API_BASE_URL}/backtest`, apiPayload, { headers: getHeaders() });

    if (response.status !== 200 && response.status !== 201 && response.status !== 202) {
      throw new Error(`Expected success status, received ${response.status}`);
    }

    const backtestId = response.data.request_id;
    
    // Store the full result in memory along with original config for padding
    // Number of orders is needed for padding safety order usage array
    resultCache.set(backtestId, {
      ...response.data,
      _original_number_of_orders: apiPayload.number_of_orders,
    });

    return { backtestId };
  } catch (error: any) {
    console.error('Submission error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || 'Failed to submit backtest');
  }
}

export async function getStatus(backtestId: string): Promise<{ status: 'pending' | 'completed' | 'failed'; error?: string }> {
  // Since the POST request blocks until completion, if we have the ID, we already have the result!
  if (resultCache.has(backtestId)) {
    return { status: 'completed' };
  }
  return { status: 'pending' };
}

// Go engine EventType values that represent actual fills to show in the trade table.
// SellOrderExecuted is EXCLUDED — it is always paired with PositionClosed and carries
// the same price/profit, creating a duplicate EXIT row.
// LiquidationPriceUpdated, MarginWarning, price.changed → noise, excluded.
const FILL_EVENT_TYPES = new Set([
  'PositionOpened',
  'BuyOrderExecuted',
  'PositionClosed',
]);

// Maps Go engine EventType strings to the frontend's display labels.
const EVENT_TYPE_LABEL: Record<string, string> = {
  PositionOpened:   'ENTRY',
  BuyOrderExecuted: 'SAFETY_ORDER',
  PositionClosed:   'EXIT',
};

export async function getResults(backtestId: string): Promise<BacktestResults> {
  const data = resultCache.get(backtestId);
  if (!data) {
    throw new Error('Results not found in local cache');
  }

  // Extract number of orders for padding safety order usage
  const numberOfOrders = data._original_number_of_orders ?? 0;

  // Imperative loop: build trade events with sequential trade counter (US1).
  // tradeCounter increments on each PositionOpened, assigning stable "1","2","3"... IDs
  // independent of the Go engine's internal trade_id UUID (which is identical across all events).
  const tradeEvents: Array<{
    timestamp: string; rawTimestamp: string; eventType: string;
    price: number; quantity: number; balance: number; trade_id: string; fee: number;
  }> = [];
  let tradeCounter = 0;
  let currentTradeId = '0';
  let lastExitEvent: (typeof tradeEvents)[number] | null = null;

  for (const e of (data.events as any[])) {
    // Advance the trade counter on each new position open (US1)
    if (e.type === 'PositionOpened') {
      tradeCounter++;
      currentTradeId = String(tradeCounter);
    }

    // Patch exit fee from SellOrderExecuted that immediately follows PositionClosed (US2/T014)
    if (e.type === 'SellOrderExecuted' && lastExitEvent !== null) {
      const d: any = e.data ?? {};
      lastExitEvent.fee = parseFloat(d.fee ?? '0');
      lastExitEvent = null;
      continue;
    }

    // Skip non-fill events (price.changed, LiquidationPriceUpdated, SellOrderExecuted, etc.)
    if (!FILL_EVENT_TYPES.has(e.type)) {
      continue;
    }

    const d: any = e.data ?? {};
    const rawIsoTimestamp = e.timestamp ?? '';
    let price    = 0;
    let quantity = 0;
    let balance  = 0;
    let fee      = 0;

    switch (e.type as string) {
      case 'PositionOpened': {
        // PositionOpened carries the pre-calculated order grid.
        // configured_orders[0] is always the entry market-buy order.
        const entryOrder = d.configured_orders?.[0] ?? {};
        const tradeCost = parseFloat(entryOrder.amount ?? '0');
        price    = parseFloat(entryOrder.price  ?? '0');
        // quantity = Trade Cost / Price (e.g., $32.25 / $50000 = 0.000645 BTC)
        quantity = tradeCost / price || 0;
        // balance = notional USDT value of the entry order
        balance  = tradeCost;
        fee      = parseFloat(d.entry_fee ?? '0');
        break;
      }

      case 'BuyOrderExecuted': {
        // BuyOrderExecutedEvent:
        //   price     = fill price (USDT/BTC)
        //   base_size = BTC quantity purchased
        //   size      = fractional amount from ComputeAmountSequence (NOT USDT — do not use)
        const btcQty  = parseFloat(d.base_size ?? '0');
        price    = parseFloat(d.price ?? '0');
        quantity = btcQty;
        // balance = USDT deployed = fill_price × BTC_qty
        balance  = price * quantity;
        fee      = parseFloat(d.fee ?? '0');
        break;
      }

      case 'PositionClosed': {
        // TradeClosedEvent:
        //   closing_price = exit price (USDT/BTC)
        //   size          = total BTC in position at close
        //   profit        = realized P&L (USDT)
        price    = parseFloat(d.closing_price ?? '0');
        quantity = parseFloat(d.size          ?? '0');
        balance  = parseFloat(d.profit        ?? '0');
        fee      = 0; // placeholder — patched by SellOrderExecuted handler above (US2/T014)
        break;
      }
    }

    const event = {
      timestamp: new Date(rawIsoTimestamp).toLocaleString(),
      rawTimestamp: rawIsoTimestamp,
      eventType: EVENT_TYPE_LABEL[e.type as string] ?? e.type,
      price,
      quantity,
      balance,
      trade_id: currentTradeId,
      fee,
    };
    tradeEvents.push(event);

    // Hold reference to EXIT event so SellOrderExecuted can patch its fee (US2/T014)
    if (e.type === 'PositionClosed') {
      lastExitEvent = event;
    }
  }

  // Pad safety order usage with unused orders
  const countsByLevel = data.pnl_summary?.safety_order_usage_counts ?? {};
  const safetyOrderUsage: Array<{ level: string; count: number }> = [];
  
  // Include SO levels 1 through numberOfOrders-1.
  // Level 0 (entry) is excluded — it is not a safety order (US3/FR-008).
  // Legacy stored results may contain key "0" from old builds — this loop naturally ignores it.
  for (let i = 1; i < numberOfOrders; i++) {
    const count = (countsByLevel[i] ?? 0) as number;
    safetyOrderUsage.push({
      level: String(i),
      count,
    });
  }

  return {
    backtestId: data.request_id,
    pnlSummary: {
      roi:         parseFloat(data.pnl_summary?.roi_percent ?? '0'),
      maxDrawdown: 0,  // Not yet computed by the Go engine
      totalFees:   parseFloat(data.pnl_summary?.total_fees  ?? '0'),
    },
    safetyOrderUsage,
    tradeEvents,
  };
}