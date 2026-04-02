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
  /** Monthly capital injection in USDT, e.g. "500.00" (empty string = no injection) */
  monthlyAddition: string
  /** End simulation when the last order fills */
  exitOnLastOrder: boolean
  /** Emit wide events for this run (enables full trade-event capture) */
  enable_wide_events?: boolean
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
  rawTimestamp: string
  eventType: string
  price: number
  quantity: number
  balance: number
  trade_id: string
  fee: number
}

/**
 * Complete results from a completed backtest
 */
export interface BacktestResults {
  backtestId: string
  pnlSummary: PnlSummary
  safetyOrderUsage: SafetyOrderUsage[]
  tradeEvents: TradeEvent[]
  executionTimeMs?: number
}

/**
 * Status response from API
 */
export interface BacktestStatus {
  status: 'pending' | 'completed' | 'failed'
  error?: string
}

// ---------------------------------------------------------------------------
// Multi-run state model (009-pro-quant-terminal-ui)
// ---------------------------------------------------------------------------

export type RunStatus = 'running' | 'completed' | 'failed'

export interface Run {
  backtestId: string          // backend-assigned, used as stable React key
  shortId: string             // first 8 chars of backtestId for display
  status: RunStatus
  config: BacktestFormState   // original 13-field parameter set
  results?: BacktestResults   // populated on completion; undefined while running/failed
  logs: string[]              // status messages accumulated during polling; append-only
  progress: number            // 0–100; owned by App.tsx, updated by RunPollingController
  createdAt: string           // ISO timestamp, set at run creation
}

export interface TradeGroupMetrics {
  tradeId: string
  events: TradeEvent[]
  status: 'CLOSED' | 'OPEN'
  grossProfit: number
  totalFees: number
  netProfit: number
  durationHours: number
  mae: number                  // Max Adverse Excursion (negative = adverse move during trade)
  maxCapitalDeployed: number
}

export interface DashboardMetrics {
  netProfit: number
  totalFees: number
  roi: number
  winRate: number
  profitFactor: number
  capitalUtilized: number
  maxDrawdown: number          // pass-through from pnlSummary
  accountEquity: number        // accountBalance + netProfit
  tradeGroups: TradeGroupMetrics[]
  safetyOrderUsage: SafetyOrderUsage[]
}
