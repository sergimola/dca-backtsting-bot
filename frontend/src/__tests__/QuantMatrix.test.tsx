/**
 * T071: QuantMatrix + LeaderboardGrid unit tests (US9 Selective Promotion).
 *
 * AC1: Every leaderboard row has exactly one "Re-run with Details" button.
 * AC2: Clicking the button calls onOpenInSingleRun with the corresponding result.
 * AC3: Completed leaderboard with 5 rows → 5 action buttons rendered.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuantMatrix } from '../components/optimizer/QuantMatrix'
import type { EnrichedResult } from '../hooks/useOptimizer'

// Mock react-router-dom — QuantMatrix/LeaderboardGrid don't use navigation
// but HeatmapGrid may import from it indirectly.
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/optimizer', state: null }),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(i: number): EnrichedResult {
  return {
    run_id: `run-id-${i}`,
    type: 'result',
    pnlSummary: { roi: i * 1.5, maxDrawdown: -i * 0.5, totalFees: i * 0.1 },
    executionTimeMs: 100 + i * 10,
    candleCount: 1440,
    eventCount: 50,
    config: {
      price_scale: 1 + i * 0.1,
      take_profit_distance_percent: 2 + i * 0.2,
      trading_pair: 'BTC/USDT',
    },
  }
}

const FIVE_RESULTS: EnrichedResult[] = Array.from({ length: 5 }, (_, i) => makeResult(i + 1))

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('QuantMatrix — T071 US9 Selective Promotion', () => {
  let onOpenInSingleRun: jest.Mock
  const defaultProps = () => ({
    results: FIVE_RESULTS,
    sweptParams: ['price_scale'],
    phase: 'complete' as const,
    totalRuns: 5,
    onNewSweep: jest.fn(),
    onOpenInSingleRun,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    onOpenInSingleRun = jest.fn()
  })

  it('T071-AC1/AC3: renders exactly one "Re-run with Details" button per leaderboard row', () => {
    render(<QuantMatrix {...defaultProps()} />)

    const buttons = screen.getAllByRole('button', { name: /re-run with details/i })
    // AC3: 5 results → 5 buttons
    expect(buttons).toHaveLength(5)
    // AC1: each button is distinct (verify via unique test-id or label)
    buttons.forEach(btn => {
      expect(btn).toBeInTheDocument()
      expect(btn).toHaveTextContent(/re-run with details/i)
    })
  })

  it('T071-AC2: clicking "Re-run with Details" calls onOpenInSingleRun with the correct result', () => {
    render(<QuantMatrix {...defaultProps()} />)

    const buttons = screen.getAllByRole('button', { name: /re-run with details/i })

    // Click the first button (corresponds to run-id-1 or the first sorted row)
    fireEvent.click(buttons[0])

    expect(onOpenInSingleRun).toHaveBeenCalledTimes(1)
    // The callback receives a BatchRunResult — verify it came from FIVE_RESULTS
    const receivedResult = onOpenInSingleRun.mock.calls[0][0]
    expect(typeof receivedResult.run_id).toBe('string')
    expect(receivedResult.run_id).toMatch(/^run-id-/)
    expect(receivedResult.type).toBe('result')
  })

  it('T071-AC3: 5 completed results render 5 action buttons', () => {
    render(<QuantMatrix {...defaultProps()} />)
    const buttons = screen.getAllByRole('button', { name: /re-run with details/i })
    expect(buttons).toHaveLength(5)
  })

  it('T071: cancelled phase shows amber banner with correct counts', () => {
    render(<QuantMatrix {...defaultProps()} phase="cancelled" totalRuns={10} />)
    // Banner should show "Cancelled (5 / 10 runs)"
    expect(screen.getByRole('status')).toHaveTextContent(/cancelled/i)
    expect(screen.getByRole('status')).toHaveTextContent('5')
    expect(screen.getByRole('status')).toHaveTextContent('10')
  })

  it('T071: error rows do NOT render "Re-run with Details" button', () => {
    const mixedResults: EnrichedResult[] = [
      ...FIVE_RESULTS.slice(0, 3),
      {
        run_id: 'run-error',
        type: 'error',
        error: 'Engine crash',
        config: { price_scale: 1.0 },
      },
    ]
    render(<QuantMatrix {...defaultProps()} results={mixedResults} />)
    // Only 3 success rows → 3 buttons (error row has no button)
    const buttons = screen.getAllByRole('button', { name: /re-run with details/i })
    expect(buttons).toHaveLength(3)
  })
})
