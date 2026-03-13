import React, { useState } from 'react'
import type { BacktestFormState, BacktestResults } from './services/types'
import { submitBacktest } from './services/backtest-api'
import { ConfigurationPage } from './pages/ConfigurationPage'
import { PollingPage } from './pages/PollingPage'
import { ResultsPage } from './pages/ResultsPage'
import { ErrorBoundary } from './components/ErrorBoundary'

type ViewType = 'configuration' | 'polling' | 'results'

interface AppState {
  currentView: ViewType
  backtestId: string | null
  results: BacktestResults | null
  submittedConfig: BacktestFormState | null
  error: string | null
  isSubmitting: boolean
}

export default function App() {
  const [state, setState] = useState<AppState>({
    currentView: 'configuration',
    backtestId: null,
    results: null,
    submittedConfig: null,
    error: null,
    isSubmitting: false
  })

  const handleSubmitConfig = async (config: BacktestFormState) => {
    setState(prev => ({ ...prev, isSubmitting: true, error: null }))
    
    try {
      const response = await submitBacktest(config)
      setState(prev => ({
        ...prev,
        currentView: 'polling',
        backtestId: response.backtestId,
        submittedConfig: config,
        isSubmitting: false
      }))
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit configuration'
      setState(prev => ({
        ...prev,
        error: errorMessage,
        isSubmitting: false
      }))
    }
  }

  const handlePollingComplete = (results: BacktestResults) => {
    setState(prev => ({
      ...prev,
      currentView: 'results',
      results
    }))
  }

  const handlePollingError = (error: Error) => {
    setState(prev => ({
      ...prev,
      error: error.message,
      currentView: 'configuration'
    }))
  }

  const handlePollingTimeout = () => {
    setState(prev => ({
      ...prev,
      error: 'Polling timeout: Backtest took longer than 5 minutes'
    }))
  }

  const handleResetForm = () => {
    setState(prev => ({
      ...prev,
      currentView: 'configuration',
      backtestId: null,
      results: null,
      submittedConfig: null,
      error: null
    }))
  }

  const handleModifyConfig = () => {
    setState(prev => ({
      ...prev,
      currentView: 'configuration'
    }))
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
        <div className={state.currentView === 'results' ? 'max-w-6xl mx-auto' : 'max-w-2xl mx-auto'}>
          <header className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-100 mb-2">DCA Backtesting Bot</h1>
            <p className="text-lg text-gray-400">Configure your Dollar-Cost Averaging strategy</p>
          </header>

          {/* Error Alert - App-level error display */}
          {state.error && (
            <div className="bg-red-900/50 border-l-4 border-red-500 p-4 mb-6 rounded">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-red-300 font-semibold">Error</p>
                  <p className="text-red-400 mt-1">{state.error}</p>
                </div>
                <button
                  onClick={() => setState(prev => ({ ...prev, error: null }))}
                  className="text-red-400 hover:text-red-200 font-bold text-xl"
                  aria-label="Dismiss error"
                >
                  ×
                </button>
              </div>
            </div>
          )}

          {state.currentView !== 'results' ? (
            <div className="bg-gray-800 rounded-xl shadow-lg p-8 border border-gray-700">
              {state.currentView === 'configuration' && (
                <ConfigurationPage
                  onSubmit={handleSubmitConfig}
                  initialValues={state.submittedConfig || undefined}
                  error={state.error || undefined}
                  isSubmitting={state.isSubmitting}
                />
              )}

              {state.currentView === 'polling' && state.backtestId && (
                <PollingPage
                  backtestId={state.backtestId}
                  onComplete={handlePollingComplete}
                  onError={handlePollingError}
                  onTimeout={handlePollingTimeout}
                />
              )}
            </div>
          ) : (
            state.results && (
              <ResultsPage
                results={state.results}
                onReset={handleResetForm}
                onModify={handleModifyConfig}
              />
            )
          )}

          <footer className="text-center mt-8 text-sm text-gray-500">
            <p>DCA Backtesting Engine</p>
          </footer>
        </div>
      </div>
    </ErrorBoundary>
  )
}
