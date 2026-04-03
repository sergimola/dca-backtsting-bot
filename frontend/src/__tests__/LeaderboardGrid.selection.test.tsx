import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { LeaderboardGrid } from '../components/optimizer/LeaderboardGrid'
import type { BatchRunResult } from '../hooks/useOptimizer'

function makeResult(id: string, roi: number): BatchRunResult {
  return {
    run_id: id,
    type: 'result',
    pnlSummary: { roi, maxDrawdown: 5, totalFees: 1 },
    executionTimeMs: 100,
    longest_trade_duration_ms: 3600000,
    max_safety_orders_used: 2,
    promoted_at: null,
  }
}

describe('LeaderboardGrid selection', () => {
  const results = [
    makeResult('aaa-111', 10),
    makeResult('bbb-222', 20),
    makeResult('ccc-333', 30),
    makeResult('ddd-444', 40),
    makeResult('eee-555', 50),
  ]

  it('selecting 3 rows sets selection count to 3 and toolbar shows "3 selected"', () => {
    const selected = new Set(['aaa-111', 'bbb-222', 'ccc-333'])
    render(
      <LeaderboardGrid
        results={results}
        selectedRunIds={selected}
        onToggleRunSelection={jest.fn()}
        onSelectAll={jest.fn()}
        onClearSelection={jest.fn()}
        onBatchPromote={jest.fn()}
      />
    )
    expect(screen.getByText('3 selected')).toBeInTheDocument()
  })

  it('Batch Promote button is hidden when no rows selected, visible when >= 1', () => {
    const { rerender } = render(
      <LeaderboardGrid
        results={results}
        selectedRunIds={new Set()}
        onToggleRunSelection={jest.fn()}
        onSelectAll={jest.fn()}
        onClearSelection={jest.fn()}
        onBatchPromote={jest.fn()}
      />
    )
    expect(screen.queryByText('Batch Promote to ClickHouse')).not.toBeInTheDocument()

    rerender(
      <LeaderboardGrid
        results={results}
        selectedRunIds={new Set(['aaa-111'])}
        onToggleRunSelection={jest.fn()}
        onSelectAll={jest.fn()}
        onClearSelection={jest.fn()}
        onBatchPromote={jest.fn()}
      />
    )
    expect(screen.getByText('Batch Promote to ClickHouse')).toBeInTheDocument()
  })

  it('header "select all" checkbox selects all visible rows', () => {
    const onSelectAll = jest.fn()
    render(
      <LeaderboardGrid
        results={results}
        selectedRunIds={new Set()}
        onToggleRunSelection={jest.fn()}
        onSelectAll={onSelectAll}
        onClearSelection={jest.fn()}
        onBatchPromote={jest.fn()}
      />
    )
    const checkboxes = screen.getAllByRole('checkbox')
    // First checkbox is the header "select all"
    fireEvent.click(checkboxes[0])
    expect(onSelectAll).toHaveBeenCalledWith(
      expect.arrayContaining(['aaa-111', 'bbb-222', 'ccc-333', 'ddd-444', 'eee-555'])
    )
  })

  it('clearSelection resets count to 0 and hides toolbar', () => {
    const onClearSelection = jest.fn()
    const { rerender } = render(
      <LeaderboardGrid
        results={results}
        selectedRunIds={new Set(['aaa-111', 'bbb-222'])}
        onToggleRunSelection={jest.fn()}
        onSelectAll={jest.fn()}
        onClearSelection={onClearSelection}
        onBatchPromote={jest.fn()}
      />
    )
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Clear'))
    expect(onClearSelection).toHaveBeenCalled()

    // After clearing, toolbar should be hidden
    rerender(
      <LeaderboardGrid
        results={results}
        selectedRunIds={new Set()}
        onToggleRunSelection={jest.fn()}
        onSelectAll={jest.fn()}
        onClearSelection={onClearSelection}
        onBatchPromote={jest.fn()}
      />
    )
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
  })
})
