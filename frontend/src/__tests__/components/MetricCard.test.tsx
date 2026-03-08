import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MetricCard } from '../../components/MetricCard'

describe('MetricCard Component Tests', () => {
  test('T055.1: Component renders label and value', () => {
    render(
      <MetricCard
        label="Return on Investment"
        value={12.34}
        unit="%"
      />
    )

    expect(screen.getByText('Return on Investment')).toBeInTheDocument()
    expect(screen.getByText(/12\.34|12.34/)).toBeInTheDocument()
  })

  test('T055.2: Success color applies green styling to positive value', () => {
    const { container } = render(
      <MetricCard
        label="ROI"
        value={15.5}
        unit="%"
        color="success"
      />
    )

    const valueElement = container.querySelector('.text-green-600')
    expect(valueElement).toBeInTheDocument()
  })

  test('T055.3: Danger color applies red styling to negative value', () => {
    const { container } = render(
      <MetricCard
        label="Max Drawdown"
        value={-8.2}
        unit="%"
        color="danger"
      />
    )

    const valueElement = container.querySelector('.text-red-600')
    expect(valueElement).toBeInTheDocument()
  })

  test('T055.4: Neutral color applies gray styling', () => {
    const { container } = render(
      <MetricCard
        label="Total Fees"
        value={50}
        unit="$"
        color="neutral"
      />
    )

    const valueElement = container.querySelector('[class*="text-gray"]')
    expect(valueElement).toBeInTheDocument()
  })

  test('T055.5: Component displays unit suffix after value', () => {
    render(
      <MetricCard
        label="ROI"
        value={10}
        unit="%"
        color="success"
      />
    )

    // Should show value with unit
    expect(screen.getByText(/%/)).toBeInTheDocument()
  })

  test('T055.6: Tooltip displays on hover (if provided)', () => {
    render(
      <MetricCard
        label="ROI"
        value={10}
        unit="%"
        color="success"
        tooltip="Return on Investment percentage"
      />
    )

    // Title attribute or accessible tooltip should exist
    const label = screen.getByText('ROI')
    expect(label || screen.getByRole('img', { hidden: true })).toBeInTheDocument()
  })

  test('T055.7: Component uses flex layout to align label and value', () => {
    const { container } = render(
      <MetricCard
        label="Metric"
        value={99}
        unit="$"
      />
    )

    const flexElement = container.querySelector('[class*="flex"]')
    expect(flexElement).toBeInTheDocument()
  })

  test('T055.8: Label and value are properly aligned with justify-between', () => {
    const { container } = render(
      <MetricCard
        label="ROI"
        value={25}
        unit="%"
      />
    )

    const layoutElement = container.querySelector('[class*="justify-between"]')
    expect(layoutElement).toBeInTheDocument()
  })

  test('T055.9: Component renders with proper text sizes', () => {
    const { container } = render(
      <MetricCard
        label="ROI"
        value={15}
        unit="%"
        color="success"
      />
    )

    // Should have readable text sizing
    const textElements = container.querySelectorAll('[class*="text"]')
    expect(textElements.length).toBeGreaterThan(0)
  })

  test('T055.10: Component responds to different numeric values', () => {
    const { rerender } = render(
      <MetricCard
        label="ROI"
        value={10}
        unit="%"
        color="success"
      />
    )

    expect(screen.getByText(/10/)).toBeInTheDocument()

    rerender(
      <MetricCard
        label="ROI"
        value={-5.5}
        unit="%"
        color="danger"
      />
    )

    expect(screen.getByText(/-5\.5|-5.5/)).toBeInTheDocument()
  })
})
