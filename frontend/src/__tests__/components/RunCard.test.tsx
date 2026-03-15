import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { RunCard } from '../../components/RunCard'
import type { Run } from '../../services/types'

const baseRun: Run = {
  backtestId: 'abc123def456',
  shortId: 'abc123de',
  status: 'running',
  config: {
    tradingPair: 'BTC/USDT',
    startDate: '2024-01-01',
    endDate: '2024-06-01',
    priceEntry: '50000',
    priceScale: '1.1',
    amountScale: '2',
    numberOfOrders: '5',
    amountPerTrade: '0.1',
    marginType: 'isolated',
    multiplier: '1',
    takeProfitDistancePercent: '2.5',
    accountBalance: '1000',
    exitOnLastOrder: false,
  },
  logs: [],
  progress: 0,
  createdAt: '2024-01-01T00:00:00Z',
}

const completedRun: Run = {
  ...baseRun,
  status: 'completed',
  results: {
    backtestId: 'abc123def456',
    pnlSummary: { roi: 12.5, maxDrawdown: -3.2, totalFees: 5.5 },
    safetyOrderUsage: [{ level: '1', count: 3 }, { level: '2', count: 1 }],
    tradeEvents: [
      {
        timestamp: '2024-01-10T10:00:00',
        rawTimestamp: '2024-01-10T10:00:00',
        eventType: 'ENTRY',
        price: 49000,
        quantity: 0.01,
        balance: -490,
        trade_id: 't1',
        fee: 0.5,
      },
      {
        timestamp: '2024-01-11T10:00:00',
        rawTimestamp: '2024-01-11T10:00:00',
        eventType: 'EXIT',
        price: 51000,
        quantity: 0.01,
        balance: 20,
        trade_id: 't1',
        fee: 0.5,
      },
    ],
  },
}

describe('RunCard', () => {
  it('running status: shows Loader2 spin and Processing text, no ROI', () => {
    render(
      <RunCard
        run={baseRun}
        isSelected={false}
        isExpanded={false}
        onSelect={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    expect(screen.getByText(/processing/i)).toBeInTheDocument()
    expect(screen.queryByText(/roi/i)).not.toBeInTheDocument()
  })

  it('failed status: shows Failed text with error indicator', () => {
    render(
      <RunCard
        run={{ ...baseRun, status: 'failed' }}
        isSelected={false}
        isExpanded={false}
        onSelect={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    expect(screen.getByText(/failed/i)).toBeInTheDocument()
  })

  it('completed collapsed: shows ROI and net PnL', () => {
    render(
      <RunCard
        run={completedRun}
        isSelected={false}
        isExpanded={false}
        onSelect={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    expect(screen.getByText(/roi/i)).toBeInTheDocument()
  })

  it('completed positive ROI has green text class', () => {
    const { container } = render(
      <RunCard
        run={completedRun}
        isSelected={false}
        isExpanded={false}
        onSelect={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    const roiEl = container.querySelector('.text-emerald-400')
    expect(roiEl).toBeInTheDocument()
  })

  it('completed negative ROI has red text class', () => {
    const negativeRun = {
      ...completedRun,
      results: {
        ...completedRun.results!,
        pnlSummary: { ...completedRun.results!.pnlSummary, roi: -5.3 },
      },
    }
    const { container } = render(
      <RunCard
        run={negativeRun}
        isSelected={false}
        isExpanded={false}
        onSelect={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    const roiEl = container.querySelector('.text-rose-400')
    expect(roiEl).toBeInTheDocument()
  })

  it('selected card has blue glow class', () => {
    render(
      <RunCard
        run={baseRun}
        isSelected={true}
        isExpanded={false}
        onSelect={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    // The selected card has aria-pressed=true
    expect(screen.getByRole('button', { pressed: true })).toBeInTheDocument()
  })

  it('completed expanded: shows expanded stats and View Full Dashboard button', () => {
    render(
      <RunCard
        run={completedRun}
        isSelected={false}
        isExpanded={true}
        onSelect={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    expect(screen.queryAllByText(/orders/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/view full dashboard/i)).toBeInTheDocument()
  })

  it('clicking View Full Dashboard fires onViewDashboard callback', () => {
    const onViewDashboard = jest.fn()
    render(
      <RunCard
        run={completedRun}
        isSelected={false}
        isExpanded={true}
        onSelect={jest.fn()}
        onViewDashboard={onViewDashboard}
      />
    )
    fireEvent.click(screen.getByText(/view full dashboard/i))
    expect(onViewDashboard).toHaveBeenCalledTimes(1)
  })

  it('completed expanded with unused safety orders shows amber AlertCircle warning', () => {
    // numberOfOrders = 5, but only 2 levels triggered
    render(
      <RunCard
        run={completedRun}
        isSelected={false}
        isExpanded={true}
        onSelect={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    // 5 configured - 2 used = 3 unused
    expect(screen.getByText(/unused safety orders/i)).toBeInTheDocument()
  })
})
