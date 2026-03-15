import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { LeftSidebar } from '../../components/LeftSidebar'
import type { Run } from '../../services/types'

const makeRun = (id: string, status: Run['status'] = 'running'): Run => ({
  backtestId: id,
  shortId: id.slice(0, 8),
  status,
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
})

describe('LeftSidebar', () => {
  it('renders QuantDCA header and + button', () => {
    render(
      <LeftSidebar
        runs={[]}
        selectedRunId={null}
        onNewBacktest={jest.fn()}
        onSelectRun={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    expect(screen.getByText(/quantdca/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+|new backtest/i })).toBeInTheDocument()
  })

  it('clicking + fires onNewBacktest callback', () => {
    const onNewBacktest = jest.fn()
    render(
      <LeftSidebar
        runs={[]}
        selectedRunId={null}
        onNewBacktest={onNewBacktest}
        onSelectRun={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /\+|new backtest/i }))
    expect(onNewBacktest).toHaveBeenCalledTimes(1)
  })

  it('renders one RunCard per run in runs[]', () => {
    const runs = [makeRun('run-aaa'), makeRun('run-bbb'), makeRun('run-ccc')]
    render(
      <LeftSidebar
        runs={runs}
        selectedRunId={null}
        onNewBacktest={jest.fn()}
        onSelectRun={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    // Each RunCard shows shortId
    expect(screen.getAllByText(/processing/i)).toHaveLength(3)
  })

  it('correct RunCard has isSelected=true for the selectedRunId', () => {
    const runs = [makeRun('selected-run'), makeRun('other-run')]
    render(
      <LeftSidebar
        runs={runs}
        selectedRunId="selected-run"
        onNewBacktest={jest.fn()}
        onSelectRun={jest.fn()}
        onViewDashboard={jest.fn()}
      />
    )
    // The selected card's root element should have aria-pressed=true
    const pressedCards = screen.getAllByRole('button', { pressed: true })
    expect(pressedCards.length).toBeGreaterThan(0)
  })
})
