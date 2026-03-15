import React from 'react'
import { render, screen } from '@testing-library/react'
import { TradeOrdersTable } from '../../components/TradeOrdersTable'
import type { TradeEvent } from '../../services/types'

function makeEvent(overrides: Partial<TradeEvent>): TradeEvent {
  return {
    timestamp: '2025-01-15T10:00:00Z',
    rawTimestamp: '2025-01-15T10:00:00Z',
    eventType: 'ENTRY',
    price: 95000,
    quantity: 0.001,
    balance: -95.0,
    trade_id: 'trade-1',
    fee: 0.095,
    ...overrides,
  }
}

const events: TradeEvent[] = [
  makeEvent({ eventType: 'ENTRY', balance: -95.0 }),
  makeEvent({ eventType: 'SAFETY_ORDER', balance: -47.5, rawTimestamp: '2025-01-15T11:00:00Z' }),
  makeEvent({ eventType: 'EXIT', balance: 150.0, rawTimestamp: '2025-01-16T09:00:00Z' }),
]

describe('TradeOrdersTable', () => {
  it('renders column header: Time', () => {
    render(<TradeOrdersTable events={events} />)
    expect(screen.getByText('Time')).toBeInTheDocument()
  })

  it('renders column header: Action', () => {
    render(<TradeOrdersTable events={events} />)
    expect(screen.getByText('Action')).toBeInTheDocument()
  })

  it('renders column header: Price', () => {
    render(<TradeOrdersTable events={events} />)
    expect(screen.getByText('Price')).toBeInTheDocument()
  })

  it('renders column header: Quantity', () => {
    render(<TradeOrdersTable events={events} />)
    expect(screen.getByText('Quantity')).toBeInTheDocument()
  })

  it('renders column header: Cost / PnL', () => {
    render(<TradeOrdersTable events={events} />)
    expect(screen.getByText(/cost\s*\/\s*pnl/i)).toBeInTheDocument()
  })

  it('renders column header: Fee Deducted', () => {
    render(<TradeOrdersTable events={events} />)
    expect(screen.getByText(/fee deducted/i)).toBeInTheDocument()
  })

  it('ENTRY action cell has text-emerald-300 class', () => {
    const { container } = render(<TradeOrdersTable events={[makeEvent({ eventType: 'ENTRY' })]} />)
    const entryPill = container.querySelector('.text-emerald-300')
    expect(entryPill).toBeInTheDocument()
    expect(entryPill?.textContent).toBe('ENTRY')
  })

  it('SAFETY_ORDER action cell has text-slate-200 class', () => {
    const { container } = render(
      <TradeOrdersTable events={[makeEvent({ eventType: 'SAFETY_ORDER' })]} />
    )
    const soPill = container.querySelector('.text-slate-200')
    expect(soPill).toBeInTheDocument()
    expect(soPill?.textContent).toBe('SAFETY_ORDER')
  })

  it('EXIT action cell has text-rose-300 class', () => {
    const { container } = render(<TradeOrdersTable events={[makeEvent({ eventType: 'EXIT' })]} />)
    const exitPill = container.querySelector('.text-rose-300')
    expect(exitPill).toBeInTheDocument()
    expect(exitPill?.textContent).toBe('EXIT')
  })

  it('renders one row per event', () => {
    render(<TradeOrdersTable events={events} />)
    // 3 events → 3 data rows (excluding header row)
    const rows = screen.getAllByRole('row')
    // 1 header + 3 data rows
    expect(rows.length).toBe(4)
  })
})
