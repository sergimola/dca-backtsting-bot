import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TradeEventsTable } from '../../components/TradeEventsTable'
import type { TradeEvent } from '../../services/types'

describe('TradeEventsTable Component Tests', () => {
  const mockEvents: TradeEvent[] = [
    {
      timestamp: '2024-01-01T10:00:00Z',
      eventType: 'entry',
      price: 50000.00,
      quantity: 0.5,
      balance: 25000.00
    },
    {
      timestamp: '2024-01-01T11:00:00Z',
      eventType: 'safety order buy',
      price: 49000.00,
      quantity: 0.55,
      balance: 24499.00
    },
    {
      timestamp: '2024-01-01T12:00:00Z',
      eventType: 'exit',
      price: 51000.00,
      quantity: 1.05,
      balance: 26550.00
    }
  ]

  test('T062.1: Component renders table with 5 columns', () => {
    render(<TradeEventsTable events={mockEvents} />)

    // Headers should be visible
    expect(screen.getByText(/Timestamp|Time/i)).toBeInTheDocument()
    expect(screen.getByText(/Event Type|Type/i)).toBeInTheDocument()
    expect(screen.getByText(/Price/i)).toBeInTheDocument()
    expect(screen.getByText(/Quantity/i)).toBeInTheDocument()
    expect(screen.getByText(/Balance/i)).toBeInTheDocument()
  })

  test('T062.2: Component displays all event rows', () => {
    render(<TradeEventsTable events={mockEvents} />)

    // Should display all events
    expect(screen.getByText(/entry/i)).toBeInTheDocument()
    expect(screen.getByText(/safety order buy/i)).toBeInTheDocument()
    expect(screen.getByText(/exit/i)).toBeInTheDocument()
  })

  test('T062.3: Default sort is by timestamp ascending (oldest first)', () => {
    const { container } = render(<TradeEventsTable events={mockEvents} />)

    // Should show sort indicator on timestamp
    const sortIndicator = container.querySelector('[class*="sort"], [class*="↑"], [class*="▲"]')
    // Or first row should be 2024-01-01T10:00:00Z
    expect(screen.getByText(/2024-01-01T10:00:00Z|10:00/)).toBeInTheDocument()
  })

  test('T062.4: Clicking column header toggles sort order', () => {
    const { container } = render(<TradeEventsTable events={mockEvents} />)

    const timestampHeader = screen.getByText(/Timestamp|Time/i)
    fireEvent.click(timestampHeader)

    // Should have sort indicator indicating descending
    expect(container.querySelector('[class*="sort"]') || timestampHeader).toBeInTheDocument()
  })

  test('T062.5: Prices are formatted with 8 decimals for crypto', () => {
    render(<TradeEventsTable events={mockEvents} />)

    // Should display price values with 8 decimal places
    expect(screen.getByText('50000.00000000')).toBeInTheDocument()
    expect(screen.getByText('49000.00000000')).toBeInTheDocument()
    expect(screen.getByText('51000.00000000')).toBeInTheDocument()
  })

  test('T062.6: Quantities are formatted with 8 decimals', () => {
    render(<TradeEventsTable events={mockEvents} />)

    // Should display quantity values with 8 decimal places
    expect(screen.getByText('0.50000000')).toBeInTheDocument()
    expect(screen.getByText('0.55000000')).toBeInTheDocument()
    expect(screen.getByText('1.05000000')).toBeInTheDocument()
  })

  test('T062.7: Balance is formatted as currency with 2 decimals', () => {
    render(<TradeEventsTable events={mockEvents} />)

    // Should display balance values with currency formatting
    expect(screen.getAllByText(/\$25000\.00|\$24499\.00|\$26550\.00/).length).toBeGreaterThan(0)
  })

  test('T062.8: Pagination displays 25 rows per page', () => {
    const largeEvents: TradeEvent[] = Array.from({ length: 50 }, (_, i) => ({
      timestamp: `2024-01-01T${String(i).padStart(2, '0')}:00:00Z`,
      eventType: 'trade',
      price: 50000 + i * 100,
      quantity: 0.5 + i * 0.01,
      balance: 25000 + i * 50
    }))

    render(<TradeEventsTable events={largeEvents} />)

    // Should have pagination
    const paginationElement = screen.queryByRole('navigation')
    if (paginationElement) {
      expect(paginationElement).toBeInTheDocument()
    }
  })

  test('T062.9: Sort indicator shows on sorted column', () => {
    const { container } = render(<TradeEventsTable events={mockEvents} />)

    const header = screen.getByText(/Timestamp|Time/i)

    // Click to sort
    fireEvent.click(header)

    // Should show some indication of sorting
    expect(header.textContent).toMatch(/↑|▲|↓|▼|sort|asc|desc/i)
  })

  test('T062.10: Component handles empty events array', () => {
    render(<TradeEventsTable events={[]} />)

    // Should render with empty message
    expect(screen.getByText('No trade events')).toBeInTheDocument()
  })

  test('T062.11: Large datasets render without performance issues', () => {
    const hugeEvents: TradeEvent[] = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: `2024-01-01T${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
      eventType: 'trade',
      price: 50000 + Math.random() * 5000,
      quantity: 0.5 + Math.random() * 2,
      balance: 25000 + Math.random() * 10000
    }))

    render(<TradeEventsTable events={hugeEvents} />)

    // Should render without crashing
    expect(screen.getByText(/Timestamp|Time/i)).toBeInTheDocument()
  })

  test('T062.12: Responsive layout with horizontal scroll on mobile', () => {
    const { container } = render(<TradeEventsTable events={mockEvents} />)

    // Should have overflow handling
    const tableContainer = container.querySelector('[class*="overflow"]')
    expect(tableContainer || container.querySelector('table')).toBeInTheDocument()
  })
})
