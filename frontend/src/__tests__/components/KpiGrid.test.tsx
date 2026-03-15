import React from 'react'
import { render, screen } from '@testing-library/react'
import { KpiGrid } from '../../components/KpiGrid'
import type { DashboardMetrics } from '../../services/types'

const metrics: DashboardMetrics = {
  netProfit: 150.25,
  totalFees: 12.50,
  roi: 15.025,
  winRate: 66.67,
  profitFactor: 2.5,
  capitalUtilized: 48.0,
  maxDrawdown: -3.2,
  accountEquity: 1150.25,
  tradeGroups: [],
  safetyOrderUsage: [],
}

describe('KpiGrid', () => {
  it('renders all 8 KPI cards', () => {
    render(<KpiGrid metrics={metrics} />)
    const cards = document.querySelectorAll('[aria-label="kpi-card"]')
    expect(cards.length).toBe(8)
  })

  it('each card contains a Lucide icon element (svg)', () => {
    const { container } = render(<KpiGrid metrics={metrics} />)
    const cards = container.querySelectorAll('[aria-label="kpi-card"]')
    cards.forEach(card => {
      expect(card.querySelector('svg')).toBeTruthy()
    })
  })

  it('each value container has tabular-nums in className', () => {
    const { container } = render(<KpiGrid metrics={metrics} />)
    const tabularEls = container.querySelectorAll('.tabular-nums')
    expect(tabularEls.length).toBeGreaterThanOrEqual(8)
  })

  it('positive ROI card has green text class', () => {
    const { container } = render(<KpiGrid metrics={metrics} />)
    // ROI = 15.025 > 0 → emerald
    const greenROI = container.querySelector('.text-emerald-400')
    expect(greenROI).toBeInTheDocument()
  })

  it('negative ROI card has red text class', () => {
    const negMetrics = { ...metrics, roi: -5.0, netProfit: -50 }
    const { container } = render(<KpiGrid metrics={negMetrics} />)
    const redEl = container.querySelector('.text-rose-400')
    expect(redEl).toBeInTheDocument()
  })
})
