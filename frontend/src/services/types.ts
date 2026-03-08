/**
 * TypeScript interfaces for DCA Backtesting Frontend
 */

/**
 * Configuration parameters for a backtest
 */
export interface BacktestConfiguration {
  entryPrice: number
  amounts: number[]
  sequences: number
  leverage: number
  marginRatio: number
}

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
}
