import React, { useState } from 'react'
import type { TradeGroupMetrics } from '../services/types'
import { TradeAccordionHeader } from './TradeAccordionHeader'
import { TradeOrdersTable } from './TradeOrdersTable'

interface TradeAccordionProps {
  metrics: TradeGroupMetrics
}

export function TradeAccordion({ metrics }: TradeAccordionProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="border border-slate-800 rounded mb-2 overflow-hidden">
      <TradeAccordionHeader
        metrics={metrics}
        isOpen={isOpen}
        onToggle={() => setIsOpen(prev => !prev)}
      />
      {isOpen && (
        <div className="overflow-hidden transition-all">
          <TradeOrdersTable events={metrics.events} />
        </div>
      )}
    </div>
  )
}
