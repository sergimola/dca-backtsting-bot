/**
 * TypeScript interfaces for DCA Backtesting Frontend
 */

/**
 * Form state for the backtest configuration form.
 * All numeric input fields are strings to prevent JavaScript float coercion.
 * Matches the 13-field SDD §4.1 parameter set.
 */
export interface BacktestFormState {
  /** Trading pair, e.g. "BTC/USDT" */
  tradingPair: string
  /** Start date in ISO 8601 format "YYYY-MM-DD" */
  startDate: string
  /** End date in ISO 8601 format "YYYY-MM-DD" */
  endDate: string
  /** Entry price as decimal string, e.g. "50000.00" */
  priceEntry: string
  /** Price scale factor for DCA recurrence, e.g. "1.10" */
  priceScale: string
  /** Amount scale factor for DCA recurrence, e.g. "2.0" */
  amountScale: string
  /** Number of safety orders (integer >= 1) as string */
  numberOfOrders: string
  /** Fraction of account equity per trade, e.g. "0.10" */
  amountPerTrade: string
  /** Margin mode */
  marginType: 'cross' | 'isolated'
  /** Leverage multiplier (integer >= 1) as string */
  multiplier: string
  /** Take-profit distance in percent, e.g. "2.5" */
  takeProfitDistancePercent: string
  /** Account balance in USDT, e.g. "1000.00" */
  accountBalance: string
  /** End simulation when the last order fills */
  exitOnLastOrder: boolean
}

/** @deprecated Use BacktestFormState */
export type BacktestConfiguration = BacktestFormState

/**
 * Summary of profit/loss metrics
 */
export interface PnlSummary {
  roi: number
  maxDrawdown: number
  totalFees: number
}

/**
 * Safety order usage statistics by level
 */
export interface SafetyOrderUsage {
  level: string
  count: number
}

/**
 * Individual trade event record
 */
export interface TradeEvent {
  timestamp: string
  eventType: string
  price: number
  quantity: number
  balance: number
}

/**
 * Complete results from a completed backtest
 */
export interface BacktestResults {
  backtestId: string
  pnlSummary: PnlSummary
  safetyOrderUsage: SafetyOrderUsage[]
  tradeEvents: TradeEvent[]
}

/**
 * Status response from API
 */
export interface BacktestStatus {
  status: 'pending' | 'completed' | 'failed'
  error?: string
}
