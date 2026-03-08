import { useState, useEffect, useRef } from 'react'
import { getStatus, getResults } from '../services/backtest-api'
import type { BacktestResults } from '../services/types'

interface UseBacktestPollingProps {
  backtestId: string
  onComplete: (results: BacktestResults) => void
  onError: (error: Error) => void
  onTimeout: () => void
  pollInterval?: number
  timeoutThreshold?: number
}

interface UseBacktestPollingReturn {
  isPolling: boolean
  status: string
  elapsedSeconds: number
  progress: number
  retryAttempt: number
}

export function useBacktestPolling({
  backtestId,
  onComplete,
  onError,
  onTimeout,
  pollInterval = 2000,
  timeoutThreshold = 5 * 60 * 1000 // 5 minutes default
}: UseBacktestPollingProps): UseBacktestPollingReturn {
  const [state, setState] = useState<UseBacktestPollingReturn>({
    isPolling: true,
    status: 'pending',
    elapsedSeconds: 0,
    progress: 0,
    retryAttempt: 0
  })

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number>(Date.now())
  const retryCountRef = useRef<number>(0)

  useEffect(() => {
    const poll = async () => {
      const elapsedMs = Date.now() - startTimeRef.current
      const elapsedSeconds = Math.floor(elapsedMs / 1000)

      // Check if timeout threshold exceeded
      if (elapsedSeconds >= Math.floor(timeoutThreshold / 1000)) {
        setState(prev => ({
          ...prev,
          isPolling: false,
          status: 'timeout'
        }))
        onTimeout()
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        return
      }

      try {
        const statusResponse = await getStatus(backtestId)

        if (statusResponse.status === 'completed') {
          try {
            const results = await getResults(backtestId)
            setState(prev => ({
              ...prev,
              isPolling: false,
              status: 'completed'
            }))
            onComplete(results)
            if (intervalRef.current) {
              clearInterval(intervalRef.current)
              intervalRef.current = null
            }
          } catch (err) {
            const error = err instanceof Error ? err : new Error('Failed to get results')
            setState(prev => ({
              ...prev,
              isPolling: false,
              status: 'failed'
            }))
            onError(error)
            if (intervalRef.current) {
              clearInterval(intervalRef.current)
              intervalRef.current = null
            }
          }
        } else if (statusResponse.status === 'failed') {
          const errorMessage = statusResponse.error || 'Backtest failed'
          const error = new Error(errorMessage)
          setState(prev => ({
            ...prev,
            isPolling: false,
            status: 'failed'
          }))
          onError(error)
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        } else if (statusResponse.status === 'pending') {
          // Continue polling
          const progress = Math.min(
            Math.floor((elapsedSeconds / Math.floor(timeoutThreshold / 1000)) * 100),
            99
          )
          setState(prev => ({
            ...prev,
            status: 'pending',
            elapsedSeconds,
            progress,
            retryAttempt: 0
          }))
          retryCountRef.current = 0
        }
      } catch (err) {
        // Network error - retry with exponential backoff
        if (retryCountRef.current < 2) {
          retryCountRef.current += 1
          const backoffTime = Math.pow(2, retryCountRef.current) * 1000 // 2s, 4s
          
          setState(prev => ({
            ...prev,
            retryAttempt: retryCountRef.current,
            elapsedSeconds
          }))

          // Clear current interval and set up backoff retry
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
          }

          setTimeout(() => {
            if (backtestId) {
              poll() // Retry immediately after backoff
              // Set up regular polling again
              intervalRef.current = setInterval(poll, pollInterval)
            }
          }, backoffTime)
        } else {
          // Max retries exceeded
          const error = err instanceof Error ? err : new Error('Network error')
          setState(prev => ({
            ...prev,
            isPolling: false,
            status: 'failed'
          }))
          onError(error)
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        }
      }
    }

    // Start polling immediately
    poll()

    // Set up interval for subsequent polls
    intervalRef.current = setInterval(poll, pollInterval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [backtestId, onComplete, onError, onTimeout, pollInterval, timeoutThreshold])

  return state
}
