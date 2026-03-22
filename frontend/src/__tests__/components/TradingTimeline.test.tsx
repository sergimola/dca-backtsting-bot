/**
 * TradingTimeline Tests
 * Feature 012 — US8
 *
 * mockTimeline fixture:
 * Initial Injection $1000 (Dec 31) → equity 1000.00
 * Trade #1 +45.50 (Jan 6)          → equity 1045.50
 * DEPOSIT $250 (Feb 1)             → equity 1295.50
 * Trade #2 -12.25 (Feb 14)         → equity 1283.25
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { TradingTimeline } from '../components/TradingTimeline'
import type { TradeEvent, TradeGroupMetrics } from '../services/types'

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makeTradeEvent(
  overrides: Partial<TradeEvent> & Pick<TradeEvent, 'eventType' | 'rawTimestamp' | 'trade_id'>
): TradeEvent {
  return {
    timestamp: overrides.rawTimestamp,
    rawTimestamp: overrides.rawTimestamp,
    price: 0,
    quantity: 0,
    balance: 0,
    fee: 0,
    ...overrides,
  }
}

/** * Fixture with initialBalance=1000, 1 DEPOSIT card, and 2 closed trade cards. 
 * The equity trail is: 1000 → 1045.50 → 1295.50 → 1283.25 
 */
function mockTimeline(): {
  tradeEvents: TradeEvent[]
  tradeGroups: TradeGroupMetrics[]
  initialBalance: number
  maxOrders: number
  startDate: string
} {
  const trade1Id = 'trade-001'
  const trade2Id = 'trade-002'

  const tradeEvents: TradeEvent[] = [
    // Trade #1 events
    makeTradeEvent({
      eventType: 'ENTRY',
      rawTimestamp: '2025-01-02T00:00:00Z',
      trade_id: trade1Id,
      price: 95000,
      quantity: 0.001,
      balance: -95,
      fee: 0.095,
    }),
    makeTradeEvent({
      eventType: 'EXIT',
      rawTimestamp: '2025-01-06T00:00:00Z',
      trade_id: trade1Id,
      price: 98000,
      quantity: 0.001,
      balance: 45.5,
      fee: 0.098,
    }),
    // Injection #2 (DEPOSIT)
    makeTradeEvent({
      eventType: 'DEPOSIT',
      rawTimestamp: '2025-02-01T00:00:00Z',
      trade_id: 'deposit',
      balance: 250,
    }),
    // Trade #2 events
    makeTradeEvent({
      eventType: 'ENTRY',
      rawTimestamp: '2025-02-10T00:00:00Z',
      trade_id: trade2Id,
      price: 95000,
      quantity: 0.001,
      balance: -95,
      fee: 0.095,
    }),
    makeTradeEvent({
      eventType: 'SAFETY_ORDER',
      rawTimestamp: '2025-02-11T00:00:00Z',
      trade_id: trade2Id,
      price: 92000,
      quantity: 0.002,
      balance: -184,
      fee: 0.184,
    }),
    makeTradeEvent({
      eventType: 'EXIT',
      rawTimestamp: '2025-02-14T00:00:00Z',
      trade_id: trade2Id,
      price: 93500,
      quantity: 0.003,
      balance: -12.25,
      fee: 0.28,
    }),
  ]

  const tradeGroups: TradeGroupMetrics[] = [
    {
      tradeId: trade1Id,
      events: tradeEvents.filter(e => e.trade_id === trade1Id),
      status: 'CLOSED',
      grossProfit: 45.5,
      totalFees: 0,
      netProfit: 45.5,
      durationHours: 96,
      mae: -0.01,
      maxCapitalDeployed: 95,
    },
    {
      tradeId: trade2Id,
      events: tradeEvents.filter(e => e.trade_id === trade2Id),
      status: 'CLOSED',
      grossProfit: -12.25,
      totalFees: 0,
      netProfit: -12.25,
      durationHours: 96,
      mae: -0.03,
      maxCapitalDeployed: 279,
    },
  ]

  return { 
    tradeEvents, 
    tradeGroups, 
    initialBalance: 1000, 
    maxOrders: 10, 
    startDate: '2024-12-31T00:00:00Z' 
  }
}

