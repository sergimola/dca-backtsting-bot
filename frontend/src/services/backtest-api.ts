import axios from 'axios';
import type { BacktestConfiguration, BacktestResults } from './types';

const API_BASE_URL = 'http://localhost:4000';

// In-memory cache to bridge the Long-Polling backend with the Polling frontend
const resultCache = new Map<string, any>();

function getHeaders() {
  return { 'Content-Type': 'application/json' };
}

export async function submitBacktest(config: BacktestConfiguration): Promise<{ backtestId: string }> {
  try {
    // 1. Translate Frontend camelCase to Backend strict snake_case
    const apiPayload = {
      entry_price: config.entryPrice.toFixed(8),
      amounts: config.amounts.map(a => a.toFixed(8)),
      // Backend expects sequences array to match amounts length (e.g., [0, 1, 2])
      sequences: config.amounts.map((_, i) => i), 
      leverage: config.leverage.toFixed(8),
      margin_ratio: (config.marginRatio / 100).toFixed(8), // 5% becomes 0.05
      market_data_csv_path: config.market_data_csv_path || './dummy_data.csv'
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

export async function getStatus(backtestId: string): Promise<{ status: 'pending' | 'completed' | 'failed' }> {
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