import React from 'react'
import type { TradeEvent } from '../services/types'
import { formatCurrency, formatCryptoQuantity, getEventPillClass } from '../services/formatters'

interface TradeOrdersTableProps {
  events: TradeEvent[]
}

export function TradeOrdersTable({ events }: TradeOrdersTableProps) {
  return (
    <div className="bg-[#080b14] overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="px-4 py-2 text-left text-[10px] uppercase tracking-widest text-slate-500">Time</th>
            <th className="px-4 py-2 text-left text-[10px] uppercase tracking-widest text-slate-500">Action</th>
            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-widest text-slate-500">Price</th>
            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-widest text-slate-500">Quantity</th>
            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-widest text-slate-500">Cost / PnL</th>
            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-widest text-slate-500">Fee Deducted</th>
          </tr>
        </thead>
        <tbody>
          {events.map((evt, i) => (
            <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
              <td className="px-4 py-1.5 text-slate-500">
                {new Date(evt.rawTimestamp || evt.timestamp).toLocaleString()}
              </td>
              <td className="px-4 py-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${getEventPillClass(evt.eventType)}`}>
                  {evt.eventType}
                </span>
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums text-slate-300">
                {formatCurrency(evt.price)}
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums text-slate-300">
                {formatCryptoQuantity(evt.quantity)}
              </td>
              <td className={`px-4 py-1.5 text-right tabular-nums ${evt.balance >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {formatCurrency(evt.balance)}
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums text-rose-400">
                {formatCurrency(evt.fee ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
