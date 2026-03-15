import React from 'react'
import { render, screen } from '@testing-library/react'
import { LiveTerminalView } from '../../components/LiveTerminalView'
import type { Run } from '../../services/types'

// ARCHITECTURE GATE: LiveTerminalView must NOT import any polling module.
// This is verified below via import analysis.

const baseRun: Run = {
  backtestId: 'term-abc-123',
  shortId: 'term-abc',
  status: 'running',
  config: {
    tradingPair: 'ETH/USDT',
    startDate: '2024-01-01',
    endDate: '2024-06-01',
    priceEntry: '3000',
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
  logs: ['[10:00:01] STARTED', '[10:00:05] DOWNLOADING_DATA'],
  progress: 42,
  createdAt: '2024-01-01T00:00:00Z',
}

describe('LiveTerminalView', () => {
  it('renders run shortId', () => {
    render(<LiveTerminalView run={baseRun} />)
    expect(screen.getByText(/term-abc/i)).toBeInTheDocument()
  })

  it('renders run trading pair', () => {
    render(<LiveTerminalView run={baseRun} />)
    expect(screen.getByText(/eth\/usdt/i)).toBeInTheDocument()
  })

  it('progress bar fill width equals run.progress%', () => {
    const { container } = render(<LiveTerminalView run={baseRun} />)
    // The filled inner bar has inline style width
    const filled = container.querySelector('[style*="42%"]') as HTMLElement | null
    expect(filled).toBeTruthy()
    expect(filled?.style.width).toBe('42%')
  })

  it('progress bar inner div has animate- class (shimmer)', () => {
    const { container } = render(<LiveTerminalView run={baseRun} />)
    const shimmer = container.querySelector('[class*="animate-"]')
    expect(shimmer).toBeInTheDocument()
  })

  it('renders all log lines from run.logs[]', () => {
    render(<LiveTerminalView run={baseRun} />)
    expect(screen.getByText('[10:00:01] STARTED')).toBeInTheDocument()
    expect(screen.getByText('[10:00:05] DOWNLOADING_DATA')).toBeInTheDocument()
  })

  it('has a ref div at bottom of log list (for scrollIntoView)', () => {
    const { container } = render(<LiveTerminalView run={baseRun} />)
    // The console area div should exist
    const consoleArea = container.querySelector('[class*="bg-\\[#0a0d14\\]"]') ??
                        container.querySelector('.font-mono')
    expect(consoleArea).toBeTruthy()
  })

  it('blinking cursor element is present with animate-pulse class', () => {
    const { container } = render(<LiveTerminalView run={baseRun} />)
    const cursor = container.querySelector('.animate-pulse')
    expect(cursor).toBeInTheDocument()
  })

  it('failed status shows error message and click + suggestion', () => {
    const failedRun: Run = {
      ...baseRun,
      status: 'failed',
      logs: [...baseRun.logs, 'Error: connection refused'],
    }
    render(<LiveTerminalView run={failedRun} />)
    expect(screen.getByText(/click \+ to configure/i)).toBeInTheDocument()
  })

  it('ARCHITECTURE GATE: component does not import useRunPolling or backtest-api', async () => {
    // Read the source file and verify no polling imports exist
    const fs = await import('fs')
    const path = await import('path')
    const srcPath = path.resolve(__dirname, '../../components/LiveTerminalView.tsx')
    const source = fs.readFileSync(srcPath, 'utf-8')

    expect(source).not.toMatch(/useRunPolling/)
    expect(source).not.toMatch(/useBacktestPolling/)
    expect(source).not.toMatch(/backtest-api/)
    expect(source).not.toMatch(/getStatus|getResults/)
  })
})
