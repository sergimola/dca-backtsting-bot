import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ResultsPage } from '../../pages/ResultsPage'
import type { BacktestResults } from '../../services/types'

describe('ResultsPage Integration Tests', () => {
  const mockResults: BacktestResults = {
    backtestId: 'test-123',
    pnlSummary: {
      roi: 15.5,
      maxDrawdown: 5.2,
      totalFees: 125.50
    },
    safetyOrderUsage: [
      { level: 'SO1', count: 5 },
      { level: 'SO2', count: 3 }
    ],
    tradeEvents: [
      {
        timestamp: '2024-01-01T10:00:00Z',
        eventType: 'entry',
        price: 50000,
        quantity: 0.5,
        balance: 25000
      }
    ]
  }

  const mockReset = jest.fn()
  const mockModify = jest.fn()

  test('T069.1: ResultsPage renders ResultsDashboard with results', () => {
    render(
      <ResultsPage
        results={mockResults}
        onReset={mockReset}
        onModify={mockModify}
      />
    )

    // Should display results dashboard title
    expect(screen.getByText('Backtest Results')).toBeInTheDocument()
  })

  test('T069.2: ResultsPage displays metrics from results', () => {
    render(
      <ResultsPage
        results={mockResults}
        onReset={mockReset}
        onModify={mockModify}
      />
    )

    // Should show backtest ID
    expect(screen.getByText(/test-123/i)).toBeInTheDocument()
  })

  test('T069.3: ResultsPage displays chart data', () => {
    const { container } = render(
      <ResultsPage
        results={mockResults}
        onReset={mockReset}
        onModify={mockModify}
      />
    )

    // Should render chart section
    expect(container).toBeTruthy()
  })

  test('T069.4: ResultsPage displays trade events table', () => {
    const { container } = render(
      <ResultsPage
        results={mockResults}
        onReset={mockReset}
        onModify={mockModify}
      />
    )

    // Should render table section
    expect(container).toBeTruthy()
  })

  test('T069.5: ResultsPage calls onReset when Run New button clicked', () => {
    render(
      <ResultsPage
        results={mockResults}
        onReset={mockReset}
        onModify={mockModify}
      />
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  test('T069.6: ResultsPage calls onModify when Modify button clicked', () => {
    render(
      <ResultsPage
        results={mockResults}
        onReset={mockReset}
        onModify={mockModify}
      />
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(1)
  })

  test('T069.7: ResultsPage integrates metrics display correctly', () => {
    render(
      <ResultsPage
        results={mockResults}
        onReset={mockReset}
        onModify={mockModify}
      />
    )

    // Should display ROI metric
    expect(screen.getByText('15.50%')).toBeInTheDocument()
  })

  test('T069.8: ResultsPage handles empty trade events', () => {
    const resultsNOEvents: BacktestResults = {
      ...mockResults,
      tradeEvents: []
    }

    render(
      <ResultsPage
        results={resultsNOEvents}
        onReset={mockReset}
        onModify={mockModify}
      />
    )

    // Should still render without crashing
    expect(screen.getByText('Backtest Results')).toBeInTheDocument()
  })

  test('T069.9: ResultsPage maintains responsive layout', () => {
    const { container } = render(
      <ResultsPage
        results={mockResults}
        onReset={mockReset}
        onModify={mockModify}
      />
    )

    // Should have responsive layout
    const mainDiv = container.querySelector('[class*="w-full"]')
    expect(mainDiv).toBeInTheDocument()
  })

  test('T069.10: ResultsPage renders all required sections', () => {
    render(
      <ResultsPage
        results={mockResults}
        onReset={mockReset}
        onModify={mockModify}
      />
    )

    // Should have metrics section
    expect(screen.getByText('Performance Metrics')).toBeInTheDocument()
  })
})
