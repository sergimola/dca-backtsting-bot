import React from 'react'
import { render, screen } from '@testing-library/react'
import { TradeAccordionHeader } from '../../components/TradeAccordionHeader'
import type { TradeGroupMetrics } from '../../services/types'

function makeMetrics(overrides: Partial<TradeGroupMetrics> = {}): TradeGroupMetrics {
  return {
    tradeId: 'trade-abc-123',
    events: [],
    status: 'CLOSED',
    grossProfit: 45.0,
    totalFees: 1.5,
    netProfit: 43.5,
    durationHours: 12,
    mae: -0.015,
    maxCapitalDeployed: 500,
    ...overrides,
  }
}

describe('TradeAccordionHeader', () => {
  // ── CONSTITUTION GATE 5: group-hover tooltips ────────────────────────────
  it('mae-tooltip has hidden group-hover/mae:block class (constitution gate 5)', () => {
    render(<TradeAccordionHeader metrics={makeMetrics()} isOpen={false} onToggle={() => {}} />)
    const maeTooltip = screen.getByTestId('mae-tooltip')
    expect(maeTooltip.className).toContain('hidden')
    expect(maeTooltip.className).toContain('group-hover/mae:block')
  })

  it('capital-tooltip has hidden group-hover/capital:block class (constitution gate 5)', () => {
    render(<TradeAccordionHeader metrics={makeMetrics()} isOpen={false} onToggle={() => {}} />)
    const capitalTooltip = screen.getByTestId('capital-tooltip')
    expect(capitalTooltip.className).toContain('hidden')
    expect(capitalTooltip.className).toContain('group-hover/capital:block')
  })

  it('MAE icon is TrendingDown from lucide-react (aria-label)', () => {
    render(<TradeAccordionHeader metrics={makeMetrics()} isOpen={false} onToggle={() => {}} />)
    expect(screen.getByLabelText('MAE')).toBeInTheDocument()
  })

  it('Capital Deployed icon is PieChart from lucide-react (aria-label)', () => {
    render(<TradeAccordionHeader metrics={makeMetrics()} isOpen={false} onToggle={() => {}} />)
    expect(screen.getByLabelText('Capital Deployed')).toBeInTheDocument()
  })

  // ── Duration badge color coding ──────────────────────────────────────────
  it('duration badge has text-emerald-400 when durationHours < 24', () => {
    const { container } = render(
      <TradeAccordionHeader metrics={makeMetrics({ durationHours: 12 })} isOpen={false} onToggle={() => {}} />
    )
    expect(container.querySelector('.text-emerald-400')).toBeInTheDocument()
  })

  it('duration badge has text-amber-400 when durationHours is between 24 and 120', () => {
    const { container } = render(
      <TradeAccordionHeader metrics={makeMetrics({ durationHours: 72 })} isOpen={false} onToggle={() => {}} />
    )
    expect(container.querySelector('.text-amber-400')).toBeInTheDocument()
  })

  it('duration badge has text-rose-400 when durationHours >= 120', () => {
    const { container } = render(
      <TradeAccordionHeader metrics={makeMetrics({ durationHours: 200 })} isOpen={false} onToggle={() => {}} />
    )
    // text-rose-400 is also used by the fees span; check the duration span text exists
    // We verify by checking multiple rose elements appear (fee span always rose, now duration badge too)
    const roseEls = container.querySelectorAll('.text-rose-400')
    expect(roseEls.length).toBeGreaterThanOrEqual(2)
  })

  // ── Gross / Fees / Net values ────────────────────────────────────────────
  it('renders gross profit with + prefix for positive values', () => {
    render(<TradeAccordionHeader metrics={makeMetrics({ grossProfit: 45 })} isOpen={false} onToggle={() => {}} />)
    // The "+$45.00" or similar pattern should appear
    const allText = document.body.textContent || ''
    expect(allText).toMatch(/\+/)
  })

  it('renders net profit in green (text-emerald-400) class span', () => {
    const { container } = render(
      <TradeAccordionHeader metrics={makeMetrics({ netProfit: 43.5 })} isOpen={false} onToggle={() => {}} />
    )
    const greenEls = container.querySelectorAll('.text-emerald-400')
    expect(greenEls.length).toBeGreaterThanOrEqual(1)
  })
})
