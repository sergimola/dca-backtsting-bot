import React from 'react'
import type { BacktestConfiguration, BacktestResults } from '../services/types'

interface ResultsPageProps {
  results: BacktestResults
  onReset: () => void
  onModify: (config: BacktestConfiguration) => void
}

export function ResultsPage({
  results,
  onReset,
  onModify
}: ResultsPageProps) {
  return (
    <div className="w-full">
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Results...</h2>
        <p className="text-gray-600 mb-6">Backtest ID: {results.backtestId}</p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={onReset}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Run New Backtest
          </button>
          <button
            onClick={() => onModify({} as BacktestConfiguration)}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          >
            Modify & Re-run
          </button>
        </div>
      </div>
    </div>
  )
}
