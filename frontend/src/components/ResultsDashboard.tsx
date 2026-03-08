import React from 'react'
import { PnlSummary } from './PnlSummary'
import { SafetyOrderChart } from './SafetyOrderChart'
import { TradeEventsTable } from './TradeEventsTable'
import type { BacktestResults } from '../services/types'

export interface ResultsDashboardProps {
  results: BacktestResults
  onReset: () => void
  onModify: () => void
}

export function ResultsDashboard({ results, onReset, onModify }: ResultsDashboardProps) {
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Backtest Results</h1>
          <p className="text-gray-600 mt-1">Backtest ID: {results.backtestId}</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={onReset}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors"
          >
            Run New Backtest
          </button>
          <button
            onClick={onModify}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium transition-colors"
          >
            Modify &amp; Re-run
          </button>
        </div>
      </div>

      {/* PnlSummary - Full Width */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Performance Metrics</h2>
        <div className="bg-white rounded-lg shadow p-6">
          <PnlSummary pnlData={results.pnlSummary} />
        </div>
      </section>

      {/* Charts and Table - 2 Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SafetyOrderChart - Left (SafetyOrderChart renders its own title) */}
        <section>
          <div className="bg-white rounded-lg shadow p-6">
            <SafetyOrderChart soUsageData={results.safetyOrderUsage} />
          </div>
        </section>

        {/* TradeEventsTable - Right */}
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Trade Events</h2>
          <div className="bg-white rounded-lg shadow p-6">
            <TradeEventsTable events={results.tradeEvents} />
          </div>
        </section>
      </div>
    </div>
  )
}
