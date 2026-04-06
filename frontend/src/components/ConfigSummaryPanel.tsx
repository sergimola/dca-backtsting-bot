import React, { useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'
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
  monthlyAddition: 'Monthly Addition',
  exitOnLastOrder: 'Exit on Last Order',
  enable_wide_events: 'Wide Events',
  stopLossEnabled: 'Stop-Loss',
  stopLossPercent: 'SL Trigger %',
  stopLossBaseline: 'SL Baseline',
  stopLossTimeoutMinutes: 'SL Timeout (min)',
}

function formatValue(key: string, value: unknown): string {
  if (value == null || value === '') return '—'
  if (key === 'stopLossEnabled' || key === 'enable_wide_events' || key === 'exitOnLastOrder') {
    return value ? 'Yes' : 'No'
  }
  if (key === 'stopLossBaseline') {
    return value === 'first_entry' ? 'First Entry' : 'Avg Entries'
  }
  if (key === 'stopLossPercent') return `${value}%`
  if (key === 'stopLossTimeoutMinutes') return value === '0' || value === 0 ? 'Immediate' : `${value} min`
  return String(value)
}

interface ConfigSummaryPanelProps {
  config: BacktestFormState
}

export function ConfigSummaryPanel({ config }: ConfigSummaryPanelProps) {
  const slEnabled = config.stopLossEnabled
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(config, null, 2)).catch(() => { /* ignore */ })
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [config])

  return (
    <div className="bg-[#0d1117] border border-slate-800 rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] uppercase tracking-widest text-slate-500">
          Configuration
        </h3>
        <button
          onClick={handleCopy}
          title="Copy config — paste in New Run form"
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          {copied
            ? <><Check size={12} className="text-emerald-400" /><span className="text-emerald-400">Copied</span></>
            : <><Copy size={12} /><span>Copy</span></>}
        </button>
      </div>
      <dl className="space-y-1.5">
        {(Object.keys(LABELS) as (keyof BacktestFormState & string)[]).map(key => {
          // Skip SL detail rows when SL is disabled
          if (!slEnabled && (key === 'stopLossPercent' || key === 'stopLossBaseline' || key === 'stopLossTimeoutMinutes')) {
            return null
          }
          return (
            <div key={key} className="flex justify-between gap-2 text-xs">
              <dt className="text-slate-500 shrink-0">{LABELS[key]}</dt>
              <dd className="text-slate-300 text-right truncate">
                {formatValue(key, config[key as keyof BacktestFormState])}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
