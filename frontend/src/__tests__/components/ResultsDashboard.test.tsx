import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ResultsDashboard } from '../../components/ResultsDashboard'
import type { BacktestResults } from '../../services/types'

describe('ResultsDashboard Component Tests', () => {
  const mockResults: BacktestResults = {
    backtestId: 'test-123',
    pnlSummary: {
      roi: 15.5,
      maxDrawdown: 5.2,
      totalFees: 125.50
    },
    safetyOrderUsage: [
      { level: 'SO1', count: 5 },
      { level: 'SO2', count: 3 },
      { level: 'SO3', count: 1 }
    ],
    tradeEvents: [
      {
        timestamp: '2024-01-01T10:00:00Z',
        eventType: 'entry',
        price: 50000,
        quantity: 0.5,
        balance: 25000
      },
      {
        timestamp: '2024-01-01T11:00:00Z',
        eventType: 'exit',
        price: 51000,
        quantity: 0.5,
        balance: 26000
      }
    ]
  }

  const mockHandlers = {
    onReset: jest.fn(),
    onModify: jest.fn()
  }

  test('T066.1: Component renders all sub-components', () => {
    render(<ResultsDashboard results={mockResults} {...mockHandlers} />)

    // Should render metrics (PnlSummary)
    expect(screen.getByText('Performance Metrics')).toBeInTheDocument()

    // Should render chart area (SafetyOrderChart)
    expect(screen.getByText('Safety Order Usage')).toBeInTheDocument()

    // Should render table (TradeEventsTable)
    expect(screen.getByText('Trade Events')).toBeInTheDocument()
  })

  test('T066.2: Component renders Results Dashboard header', () => {
    render(<ResultsDashboard results={mockResults} {...mockHandlers} />)

    // Should show the main dashboard heading
    expect(screen.getByText('Backtest Results')).toBeInTheDocument()
    // Should show the backtest ID
    expect(screen.getByText('Backtest ID: test-123')).toBeInTheDocument()
  })

  test('T066.3: Component renders action buttons', () => {
    render(<ResultsDashboard results={mockResults} {...mockHandlers} />)

    // Should have the specific action buttons
    expect(screen.getByText('Run New Backtest')).toBeInTheDocument()
    expect(screen.getByText('Modify & Re-run')).toBeInTheDocument()
  })

  test('T066.4: Run New Backtest button triggers onReset callback', () => {
    const handlers = { onReset: jest.fn(), onModify: jest.fn() }
    render(<ResultsDashboard results={mockResults} {...handlers} />)

    fireEvent.click(screen.getByText('Run New Backtest'))
    expect(handlers.onReset).toHaveBeenCalledTimes(1)
  })

  test('T066.5: Modify & Re-run button triggers onModify callback', () => {
    const handlers = { onReset: jest.fn(), onModify: jest.fn() }
    render(<ResultsDashboard results={mockResults} {...handlers} />)

    fireEvent.click(screen.getByText('Modify & Re-run'))
    expect(handlers.onModify).toHaveBeenCalledTimes(1)
  })

  test('T066.6: PnlSummary receives correct props', () => {
    render(<ResultsDashboard results={mockResults} {...mockHandlers} />)

    // Should display ROI value effectively
    expect(screen.getByText('15.50%')).toBeInTheDocument()
  })

  test('T066.7: SafetyOrderChart receives correct props', () => {
    render(<ResultsDashboard results={mockResults} {...mockHandlers} />)

    // Switch to list view so data labels are visible in DOM
    fireEvent.click(screen.getByText(/Switch to List View/i))
    expect(screen.getByText('SO1')).toBeInTheDocument()
  })

  test('T066.8: TradeEventsTable receives correct props', () => {
    render(<ResultsDashboard results={mockResults} {...mockHandlers} />)

    // Should display trade events
    expect(screen.getByText('entry')).toBeInTheDocument()
  })

  test('T066.9: Layout is responsive grid', () => {
    const { container } = render(<ResultsDashboard results={mockResults} {...mockHandlers} />)

    // Should have grid or flex layout
    const mainContainer = container.querySelector('[class*="grid"], [class*="flex"]')
    expect(mainContainer).toBeInTheDocument()
  })

  test('T066.10: Empty safety orders handled gracefully', () => {
    const resultsWithNoSO: BacktestResults = {
      ...mockResults,
      safetyOrderUsage: []
    }

    render(<ResultsDashboard results={resultsWithNoSO} {...mockHandlers} />)

    // Header and metrics should still render
    expect(screen.getByText('Backtest Results')).toBeInTheDocument()
    expect(screen.getByText('Performance Metrics')).toBeInTheDocument()
  })
})
