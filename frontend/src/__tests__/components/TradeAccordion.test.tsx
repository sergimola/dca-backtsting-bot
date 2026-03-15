import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TradeAccordion } from '../../components/TradeAccordion'
import type { TradeGroupMetrics } from '../../services/types'

const metrics: TradeGroupMetrics = {
  tradeId: 'trade-abc-123',
  events: [
    {
      timestamp: '2025-01-15T10:00:00Z',
      rawTimestamp: '2025-01-15T10:00:00Z',
      eventType: 'ENTRY',
      price: 95000,
      quantity: 0.001,
      balance: -95.0,
      trade_id: 'trade-abc-123',
      fee: 0.095,
    },
    {
      timestamp: '2025-01-16T09:00:00Z',
      rawTimestamp: '2025-01-16T09:00:00Z',
      eventType: 'EXIT',
      price: 98000,
      quantity: 0.001,
      balance: 3.0,
      trade_id: 'trade-abc-123',
      fee: 0.098,
    },
  ],
  status: 'CLOSED',
  grossProfit: 3.0,
  totalFees: 0.193,
  netProfit: 2.807,
  durationHours: 23,
  mae: -0.01,
  maxCapitalDeployed: 95,
}

describe('TradeAccordion', () => {
  it('is collapsed by default — table not in DOM', () => {
    render(<TradeAccordion metrics={metrics} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('clicking header toggles accordion open', async () => {
    render(<TradeAccordion metrics={metrics} />)
    // Click anywhere on the header div (find the outermost group div)
    const headerDiv = screen.getByTestId('mae-tooltip').closest('div[class*="group relative flex"]')!
    await userEvent.click(headerDiv)
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('clicking header again collapses the accordion', async () => {
    render(<TradeAccordion metrics={metrics} />)
    const headerDiv = screen.getByTestId('mae-tooltip').closest('div[class*="group relative flex"]')!
    await userEvent.click(headerDiv)
    expect(screen.getByRole('table')).toBeInTheDocument()
    await userEvent.click(headerDiv)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('when open, TradeOrdersTable renders with all event rows', async () => {
    render(<TradeAccordion metrics={metrics} />)
    const headerDiv = screen.getByTestId('mae-tooltip').closest('div[class*="group relative flex"]')!
    await userEvent.click(headerDiv)
    const rows = screen.getAllByRole('row')
    // 1 header row + 2 event rows
    expect(rows.length).toBe(3)
  })
})

