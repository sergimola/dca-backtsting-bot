import React from 'react'
import { render, screen } from '@testing-library/react'
import { SafetyOrderUsagePanel } from '../../components/SafetyOrderUsagePanel'
import type { SafetyOrderUsage } from '../../services/types'

const usage: SafetyOrderUsage[] = [
  { level: '1', count: 8 },
  { level: '2', count: 4 },
  { level: '3', count: 1 },
]

describe('SafetyOrderUsagePanel', () => {
  it('renders one row per entry in safetyOrderUsage', () => {
    render(<SafetyOrderUsagePanel safetyOrderUsage={usage} totalTrades={10} />)
    expect(screen.getByText('SO 1')).toBeInTheDocument()
    expect(screen.getByText('SO 2')).toBeInTheDocument()
    expect(screen.getByText('SO 3')).toBeInTheDocument()
  })

  it('renders the panel title', () => {
    render(<SafetyOrderUsagePanel safetyOrderUsage={usage} totalTrades={10} />)
    expect(screen.getByText(/safety order usage/i)).toBeInTheDocument()
  })

  it('each row fill bar has inline width style matching count/totalTrades * 100%', () => {
    const { container } = render(
      <SafetyOrderUsagePanel safetyOrderUsage={usage} totalTrades={10} />
    )
    const fillBars = container.querySelectorAll('[style]')
    // SO1: 8/10 = 80%, SO2: 4/10 = 40%, SO3: 1/10 = 10%
    const widths = Array.from(fillBars).map(el => (el as HTMLElement).style.width)
    expect(widths).toContain('80%')
    expect(widths).toContain('40%')
    expect(widths).toContain('10%')
  })

  it('clamps fill bar to 100% when count exceeds totalTrades', () => {
    const { container } = render(
      <SafetyOrderUsagePanel safetyOrderUsage={[{ level: '1', count: 15 }]} totalTrades={10} />
    )
    const fillBars = container.querySelectorAll('[style]')
    const widths = Array.from(fillBars).map(el => (el as HTMLElement).style.width)
    expect(widths).toContain('100%')
  })

  it('renders count/total fraction for each row', () => {
    render(<SafetyOrderUsagePanel safetyOrderUsage={[{ level: '1', count: 3 }]} totalTrades={5} />)
    expect(screen.getByText('3/5')).toBeInTheDocument()
  })

  it('renders empty message when safetyOrderUsage is empty', () => {
    render(<SafetyOrderUsagePanel safetyOrderUsage={[]} totalTrades={0} />)
    expect(screen.getByText(/no safety order data/i)).toBeInTheDocument()
  })
})
