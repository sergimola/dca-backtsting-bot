/**
 * TradingTimeline — Feature 012 / US8
 *
 * Renders a vertical chronological timeline interleaving capital injection
 * events (DEPOSIT) and completed/open trades in a "Split Journey" layout.
 * Running equity is computed with decimal.js.
 */

import React, { useState, useMemo } from 'react'
import Decimal from 'decimal.js'
import type { TradeEvent, TradeGroupMetrics } from '../services/types'
import { formatCurrency } from '../services/formatters'

// --- FORMATTING UTILS ---
const formatCrypto = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(val);

const formatDateTimeShort = (iso: string) => {
  if (!iso) return '---';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}, ${d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
};

const formatDuration = (hours: number) => {
  if (!hours) return '---';
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  const m = Math.round((hours % 1) * 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

// --- DYNAMIC DARK THEMES ---
const getDurationTheme = (hours: number) => {
  if (!hours) return 'bg-slate-800 text-slate-400 border-slate-700';
  if (hours < 24) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'; 
  if (hours <= 120) return 'bg-amber-500/10 text-amber-400 border-amber-500/20'; 
  return 'bg-rose-500/10 text-rose-400 border-rose-500/20'; 
};

const getFillsTheme = (filled: number, max: number) => {
  if (!filled || !max) return 'bg-slate-800 text-slate-400 border-slate-700';
  if (filled <= 1) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (filled === max) return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  if (filled / max <= 0.5) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
};

const getActionPillStyle = (type: string, safetyIndex: number = 0) => {
  if (type === 'ENTRY') return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
  if (type === 'EXIT') return 'bg-slate-800 text-rose-400 border border-slate-700'; 
  const heatMap = [
    'bg-amber-400/10 text-amber-400 border border-amber-400/20',
    'bg-orange-500/10 text-orange-500 border border-orange-500/20',
    'bg-orange-600/10 text-orange-600 border border-orange-600/20',
    'bg-red-500/10 text-red-500 border border-red-500/20',
    'bg-rose-600/10 text-rose-500 border border-rose-600/20',
  ];
  return heatMap[Math.min(safetyIndex, heatMap.length - 1)];
};

// --- TYPES ---
interface InjectionItem {
  kind: 'injection'
  amount: Decimal
  rawTimestamp: string
  runningEquity: Decimal
}

interface TradeItem {
  kind: 'trade'
  tradeIndex: number
  tradeId: string
  events: TradeEvent[]
  status: 'CLOSED' | 'OPEN'
  netProfit: Decimal
  maxCapitalDeployed: number
  durationHours: number
  openTimestamp: string
  closeTimestamp: string
  fillCount: number
  rawTimestamp: string
  runningEquity: Decimal
}

type TimelineItem = InjectionItem | TradeItem

// --- SUB-COMPONENTS ---
function CapitalInjectionCard({ item }: { item: InjectionItem }) {
  return (
    <div className="bg-emerald-950/20 border border-emerald-900/50 rounded-xl p-5 flex justify-between items-center shadow-sm backdrop-blur-sm">
      <div>
        <h4 className="text-sm font-bold text-emerald-500 uppercase tracking-widest">Capital Injection</h4>
        <p className="text-sm text-slate-400 mt-1">{formatDateTimeShort(item.rawTimestamp)}</p>
      </div>
      <div className="text-right">
        <p className="text-xl font-bold text-emerald-400">+{formatCurrency(item.amount.toNumber())}</p>
        <p className="text-xs text-slate-500 font-medium mt-1">Equity: {formatCurrency(item.runningEquity.toNumber())}</p>
      </div>
    </div>
  )
}

function TradeOrdersDetail({ events }: { events: TradeEvent[] }) {
  let soCounter = 0;
  return (
    <div className="bg-[#05070a] rounded-b-xl border-t border-slate-800/80 overflow-x-auto shadow-inner">
      <table className="w-full text-left whitespace-nowrap">
        <thead className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800">
          <tr>
            <th className="px-6 py-4">Time</th>
            <th className="px-6 py-4">Action</th>
            <th className="px-6 py-4 text-right">Price</th>
            <th className="px-6 py-4 text-right">Quantity</th>
            <th className="px-6 py-4 text-right">Cost / PnL</th>
            <th className="px-6 py-4 text-right">Fee Deducted</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {events.map((ev, idx) => {
             const isSO = ev.eventType === 'SAFETY_ORDER';
             const currentSoIndex = isSO ? soCounter++ : 0;
             return (
              <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                <td className="px-6 py-3 text-slate-400 tabular-nums text-xs">{formatDateTimeShort(ev.rawTimestamp || ev.timestamp)}</td>
                <td className="px-6 py-3">
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-widest uppercase shadow-sm ${getActionPillStyle(ev.eventType, currentSoIndex)}`}>
                    {ev.eventType.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-6 py-3 text-right text-slate-300 tabular-nums text-xs">{formatCurrency(ev.price)}</td>
                <td className="px-6 py-3 text-right text-slate-400 tabular-nums text-xs">{formatCrypto(ev.quantity)}</td>
                <td className={`px-6 py-3 text-right tabular-nums text-xs font-bold ${ev.eventType === 'EXIT' ? (ev.balance >= 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-emerald-400'}`}>
                  {ev.eventType === 'EXIT' && ev.balance > 0 ? '+' : ''}{formatCurrency(ev.balance)}
                </td>
                <td className="px-6 py-3 text-right text-rose-500 tabular-nums text-xs">{formatCurrency(ev.fee ?? 0)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TradeSummaryCard({ item, maxOrders }: { item: TradeItem, maxOrders: number }) {
  const [isOpen, setIsOpen] = useState(false)
  const pnl = item.netProfit.toNumber()
  
  // For open trades, we might just show the fees as a small negative, or 0. 
  const pnlClass = item.status === 'OPEN' ? 'text-slate-400' : (pnl >= 0 ? 'text-emerald-400' : 'text-rose-500')

  return (
    <div className={`bg-[#0b0e14] rounded-xl shadow-md border hover:border-slate-600 transition-all overflow-hidden ${item.status === 'OPEN' ? 'border-blue-500/30' : 'border-slate-800'}`}>
      <div 
        className="flex justify-between items-start w-full p-5 cursor-pointer hover:bg-slate-800/30 transition-colors select-none" 
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="bg-slate-800 text-slate-300 text-[13px] font-bold px-2 py-0.5 rounded shadow-sm border border-slate-700">
              #{item.tradeIndex}
            </span>
            <span className="text-slate-200 font-bold mr-1 text-[15px]">Trade</span>
            
            {/* Dynamic Pills */}
            <span className={`px-2 py-0.5 rounded text-[13px] font-bold border shadow-sm ${getDurationTheme(item.durationHours)}`}>
              {formatDuration(item.durationHours)}
            </span>
            <span className={`px-2 py-0.5 rounded text-[13px] font-bold border shadow-sm ${getFillsTheme(item.fillCount, maxOrders)}`}>
              {item.fillCount}/{maxOrders}
            </span>
            <span className="px-2 py-0.5 rounded text-[13px] font-bold border shadow-sm bg-blue-500/10 text-blue-400 border-blue-500/20">
              {formatCurrency(item.maxCapitalDeployed)}
            </span>
            
            {item.status === 'OPEN' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white shadow-sm ml-2 uppercase tracking-wider">
                Open
              </span>
            )}
          </div>
          
          {/* Start and End Dates */}
          <div className="text-slate-400 text-[13px] font-medium flex items-center gap-2 mt-1">
            <span>{formatDateTimeShort(item.openTimestamp)}</span>
            <span className="text-slate-600">&rarr;</span>
            <span>{item.status === 'CLOSED' ? formatDateTimeShort(item.closeTimestamp) : 'Ongoing'}</span>
          </div>
        </div>
        
        {/* PnL and Equity */}
        <div className="flex flex-col items-end pl-4">
          <span className={`text-[22px] font-bold tracking-tight leading-none ${pnlClass}`}>
            {pnl > 0 ? '+' : ''}{formatCurrency(pnl)}
          </span>
          <span className="text-[13px] font-medium text-slate-500 mt-1.5">
            Equity: {formatCurrency(item.runningEquity.toNumber())}
          </span>
        </div>
      </div>
      
      {/* Expanded Fills */}
      {isOpen && <TradeOrdersDetail events={item.events} />}
    </div>
  )
}

// --- MAIN TIMELINE COMPONENT ---
export interface TradingTimelineProps {
  tradeEvents: TradeEvent[]
  tradeGroups: TradeGroupMetrics[]
  initialBalance: number
  maxOrders: number
  startDate: string
}

export function TradingTimeline({ tradeEvents, tradeGroups, initialBalance, maxOrders, startDate }: TradingTimelineProps) {
  const timelineItems = useMemo<TimelineItem[]>(() => {
    
    // Safely parse a fallback time in case startDate from config is malformed
    const getSafeTime = (ts: string) => {
      const t = new Date(ts).getTime();
      return isNaN(t) ? 0 : t;
    };

    const firstEventTime = tradeEvents.length > 0 ? getSafeTime(tradeEvents[0].rawTimestamp || tradeEvents[0].timestamp) : Date.now();
    const configStartTime = getSafeTime(startDate);
    
    // Guarantee the initial funding is anchored *before* the first trade
    const effectiveStartTime = (configStartTime > 0 && configStartTime <= firstEventTime) 
      ? startDate 
      : new Date(firstEventTime - 1000).toISOString();

    // 1. Create the initial starting capital injection event
    const initialInjection: InjectionItem = {
      kind: 'injection',
      amount: new Decimal(initialBalance),
      rawTimestamp: effectiveStartTime, 
      runningEquity: new Decimal(0)
    };

    // 2. Map existing DEPOSIT events from the backtest
    const injectionItems: InjectionItem[] = [
      initialInjection,
      ...tradeEvents.filter(e => e.eventType === 'DEPOSIT').map(e => ({
        kind: 'injection' as const, 
        amount: new Decimal(e.balance), 
        rawTimestamp: e.rawTimestamp || e.timestamp, 
        runningEquity: new Decimal(0),
      }))
    ];

    // 3. Build trade items from ALL trade groups (including OPEN)
    let tradeIndex = 0
    const tradeItems: TradeItem[] = tradeGroups.map(tg => {
      tradeIndex++
      const entryEvents = tg.events.filter(e => e.eventType === 'ENTRY' || e.eventType === 'SAFETY_ORDER')
      const exitEvents = tg.events.filter(e => e.eventType === 'EXIT')
      
      const entryTimestamps = tg.events.filter(e => e.eventType === 'ENTRY').map(e => e.rawTimestamp || e.timestamp).filter(Boolean)
      const openTimestamp = entryTimestamps.length > 0 ? entryTimestamps.reduce((a, b) => (a < b ? a : b)) : (tg.events[0]?.rawTimestamp || tg.events[0]?.timestamp || '')
      
      const exitTimestamps = exitEvents.map(e => e.rawTimestamp || e.timestamp).filter(Boolean)
      const closeTimestamp = exitTimestamps.length > 0 ? exitTimestamps.reduce((a, b) => (a > b ? a : b)) : openTimestamp

      return {
        kind: 'trade', 
        tradeIndex, 
        tradeId: tg.tradeId, 
        events: tg.events, 
        status: tg.status,
        netProfit: new Decimal(tg.netProfit), 
        maxCapitalDeployed: tg.maxCapitalDeployed, 
        durationHours: tg.durationHours,
        openTimestamp, 
        closeTimestamp, 
        fillCount: entryEvents.length, 
        rawTimestamp: openTimestamp, 
        runningEquity: new Decimal(0),
      }
    })

    // 4. Sort everything chronologically (Injections resolve ties by going first)
    const allItems = [...injectionItems, ...tradeItems].sort((a, b) => {
      const timeA = getSafeTime(a.rawTimestamp);
      const timeB = getSafeTime(b.rawTimestamp);
      if (timeA === timeB) return a.kind === 'injection' ? -1 : 1;
      return timeA - timeB;
    });
    
    // 5. Compute the running equity trail using decimal.js
    let equity = new Decimal(0) 
    for (const item of allItems) {
      if (item.kind === 'injection') {
        equity = equity.plus(item.amount)
      } else if (item.status === 'CLOSED') {
        // Only CLOSED trades permanently alter the realized running equity trail
        equity = equity.plus(item.netProfit)
      }
      item.runningEquity = equity
    }
    
    return allItems
  }, [tradeEvents, tradeGroups, initialBalance, startDate])

  if (timelineItems.length === 0) return null

  return (
    <div className="p-6" data-testid="trading-timeline">
      <h2 className="text-xs uppercase tracking-widest text-slate-500 mb-8 font-bold">Capital Timeline</h2>
      
      <div className="max-w-6xl mx-auto relative">
        {/* The Center Spine */}
        <div className="absolute left-1/2 top-4 bottom-4 w-px bg-slate-800 -translate-x-1/2 hidden md:block"></div>
        
        <div className="space-y-8">
          {timelineItems.map((item, index) => {
            // STRICT ALLOCATION: Injections on Left, Trades on Right
            const isLeft = item.kind === 'injection';
            const dotColor = item.kind === 'injection' 
              ? 'bg-emerald-500' 
              : (item.status === 'OPEN' ? 'bg-blue-500' : (item.netProfit.gte(0) ? 'bg-slate-400' : 'bg-rose-500'))
            
            return (
              <div key={index} className={`relative flex items-center ${isLeft ? 'md:justify-start' : 'md:justify-end'} w-full`}>
                
                {/* The Timeline Dot */}
                <div className={`hidden md:block absolute left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-[#05070a] z-10 ${dotColor}`} />
                
                {/* The Card Container (50% width on large screens) */}
                <div className={`w-full md:w-[calc(50%-2.5rem)] z-20`}>
                  {item.kind === 'injection' 
                    ? <CapitalInjectionCard item={item} /> 
                    : <TradeSummaryCard item={item} maxOrders={maxOrders} />
                  }
                </div>

              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}