import React from 'react'
import { render, screen } from '@testing-library/react'
import { DashboardView } from '../../components/DashboardView'
import type { Run, DashboardMetrics } from '../../services/types'

// Mock useResultsMetrics at module boundary (constitution gate 4)
jest.mock('../../hooks/useResultsMetrics')
import { useResultsMetrics } from '../../hooks/useResultsMetrics'
const mockUseResultsMetrics = useResultsMetrics as jest.MockedFunction<typeof useResultsMetrics>

const mockConfig = {
  tradingPair: 'BTC/USDT',
  startDate: '2025-01-01',
  endDate: '2025-03-12',
  priceEntry: '95000',
  priceScale: '1.05',
  amountScale: '1.5',
  numberOfOrders: '5',
  amountPerTrade: '0.1',
  marginType: 'cross' as const,
  multiplier: '1',
  takeProfitDistancePercent: '2.5',
  accountBalance: '1000',
  exitOnLastOrder: false,
}

const mockMetrics: DashboardMetrics = {
  netProfit: 150.25,
  totalFees: 12.50,
  roi: 15.025,
  winRate: 66.67,
  profitFactor: 2.5,
  capitalUtilized: 48.0,
  maxDrawdown: -3.2,
  accountEquity: 1150.25,
  tradeGroups: [
    {
      tradeId: 'alpha1-trade',
      events: [],
      status: 'CLOSED',
      grossProfit: 80.0,
      totalFees: 5.0,
      netProfit: 75.0,
      durationHours: 48,
      mae: -0.02,
      maxCapitalDeployed: 300,
    },
    {
      tradeId: 'beta12-trade',
      events: [],
      status: 'CLOSED',
      grossProfit: 70.0,
      totalFees: 7.0,
      netProfit: 63.0,
      durationHours: 72,
      mae: -0.015,
      maxCapitalDeployed: 280,
    },
  ],
  safetyOrderUsage: [
    { level: '1', count: 5 },
    { level: '2', count: 2 },
  ],
}

const completedRun: Run = {
  backtestId: 'bt-dashboard-001',
  shortId: 'DASH01',
  status: 'completed',
  config: mockConfig,
  results: {
    backtestId: 'bt-dashboard-001',
    pnlSummary: { roi: 15.025, maxDrawdown: -3.2, totalFees: 12.5 },
    safetyOrderUsage: mockMetrics.safetyOrderUsage,
    tradeEvents: [],
  },
  logs: [],
  progress: 100,
  createdAt: new Date().toISOString(),
}

describe('DashboardView', () => {
  beforeEach(() => {
    mockUseResultsMetrics.mockReturnValue(mockMetrics)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('renders DashboardHeader containing the run shortId', () => {
    render(<DashboardView run={completedRun} />)
    expect(screen.getByText(/DASH01/)).toBeInTheDocument()
  })

  it('renders 8 KPI cards', () => {
    const { container } = render(<DashboardView run={completedRun} />)
    const cards = container.querySelectorAll('[aria-label="kpi-card"]')
    expect(cards.length).toBe(8)
  })

  it('renders the Safety Order Usage panel', () => {
    render(<DashboardView run={completedRun} />)
    expect(screen.getByText(/safety order usage/i)).toBeInTheDocument()
  })

  it('renders the Configuration summary panel', () => {
    render(<DashboardView run={completedRun} />)
    // ConfigSummaryPanel renders DL with config label
    expect(screen.getByText(/BTC\/USDT/)).toBeInTheDocument()
  })

  it('renders correct number of TradeAccordion items', () => {
    render(<DashboardView run={completedRun} />)
    // 2 trade groups → 2 accordions with distinct first-6-char tradeId prefixes
    expect(screen.getByText(/#alpha1/i)).toBeInTheDocument()
    expect(screen.getByText(/#beta12/i)).toBeInTheDocument()
  })

  it('calls useResultsMetrics with run.results and run.config', () => {
    render(<DashboardView run={completedRun} />)
    expect(mockUseResultsMetrics).toHaveBeenCalledWith(completedRun.results, completedRun.config)
  })
})
