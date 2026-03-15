import React from 'react'
import type { BacktestFormState } from '../services/types'

const LABELS: Record<string, string> = {
  tradingPair: 'Trading Pair',
  startDate: 'Start Date',
  endDate: 'End Date',
  priceEntry: 'Entry Price',
  priceScale: 'Price Scale',
  amountScale: 'Amount Scale',
  numberOfOrders: 'Safety Orders',
  amountPerTrade: 'Amount / Trade',
  marginType: 'Margin Type',
  multiplier: 'Multiplier',
  takeProfitDistancePercent: 'Take Profit %',
  accountBalance: 'Account Balance',
  exitOnLastOrder: 'Exit on Last Order',
}

interface ConfigSummaryPanelProps {
  config: BacktestFormState
}

export function ConfigSummaryPanel({ config }: ConfigSummaryPanelProps) {
  return (
    <div className="bg-[#0d1117] border border-slate-800 rounded p-4">
      <h3 className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
        Configuration
      </h3>
      <dl className="space-y-1.5">
        {(Object.keys(LABELS) as (keyof BacktestFormState)[]).map(key => (
          <div key={key} className="flex justify-between gap-2 text-xs">
            <dt className="text-slate-500 shrink-0">{LABELS[key]}</dt>
            <dd className="text-slate-300 text-right truncate">
              {String(config[key])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
