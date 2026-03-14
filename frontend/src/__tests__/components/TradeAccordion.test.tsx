import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ResultsDashboard } from '../../components/ResultsDashboard'
import type { BacktestResults, TradeEvent } from '../../services/types'

function makeTradeEvent(partial: Partial<TradeEvent> & { trade_id: string }): TradeEvent {
  return {
    timestamp: '2024-01-01T10:00:00',
    rawTimestamp: '2024-01-01T10:00:00Z',
    eventType: 'ENTRY',
    price: 50000,
    quantity: 0.001,
    balance: 50,
    fee: 0,
    ...partial,
  }
}

function makeResults(events: TradeEvent[]): BacktestResults {
  return {
    backtestId: 'accordion-test',
    pnlSummary: { roi: 5.0, maxDrawdown: 0, totalFees: 0.75 },
    safetyOrderUsage: [],
    tradeEvents: events,
  }
}

describe('TradeAccordion — Gross/Net/Fees header (US2)', () => {
  const handlers = { onReset: jest.fn(), onModify: jest.fn() }

  it('T012: closed trade header shows Gross, Fees, Net labels with canonical spec values', () => {
    // Canonical test data from spec.md:
    // Net profit = 2.50, entryFee = 0.30, soFee = 0.25, exitFee = 0.20
    // Gross = Net + Fees = 2.50 + 0.75 = 3.25
    const results = makeResults([
      makeTradeEvent({ trade_id: '1', eventType: 'ENTRY',        fee: 0.30, balance: 50,   price: 50000, quantity: 0.001 }),
      makeTradeEvent({ trade_id: '1', eventType: 'SAFETY_ORDER', fee: 0.25, balance: 49,   price: 49000, quantity: 0.001 }),
      makeTradeEvent({ trade_id: '1', eventType: 'EXIT',         fee: 0.20, balance: 2.50, price: 51000, quantity: 0.002 }),
    ])

    render(<ResultsDashboard results={results} {...handlers} />)

    // After T015 the trade accordion button starts with "Trade #1" (not just UUID/number)
    // This query fails in the RED state (no "Trade #" in current header)
    const tradeButton = screen.getByRole('button', { name: /Trade #/i })
    expect(tradeButton).toHaveTextContent(/Gross:/)
    expect(tradeButton).toHaveTextContent(/Net:/)
    // Gross = 2.50 + 0.75 = 3.25
    expect(tradeButton).toHaveTextContent(/\+\$3\.25/)
    // Fees = 0.30 + 0.25 + 0.20 = 0.75
    expect(tradeButton).toHaveTextContent(/-\$0\.75/)
    // Net = 2.50
    expect(tradeButton).toHaveTextContent(/\+\$2\.50/)
  })

  it('T013: open trade (no EXIT event) shows "—" for both Gross and Net', () => {
    const results = makeResults([
      makeTradeEvent({ trade_id: '1', eventType: 'ENTRY', fee: 0.30, balance: 50, price: 50000, quantity: 0.001 }),
    ])

    render(<ResultsDashboard results={results} {...handlers} />)

    // After T015 the button shows "Trade #1 Gross: — Fees: ... Net: —"
    // In RED state: no "Trade #" so query fails → test fails
    const tradeButton = screen.getByRole('button', { name: /Trade #/i })
    // Both Gross and Net must show "—" for open positions
    const dashCount = (tradeButton.textContent?.match(/—/g) ?? []).length
    expect(dashCount).toBeGreaterThanOrEqual(2)
  })
})

