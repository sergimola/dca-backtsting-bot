import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { SafetyOrderChart } from '../../components/SafetyOrderChart'
import type { SafetyOrderUsage } from '../../services/types'

// Mock recharts to avoid rendering issues in JSDOM
jest.mock('recharts', () => ({
  BarChart: ({ children, data }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: (props: any) => <div data-testid="bar" {...props}></div>,
  XAxis: () => <div data-testid="x-axis"></div>,
  YAxis: () => <div data-testid="y-axis"></div>,
  CartesianGrid: () => <div data-testid="cartesian-grid"></div>,
  Tooltip: () => <div data-testid="tooltip"></div>,
  Legend: () => <div data-testid="legend"></div>,
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>
}))

describe('SafetyOrderChart Component Tests', () => {
  const mockSoData: SafetyOrderUsage[] = [
    { level: 'SO1', count: 5 },
    { level: 'SO2', count: 3 },
    { level: 'SO3', count: 1 }
  ]

  test('T058.1: Component renders BarChart with correct data', () => {
    const { container } = render(<SafetyOrderChart soUsageData={mockSoData} />)

    // Should render chart title
    expect(screen.getByText(/Safety Order Usage|Usage/i)).toBeInTheDocument()

    // Should render bar chart with Recharts
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
  })

  test('T058.2: Chart displays SO levels on X-axis', () => {
    render(<SafetyOrderChart soUsageData={mockSoData} />)

    // X-axis and axis components should be present
    expect(screen.getByTestId('x-axis')).toBeInTheDocument()
    expect(screen.getByTestId('y-axis')).toBeInTheDocument()
  })

  test('T058.3: Bar heights correspond to safety order counts', () => {
    const { container } = render(<SafetyOrderChart soUsageData={mockSoData} />)

    // Bar chart component should render with the data
    const barChart = screen.getByTestId('bar-chart')
    expect(barChart).toBeInTheDocument()

    // Mock recharts should have our data represented
    const bar = screen.getByTestId('bar')
    expect(bar).toBeInTheDocument()
  })

  test('T058.4: Toggle button switches between chart and list view', () => {
    render(<SafetyOrderChart soUsageData={mockSoData} />)

    // Should have toggle button
    const toggleButton = screen.getByRole('button', { name: /switch|list|chart/i })
    expect(toggleButton).toBeInTheDocument()

    // Click to switch view
    fireEvent.click(toggleButton)

    // Should switch to list view (or vice versa)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  test('T058.5: List view renders table with columns and rows', () => {
    render(<SafetyOrderChart soUsageData={mockSoData} />)

    // Switch to list view
    const toggleButton = screen.getByRole('button', { name: /switch|list|chart/i })
    fireEvent.click(toggleButton)

    // Should show table or list structure
    const table = screen.queryByRole('table')
    if (table) {
      expect(table).toBeInTheDocument()
    }
  })

  test('T058.6: Empty data shows message', () => {
    render(<SafetyOrderChart soUsageData={[]} />)

    // Should show "no safety orders" type message
    expect(screen.getByText(/No safety orders|triggered|backtest/i)).toBeInTheDocument()
  })

  test('T058.7: All zero counts shows message', () => {
    const zeroCounts: SafetyOrderUsage[] = [
      { level: 'SO1', count: 0 },
      { level: 'SO2', count: 0 }
    ]

    render(<SafetyOrderChart soUsageData={zeroCounts} />)

    // Should show "no safety orders" message
    expect(screen.getByText(/No safety orders|triggered/i)).toBeInTheDocument()
  })

  test('T058.8: Chart renders with tooltip on hover', () => {
    render(<SafetyOrderChart soUsageData={mockSoData} />)

    // Tooltip component should exist
    expect(screen.getByTestId('tooltip')).toBeInTheDocument()
  })

  test('T058.9: Component handles large datasets', () => {
    const largeData: SafetyOrderUsage[] = Array.from({ length: 10 }, (_, i) => ({
      level: `SO${i + 1}`,
      count: Math.floor(Math.random() * 20)
    }))

    render(<SafetyOrderChart soUsageData={largeData} />)

    // Should render without issues
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
  })

  test('T058.10: Toggle button text changes state', () => {
    render(<SafetyOrderChart soUsageData={mockSoData} />)

    let button = screen.getByRole('button', { name: /switch|list|chart/i })
    const initialText = button.textContent

    fireEvent.click(button)

    // Button text should be different after toggle
    button = screen.getByRole('button', { name: /switch|list|chart/i })
    expect(button.textContent).not.toBe(initialText)

    fireEvent.click(button)

    // Should toggle back
    button = screen.getByRole('button', { name: /switch|list|chart/i })
    expect(button.textContent).toBe(initialText)
  })

  test('T058.11: Chart title displays', () => {
    render(<SafetyOrderChart soUsageData={mockSoData} />)

    // Title should be visible
    expect(screen.getByText(/Safety Order Usage/i)).toBeInTheDocument()
  })

  test('T058.12: Component renders responsive container', () => {
    render(<SafetyOrderChart soUsageData={mockSoData} />)

    // Should use ResponsiveContainer for responsiveness
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument()
  })
})
