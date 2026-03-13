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
    
    // Store the full result in memory so our faked polling endpoints can grab it
    resultCache.set(backtestId, response.data);

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

export async function getResults(backtestId: string): Promise<BacktestResults> {
  const data = resultCache.get(backtestId);
  if (!data) {
    throw new Error('Results not found in local cache');
  }

  // 2. Translate Backend snake_case response back to Frontend camelCase
  return {
    backtestId: data.request_id,
    pnlSummary: {
      roi: parseFloat(data.pnl_summary.roi_percent),
      maxDrawdown: 0, // Note: Max drawdown isn't calculated by the Go engine yet
      totalFees: parseFloat(data.pnl_summary.total_fees)
    },
    safetyOrderUsage: Object.entries(data.pnl_summary.safety_order_usage_counts || {}).map(([level, count]) => ({
      level: level,
      count: count as number
    })),
    tradeEvents: data.events.map((e: any) => ({
      timestamp: new Date(e.timestamp).toLocaleString(),
      eventType: e.action,
      price: parseFloat(e.fill_price),
      quantity: parseFloat(e.fill_quantity),
      balance: parseFloat(e.position_state.total_invested)
    }))
  };
}