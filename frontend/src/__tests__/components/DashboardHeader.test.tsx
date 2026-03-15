import React from 'react'
import { render, screen } from '@testing-library/react'
import { DashboardHeader } from '../../components/DashboardHeader'
import type { Run } from '../../services/types'

const completedRun: Run = {
  backtestId: 'hdr-test-001',
  shortId: 'hdr-test',
  status: 'completed',
  config: {
    tradingPair: 'BTC/USDT',
    startDate: '2024-01-01T00:00',
    endDate: '2024-03-12T00:00',
    priceEntry: '50000', priceScale: '1.1', amountScale: '2', numberOfOrders: '5',
    amountPerTrade: '0.1', marginType: 'isolated', multiplier: '1',
    takeProfitDistancePercent: '2.5', accountBalance: '1000', exitOnLastOrder: false,
  },
  logs: [],
  progress: 100,
  createdAt: '2024-01-01T00:00:00Z',
}

describe('DashboardHeader', () => {
  it('renders run short ID', () => {
    render(<DashboardHeader run={completedRun} />)
    expect(screen.getByText(/hdr-test/i)).toBeInTheDocument()
  })

  it('renders start date formatted as YYYY-MM-DD', () => {
    render(<DashboardHeader run={completedRun} />)
    expect(screen.getByText(/2024-01-01/)).toBeInTheDocument()
  })

  it('renders end date formatted as YYYY-MM-DD', () => {
    render(<DashboardHeader run={completedRun} />)
    expect(screen.getByText(/2024-03-12/)).toBeInTheDocument()
  })

  it('renders computed duration string', () => {
    render(<DashboardHeader run={completedRun} />)
    // Jan 1 to Mar 12 ~ 71 days
    expect(screen.getByText(/71 days/i)).toBeInTheDocument()
  })

  it('renders executionMs when provided', () => {
    render(<DashboardHeader run={completedRun} executionMs={1234} />)
    expect(screen.getByText(/1234/)).toBeInTheDocument()
  })

  it('does not render ms section when executionMs not provided', () => {
    render(<DashboardHeader run={completedRun} />)
    expect(screen.queryByText(/ms/i)).not.toBeInTheDocument()
  })
})
