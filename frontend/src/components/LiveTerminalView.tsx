import React, { useRef, useEffect } from 'react'
import { TerminalSquare } from 'lucide-react'
import type { Run } from '../services/types'

interface LiveTerminalViewProps {
  run: Run
}

// ARCHITECTURE: Dumb display component. Zero API calls. Zero polling hooks.
// All data flows in via the `run` prop managed by App.tsx + RunPollingController.
export function LiveTerminalView({ run }: LiveTerminalViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [run.logs.length])

  return (
    <div className="flex flex-col h-full p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <TerminalSquare className="w-5 h-5 text-blue-400" />
        <span className="font-mono text-sm text-slate-300">#{run.shortId}</span>
        <span className="text-xs text-slate-500">{run.config.tradingPair}</span>
      </div>

      {/* Progress bar */}
      <div className="relative h-1.5 w-full bg-slate-800 rounded-full overflow-hidden mb-4">
        <div
          className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all duration-500"
          style={{ width: `${run.progress}%` }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_1.5s_infinite]" />
        </div>
      </div>

      {/* Mac chrome dots */}
      <div className="flex gap-1.5 mb-2 px-3">
        <span className="w-3 h-3 rounded-full bg-rose-500/70" />
        <span className="w-3 h-3 rounded-full bg-amber-500/70" />
        <span className="w-3 h-3 rounded-full bg-emerald-500/70" />
      </div>

      {/* Console area */}
      <div className="flex-1 bg-[#0a0d14] rounded border border-slate-800 overflow-y-auto custom-scrollbar p-4 font-mono text-xs text-slate-300">
        {run.logs.map((line, i) => (
          <div key={i} className="leading-relaxed">{line}</div>
        ))}
        {run.status === 'failed' ? (
          <div className="mt-4 text-rose-400">
            <div>{run.logs[run.logs.length - 1] ?? 'Backtest failed'}</div>
            <div className="mt-1 text-slate-500">Click + to configure and start a new run.</div>
          </div>
        ) : (
          <span className="inline-block w-2 h-4 bg-slate-400 animate-pulse ml-1" />
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
