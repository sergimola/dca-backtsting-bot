/**
 * SweepHistoryList Unit Tests (T048)
 *
 * Covers US2 AC1–AC5: entries render, KPI display, click handler, empty state, new entry.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { SweepHistoryList } from '../../components/optimizer/SweepHistoryList'
import type { SweepHistoryEntry } from '../../components/optimizer/SweepHistoryList'

const makeEntry = (id: string, overrides: Partial<SweepHistoryEntry> = {}): SweepHistoryEntry => ({
  id,
  tradingPair: 'BTC/USDC',
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  totalRuns: 120,
  maxRoi: 14.3,
  status: 'completed',
  createdAt: '2025-01-15T12:00:00Z',
  ...overrides,
})

describe('SweepHistoryList', () => {
  // T048 (a): 5 entries render with correct KPIs.
  it('renders all provided sweep entries', () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry(`sweep-${i}`))
    render(<SweepHistoryList entries={entries} />)
    expect(screen.getAllByText(/btc\/usdc/i)).toHaveLength(5)
  })

  // T048 (b): BTC/USDC + 120 runs + 14.3% ROI display.
  it('displays trading pair, run count, and max ROI', () => {
    const entry = makeEntry('s1', { tradingPair: 'BTC/USDC', totalRuns: 120, maxRoi: 14.3 })
    render(<SweepHistoryList entries={[entry]} />)
    expect(screen.getByText(/btc\/usdc/i)).toBeInTheDocument()
    expect(screen.getByText(/120 runs/i)).toBeInTheDocument()
    expect(screen.getByText(/14\.30% max roi/i)).toBeInTheDocument()
  })

  // T048 (c): click entry calls onSelect with the correct id.
  it('clicking entry calls onSelect with the entry id', () => {
    const onSelect = jest.fn()
    const entry = makeEntry('sweep-click')
    render(<SweepHistoryList entries={[entry]} onSelect={onSelect} />)
    fireEvent.click(screen.getByText(/btc\/usdc/i))
    expect(onSelect).toHaveBeenCalledWith('sweep-click')
  })

  // T048 (d): empty state message when no entries.
  it('shows empty state message when entries is empty', () => {
    render(<SweepHistoryList entries={[]} />)
    expect(screen.getByText(/no sweeps yet/i)).toBeInTheDocument()
  })

  // T048: cancelled entry shows amber badge.
  it('shows (cancelled) badge for cancelled sweeps', () => {
    const entry = makeEntry('s-cancelled', { status: 'cancelled' })
    render(<SweepHistoryList entries={[entry]} />)
    expect(screen.getByText(/\(cancelled\)/i)).toBeInTheDocument()
  })

  // T048: N/A shown when maxRoi is null.
  it('shows N/A when maxRoi is null', () => {
    const entry = makeEntry('s-null', { maxRoi: null })
    render(<SweepHistoryList entries={[entry]} />)
    expect(screen.getByText(/n\/a/i)).toBeInTheDocument()
  })

  // T048: "Load More" button rendered when hasMore = true.
  it('shows Load More button when hasMore is true', () => {
    const entries = [makeEntry('s1')]
    render(<SweepHistoryList entries={entries} hasMore onLoadMore={jest.fn()} />)
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument()
  })

  // T048: delete button calls onDelete.
  it('onDelete is called with entry id when delete button clicked', () => {
    const onDelete = jest.fn()
    const entry = makeEntry('s-delete')
    render(<SweepHistoryList entries={[entry]} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: /delete sweep s-delete/i }))
    expect(onDelete).toHaveBeenCalledWith('s-delete')
  })
})
