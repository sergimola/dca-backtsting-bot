import { useEffect } from 'react'
import { useBacktestPolling } from './useBacktestPolling'
import type { BacktestResults } from '../services/types'

interface UseRunPollingProps {
  backtestId: string
  onComplete: (results: BacktestResults) => void
  onFail: (errorMsg: string) => void
  onLogUpdate: (backtestId: string, log: string) => void
  onProgressUpdate: (backtestId: string, progress: number) => void
}

// ARCHITECTURE: Called ONLY from RunPollingController.
// Returns void — all output is via callbacks.
export function useRunPolling({
  backtestId,
  onComplete,
  onFail,
  onLogUpdate,
  onProgressUpdate,
}: UseRunPollingProps): void {
  const { status, elapsedSeconds } = useBacktestPolling({
    backtestId,
    pollInterval: 2000,
    timeoutThreshold: 5 * 60 * 1000,
    onComplete: (results: BacktestResults) => {
      onProgressUpdate(backtestId, 100)
      onComplete(results)
    },
    onError: (err: Error) => {
      onFail(err.message)
    },
    onTimeout: () => {
      onFail('Polling timeout: backtest exceeded 5 minutes')
    },
  })

  // Emit per-cycle log and progress updates whenever polling state changes.
  useEffect(() => {
    if (!status || status === 'completed' || status === 'failed' || status === 'timeout') return

    const heuristicProgress = Math.min(Math.floor((elapsedSeconds / 300) * 100), 95)
    const now = new Date().toLocaleTimeString('en-US', { hour12: false })
    const msg =
      status === 'downloading'
        ? `[${now}] Downloading market data…`
        : `[${now}] ${status.toUpperCase()}`

    onLogUpdate(backtestId, msg)
    onProgressUpdate(backtestId, heuristicProgress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, elapsedSeconds])
}

