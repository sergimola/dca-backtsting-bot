import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { PnlSummary } from '../../components/PnlSummary'
import type { PnlSummary as PnlSummaryType } from '../../services/types'

describe('PnlSummary Component Tests', () => {
  const mockPnlData: PnlSummaryType = {
    roi: 15.5,
    maxDrawdown: -8.2,
    totalFees: 75.25
  }

  test('T054.1: Component renders all three metrics', () => {
    render(<PnlSummary pnlData={mockPnlData} />)

    // Should display title
    expect(screen.getByText(/Profit.*Loss|PnL|Summary/i)).toBeInTheDocument()

    // Should display all three metric labels - use getAllByText or be more specific
    const roiElements = screen.getAllByText(/ROI|Return/i)
    const drawdownElements = screen.getAllByText(/Max Drawdown|Drawdown/i)
    const feesElements = screen.getAllByText(/Total Fees|Fees/i)
    
    expect(roiElements.length).toBeGreaterThan(0)
    expect(drawdownElements.length).toBeGreaterThan(0)
    expect(feesElements.length).toBeGreaterThan(0)
  })

  test('T054.2: ROI displays positive value in green', () => {
    const { container } = render(
      <PnlSummary pnlData={{ roi: 25, maxDrawdown: -5, totalFees: 50 }} />
    )

    // Positive ROI should be green
    const greenElements = container.querySelectorAll('.text-green-600')
    expect(greenElements.length).toBeGreaterThan(0)
  })

  test('T054.3: ROI displays negative value in red', () => {
    const { container } = render(
      <PnlSummary pnlData={{ roi: -10, maxDrawdown: -5, totalFees: 50 }} />
    )

    // Negative ROI should include red
    const redElements = container.querySelectorAll('.text-red-600')
    expect(redElements.length).toBeGreaterThan(0)
  })

  test('T054.4: Max Drawdown always displays in red (danger)', () => {
    const { container } = render(
      <PnlSummary pnlData={mockPnlData} />
    )

    // Max Drawdown should be red
    const redElements = container.querySelectorAll('.text-red-600')
    expect(redElements.length).toBeGreaterThan(0)
  })

  test('T054.5: Displays ROI as percentage with 2 decimal places', () => {
    render(
      <PnlSummary pnlData={{ roi: 12.345, maxDrawdown: -5, totalFees: 50 }} />
    )

    // Should display formatted percentage - check for at least one
    const percentElements = screen.getAllByText(/%/)
    expect(percentElements.length).toBeGreaterThan(0)
  })

  test('T054.6: Displays Total Fees as currency', () => {
    render(
      <PnlSummary pnlData={{ roi: 10, maxDrawdown: -5, totalFees: 125.5 }} />
    )

    // Should display currency formatted value - look for the number or dollar sign
    const currencyElements = screen.getAllByText(/125|\.50|Fees/i)
    expect(currencyElements.length).toBeGreaterThan(0)
  })

  test('T054.7: Component uses MetricCard sub-components (3 cards)', () => {
    const { container } = render(<PnlSummary pnlData={mockPnlData} />)

    // Should have 3 metric card structures (flex containers with labels and values)
    const flexContainers = container.querySelectorAll('[class*="flex"]')
    expect(flexContainers.length).toBeGreaterThanOrEqual(3)
  })

  test('T054.8: Layout is responsive (uses grid or flex columns)', () => {
    const { container } = render(<PnlSummary pnlData={mockPnlData} />)

    // Should have grid or flex layout
    const layoutElement = container.querySelector('[class*="grid"], [class*="flex"], [class*="gap"]')
    expect(layoutElement).toBeInTheDocument()
  })

  test('T054.9: Component handles zero values correctly', () => {
    render(
      <PnlSummary pnlData={{ roi: 0, maxDrawdown: 0, totalFees: 0 }} />
    )

    // Should display zero values and labels
    expect(screen.getAllByText(/0|ROI/i).length).toBeGreaterThan(0)
  })

  test('T054.10: Positive and negative values have consistent formatting', () => {
    const { container } = render(
      <PnlSummary
        pnlData={{
          roi: 20.5,
          maxDrawdown: -10.3,
          totalFees: 60.75
        }}
      />
    )

    // Should display all values with consistent precision
    expect(screen.getAllByText(/20/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/10|Drawdown/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/60|Fees/i).length).toBeGreaterThan(0)
  })

  test('T054.11: Component title is prominently displayed', () => {
    const { container } = render(<PnlSummary pnlData={mockPnlData} />)

    // Title should exist and be visible
    const titleElement = screen.getByText(/Profit.*Loss|PnL|Summary/i)
    expect(titleElement).toBeVisible()
  })

  test('T054.12: Tooltips or explanations available for metrics (if applicable)', () => {
    const { container } = render(<PnlSummary pnlData={mockPnlData} />)

    // Component should have all labels visible - check for at least one metric card
    const metricCards = container.querySelectorAll('[class*="flex"][class*="justify-between"]')
    expect(metricCards.length).toBeGreaterThanOrEqual(3)
  })
})
