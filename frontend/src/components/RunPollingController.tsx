import { useRunPolling } from '../hooks/useRunPolling'
import type { BacktestResults } from '../services/types'

interface RunPollingControllerProps {
  backtestId: string
  onComplete: (backtestId: string, results: BacktestResults) => void
  onFail: (backtestId: string, errorMsg: string) => void
  onLogsUpdate: (backtestId: string, newLog: string) => void
  onProgressUpdate: (backtestId: string, progress: number) => void
}

// ARCHITECTURE: Sole owner of all polling. Renders null (invisible).
// One instance per running run, keyed by backtestId in App.tsx.
export function RunPollingController({
  backtestId,
  onComplete,
  onFail,
  onLogsUpdate,
  onProgressUpdate,
}: RunPollingControllerProps) {
  useRunPolling({
    backtestId,
    onComplete: (results) => onComplete(backtestId, results),
    onFail:     (msg)     => onFail(backtestId, msg),
    onLogUpdate: (_, log) => onLogsUpdate(backtestId, log),
    onProgressUpdate: (_, progress) => onProgressUpdate(backtestId, progress),
  })

  return null
}
