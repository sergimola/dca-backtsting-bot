import React from 'react'
import { ResultsDashboard } from '../components/ResultsDashboard'
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
      <ResultsDashboard
        results={results}
        onReset={onReset}
        onModify={() => onModify({} as BacktestConfiguration)}
      />
    </div>
  )
}
