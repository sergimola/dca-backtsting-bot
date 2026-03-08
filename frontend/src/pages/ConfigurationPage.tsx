import React from 'react'
import type { BacktestConfiguration } from '../services/types'
import { ConfigurationForm } from '../components/ConfigurationForm'

interface ConfigurationPageProps {
  onSubmit: (config: BacktestConfiguration) => void
  initialValues?: BacktestConfiguration
  error?: string
  isSubmitting?: boolean
}

export function ConfigurationPage({
  onSubmit,
  initialValues,
  error,
  isSubmitting
}: ConfigurationPageProps) {
  return (
    <div className="w-full">
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 font-semibold">Error</p>
          <p className="text-red-600">{error}</p>
        </div>
      )}
      <ConfigurationForm 
        onSubmit={onSubmit} 
        initialValues={initialValues}
        isSubmitting={isSubmitting}
        serverErrors={error ? { api: error } : undefined}
      />
    </div>
  )
}