/** Fixture with NO deposits — used for zero-injection tests */
function mockTimelineNoInjections(): {
  tradeEvents: TradeEvent[]
  tradeGroups: TradeGroupMetrics[]
  initialBalance: number
  maxOrders: number
  startDate: string
} {
  const { tradeEvents, tradeGroups, initialBalance, maxOrders, startDate } = mockTimeline();
  // Remove the DEPOSIT event, but keep initialBalance at 1000
  const filteredEvents = tradeEvents.filter(e => e.eventType !== 'DEPOSIT');
  
  // Slightly adjust profits so we can test different numbers
  tradeGroups[0].netProfit = 45.31;
  tradeGroups[1].netProfit = -12.44;

  return { tradeEvents: filteredEvents, tradeGroups, initialBalance, maxOrders, startDate };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TradingTimeline', () => {
  it('(1) renders exactly 2 capital injection cards and 2 trade cards in chronological order', () => {
    const { tradeEvents, tradeGroups, initialBalance, maxOrders, startDate } = mockTimeline()
    render(
      <TradingTimeline
        tradeEvents={tradeEvents}
        tradeGroups={tradeGroups}
        initialBalance={initialBalance}
        maxOrders={maxOrders}
        startDate={startDate}
      />
    )

    const injectionCards = screen.getAllByText('Capital Injection')
    const tradeCards = screen.getAllByText('Trade', { selector: 'span' })

    expect(injectionCards).toHaveLength(2)
    expect(tradeCards).toHaveLength(2)

    // Verify chronological order by DOM position
    const timeline = screen.getByTestId('trading-timeline')
    const items = Array.from(timeline.querySelectorAll('h4, span.text-slate-200')).filter(
      el => el.textContent === 'Capital Injection' || el.textContent === 'Trade'
    )
    
    expect(items[0]).toHaveTextContent('Capital Injection') // Initial Funding
    expect(items[1]).toHaveTextContent('Trade')             // Trade #1
    expect(items[2]).toHaveTextContent('Capital Injection') // DEPOSIT Event
    expect(items[3]).toHaveTextContent('Trade')             // Trade #2
  })

  it('(2) equity trail values equal 1000.00 / 1045.50 / 1295.50 / 1283.25 respectively', () => {
    const { tradeEvents, tradeGroups, initialBalance, maxOrders, startDate } = mockTimeline()
    render(
      <TradingTimeline
        tradeEvents={tradeEvents}
        tradeGroups={tradeGroups}
        initialBalance={initialBalance}
        maxOrders={maxOrders}
        startDate={startDate}
      />
    )

    const equityValues = screen.getAllByText(/^Equity:/)
    expect(equityValues).toHaveLength(4)
    expect(equityValues[0]).toHaveTextContent('Equity: $1,000.00')
    expect(equityValues[1]).toHaveTextContent('Equity: $1,045.50')
    expect(equityValues[2]).toHaveTextContent('Equity: $1,295.50')
    expect(equityValues[3]).toHaveTextContent('Equity: $1,283.25')
  })

  it('(3) expanding a trade card reveals an orders table with the correct columns and row count', async () => {
    const user = userEvent.setup()
    const { tradeEvents, tradeGroups, initialBalance, maxOrders, startDate } = mockTimeline()
    render(
      <TradingTimeline
        tradeEvents={tradeEvents}
        tradeGroups={tradeGroups}
        initialBalance={initialBalance}
        maxOrders={maxOrders}
        startDate={startDate}
      />
    )

    // Expand the second trade
    const tradeCards = screen.getAllByText('Trade', { selector: 'span' })
    await user.click(tradeCards[1])

    expect(screen.getByRole('table')).toBeInTheDocument()
    
    // Required columns
    expect(screen.getByText(/^time$/i)).toBeInTheDocument()
    expect(screen.getByText(/^action$/i)).toBeInTheDocument()
    expect(screen.getByText(/^price$/i)).toBeInTheDocument()
    expect(screen.getByText(/^quantity$/i)).toBeInTheDocument()
    
    // Rows include 1 header + 3 data rows
    const rows = screen.getAllByRole('row')
    expect(rows.length).toBeGreaterThanOrEqual(4)
  })

  it('(4) clicking an expanded trade card collapses it', async () => {
    const user = userEvent.setup()
    const { tradeEvents, tradeGroups, initialBalance, maxOrders, startDate } = mockTimeline()
    render(
      <TradingTimeline
        tradeEvents={tradeEvents}
        tradeGroups={tradeGroups}
        initialBalance={initialBalance}
        maxOrders={maxOrders}
        startDate={startDate}
      />
    )

    const tradeCards = screen.getAllByText('Trade', { selector: 'span' })
    
    // Open
    await user.click(tradeCards[0])
    expect(screen.getByRole('table')).toBeInTheDocument()

    // Close
    await user.click(tradeCards[0])
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('(5) with zero DEPOSIT events, it renders exactly 1 initial injection card and the trade cards', () => {
    const { tradeEvents, tradeGroups, initialBalance, maxOrders, startDate } = mockTimelineNoInjections()
    render(
      <TradingTimeline
        tradeEvents={tradeEvents}
        tradeGroups={tradeGroups}
        initialBalance={initialBalance}
        maxOrders={maxOrders}
        startDate={startDate}
      />
    )

    // The initial balance card MUST always render
    expect(screen.getAllByText('Capital Injection')).toHaveLength(1)
    expect(screen.getAllByText('Trade', { selector: 'span' })).toHaveLength(2)
  })

  it('(6) equity trail without deposits equals initialBalance + cumulative netProfit per trade', () => {
    const { tradeEvents, tradeGroups, initialBalance, maxOrders, startDate } = mockTimelineNoInjections()
    render(
      <TradingTimeline
        tradeEvents={tradeEvents}
        tradeGroups={tradeGroups}
        initialBalance={initialBalance}
        maxOrders={maxOrders}
        startDate={startDate}
      />
    )

    // initialBalance=1000
    // trade1.netProfit=45.31
    // trade2.netProfit=-12.44
    const equityValues = screen.getAllByText(/^Equity:/)
    expect(equityValues).toHaveLength(3)
    expect(equityValues[0]).toHaveTextContent('Equity: $1,000.00') // Initial card
    expect(equityValues[1]).toHaveTextContent('Equity: $1,045.31') // After Trade 1
    expect(equityValues[2]).toHaveTextContent('Equity: $1,032.87') // After Trade 2
  })
})