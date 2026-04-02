import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { LeftSidebar } from '../../components/LeftSidebar'
import type { Run } from '../../services/types'
import type { SweepHistoryEntry } from '../../components/optimizer/SweepHistoryList'

// Mock react-router-dom to avoid ESM parse issues and Router context requirements.
const mockNavigate = jest.fn()
const mockPathname = { current: '/' }
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname.current }),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}))

const makeRun = (id: string, status: Run['status'] = 'running'): Run => ({
  backtestId: id,
  shortId: id.slice(0, 8),
  status,
  config: {
    tradingPair: 'BTC/USDT',
    startDate: '2024-01-01',
    endDate: '2024-06-01',
    priceEntry: '50000',
    priceScale: '1.1',
    amountScale: '2',
    numberOfOrders: '5',
    amountPerTrade: '0.1',
    marginType: 'isolated',
    multiplier: '1',
    takeProfitDistancePercent: '2.5',
    accountBalance: '1000',
    exitOnLastOrder: false,
  },
  logs: [],
  progress: 0,
  createdAt: '2024-01-01T00:00:00Z',
})

const makeSweepEntry = (id: string): SweepHistoryEntry => ({
  id,
  tradingPair: 'BTC/USDC',
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  totalRuns: 120,
  maxRoi: 14.3,
  status: 'completed',
  createdAt: '2025-01-31T12:00:00Z',
})

const defaultProps = {
  runs: [],
  selectedRunId: null,
  onNewBacktest: jest.fn(),
  onSelectRun: jest.fn(),
  onViewDashboard: jest.fn(),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPathname.current = '/'
})

describe('LeftSidebar', () => {
  it('renders QuantDCA header and + button', () => {
    render(<LeftSidebar {...defaultProps} />)
    expect(screen.getByText(/quantdca/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new backtest/i })).toBeInTheDocument()
  })

  it('clicking + fires onNewBacktest callback', () => {
    const onNewBacktest = jest.fn()
    render(<LeftSidebar {...defaultProps} onNewBacktest={onNewBacktest} />)
    fireEvent.click(screen.getByRole('button', { name: /new backtest/i }))
    expect(onNewBacktest).toHaveBeenCalledTimes(1)
  })

  it('renders one RunCard per run in runs[]', () => {
    const runs = [makeRun('run-aaa'), makeRun('run-bbb'), makeRun('run-ccc')]
    render(<LeftSidebar {...defaultProps} runs={runs} />)
    expect(screen.getAllByText(/processing/i)).toHaveLength(3)
  })

  it('correct RunCard has isSelected=true for the selectedRunId', () => {
    const runs = [makeRun('selected-run'), makeRun('other-run')]
    render(
      <LeftSidebar
        {...defaultProps}
        runs={runs}
        selectedRunId="selected-run"
      />
    )
    const pressedCards = screen.getAllByRole('button', { pressed: true })
    expect(pressedCards.length).toBeGreaterThan(0)
  })

  // T041 US1 AC1–AC6: collapse/expand, nav, content switching

  it('(AC1) defaults expanded: aside has w-80 class', () => {
    const { container } = render(<LeftSidebar {...defaultProps} />)
    const aside = container.querySelector('aside')
    expect(aside).toHaveClass('w-80')
  })

  it('(AC2) click collapse button → aside switches to w-14', () => {
    const { container } = render(<LeftSidebar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    const aside = container.querySelector('aside')
    expect(aside).toHaveClass('w-14')
  })

  it('(AC3) click expand button (after collapse) → aside returns to w-80', () => {
    const { container } = render(<LeftSidebar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    fireEvent.click(screen.getByRole('button', { name: /expand sidebar/i }))
    const aside = container.querySelector('aside')
    expect(aside).toHaveClass('w-80')
  })

  it('(AC4) clicking Optimizer tab calls navigate("/optimizer")', () => {
    render(<LeftSidebar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /^optimizer$/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/optimizer')
  })

  it('(AC5) shows sweep history list in Optimizer mode when expanded', () => {
    mockPathname.current = '/optimizer'
    const history = [makeSweepEntry('sweep-1'), makeSweepEntry('sweep-2')]
    render(<LeftSidebar {...defaultProps} sweepHistory={history} />)
    expect(screen.getAllByText(/btc\/usdc/i).length).toBeGreaterThanOrEqual(2)
  })

  it('(AC6) shows empty state message when no sweeps in Optimizer mode', () => {
    mockPathname.current = '/optimizer'
    render(<LeftSidebar {...defaultProps} sweepHistory={[]} />)
    expect(screen.getByText(/no sweeps yet/i)).toBeInTheDocument()
  })
})
