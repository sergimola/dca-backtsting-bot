import React, { ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log('ErrorBoundary caught an error:', error, errorInfo)
    }

    // Store error info for display/debugging
    this.setState({
      error,
      errorInfo
    })
  }

  handleRetry = () => {
    // Reset error state to allow re-render
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full max-w-2xl mx-auto p-8 bg-white rounded-lg shadow-lg border-2 border-red-500">
          <div className="space-y-4">
            {/* Error heading */}
            <h2 className="text-2xl font-bold text-red-600">Something went wrong</h2>

            {/* Error message */}
            <div className="bg-red-50 border border-red-200 rounded p-4">
              <p className="text-red-800 font-semibold">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
            </div>

            {/* Stack trace (development only) */}
            {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
              <details className="bg-gray-100 rounded p-4 text-xs font-mono text-gray-700 max-h-40 overflow-auto">
                <summary className="font-semibold cursor-pointer mb-2">Stack trace (dev only)</summary>
                <pre className="whitespace-pre-wrap break-words">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}

            {/* Retry button */}
            <div className="flex gap-4">
              <button
                onClick={this.handleRetry}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                Retry
              </button>
              <a
                href="/"
                className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium transition-colors inline-block"
              >
                Go Home
              </a>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
