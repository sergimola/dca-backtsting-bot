import React from 'react'

interface PollingIndicatorProps {
  status: 'pending' | 'timeout' | 'failed'
  statusMessage: string
  elapsedSeconds: number
  totalSeconds?: number
  errorMessage?: string
  onRetry: () => void
  onCancel: () => void
  onCheckStatus?: () => void
}

export function PollingIndicator({
  status,
  statusMessage,
  elapsedSeconds,
  totalSeconds = 300,
  errorMessage,
  onRetry,
  onCancel,
  onCheckStatus
}: PollingIndicatorProps) {
  const progressPercentage = Math.min(
    Math.floor((elapsedSeconds / totalSeconds) * 100),
    100
  )

  const getStatusColor = () => {
    if (status === 'pending') return 'text-blue-600'
    if (status === 'timeout') return 'text-yellow-600'
    if (status === 'failed') return 'text-red-600'
    return 'text-gray-600'
  }

  const getProgressBarColor = () => {
    if (status === 'pending') return 'from-blue-400 to-indigo-600'
    if (status === 'timeout') return 'from-yellow-400 to-orange-600'
    if (status === 'failed') return 'from-red-400 to-red-600'
    return 'from-gray-400 to-gray-600'
  }

  return (
    <div className="w-full py-12">
      <div className="flex flex-col items-center gap-6">
        {/* Spinner */}
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600"></div>
        </div>

        {/* Status Message */}
        <div className="text-center">
          <p className={`text-2xl font-semibold ${getStatusColor()}`}>
            {statusMessage}
          </p>
        </div>

        {/* Error Message (if provided) */}
        {errorMessage && (
          <div className="w-full max-w-md p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-600 text-sm">{errorMessage}</p>
          </div>
        )}

        {/* Time Elapsed and Progress */}
        <div className="w-full max-w-md">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Elapsed: {elapsedSeconds} seconds</span>
            <span>{progressPercentage}%</span>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${getProgressBarColor()} transition-all duration-300`}
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
          
          <div className="text-center text-xs text-gray-500 mt-2">
            {totalSeconds - elapsedSeconds > 0
              ? `${totalSeconds - elapsedSeconds}s remaining`
              : 'Time limit reached'}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 justify-center mt-4">
          <button
            onClick={onCancel}
            className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium"
          >
            Cancel
          </button>

          <button
            onClick={onRetry}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            Retry
          </button>

          {onCheckStatus && (
            <button
              onClick={onCheckStatus}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
            >
              Check Status
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
