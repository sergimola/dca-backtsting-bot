import React, { useState } from 'react'
import type { BacktestResults } from '../services/types'
import { useBacktestPolling } from '../hooks/useBacktestPolling'
import { PollingIndicator } from '../components/PollingIndicator'

interface PollingPageProps {
  backtestId: string
  onComplete: (results: BacktestResults) => void
  onError: (error: Error) => void
  onTimeout: () => void
}

export function PollingPage({
  backtestId,
  onComplete,
  onError,
  onTimeout
}: PollingPageProps) {
  const [isRetrying, setIsRetrying] = useState(false)

  const { isPolling, status, elapsedSeconds, progress, retryAttempt } = useBacktestPolling({
    backtestId,
    onComplete,
    onError,
    onTimeout,
    pollInterval: 2000,
    timeoutThreshold: 5 * 60 * 1000
  })

  const handleRetry = () => {
    setIsRetrying(true)
    // Re-initialize polling by triggering a new render
    // The hook will restart with the same backtestId
    setTimeout(() => setIsRetrying(false), 100)
  }

  const handleCancel = () => {
    // This would trigger navigation back to configuration
    // For now, just a placeholder
  }

  return (
    <div className="w-full">
      <PollingIndicator
        status={status as 'pending' | 'timeout' | 'failed'}
        statusMessage={
          status === 'pending'
            ? 'Processing your backtest...'
            : status === 'timeout'
            ? 'Request timed out'
            : 'Backtest failed'
        }
        elapsedSeconds={elapsedSeconds}
        totalSeconds={300}
        errorMessage={
          status === 'timeout'
            ? 'Your backtest exceeded the 5-minute timeout limit'
            : status === 'failed'
            ? `Error occurred during backtest processing (Attempt ${retryAttempt})`
            : undefined
        }
        onRetry={handleRetry}
        onCancel={handleCancel}
      />
    </div>
  )
}
