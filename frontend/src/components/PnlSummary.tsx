import React from 'react'
import type { PnlSummary as PnlSummaryType } from '../services/types'
import { MetricCard } from './MetricCard'
import { formatCurrency, formatPercentage } from '../services/formatters'

interface PnlSummaryProps {
  pnlData: PnlSummaryType
}

export function PnlSummary({ pnlData }: PnlSummaryProps) {
  // Strict color-coding rules
  const roiColor = pnlData.roi >= 0 ? 'success' : 'danger'
  const maxDrawdownColor = 'danger' // Always red for drawdown
  const feesColor = 'neutral' // Gray for fees

  return (
    <div className="w-full">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Profit & Loss Summary</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ROI Metric Card */}
        <MetricCard
          label="Return on Investment"
          value={pnlData.roi}
          unit="%"
          color={roiColor}
          tooltip="Total profit as percentage of initial investment"
        />

        {/* Max Drawdown Metric Card */}
        <MetricCard
          label="Maximum Drawdown"
          value={pnlData.maxDrawdown}
          unit="%"
          color={maxDrawdownColor}
          tooltip="Largest peak-to-trough decline during the backtest"
        />

        {/* Total Fees Metric Card */}
        <MetricCard
          label="Total Fees"
          value={pnlData.totalFees}
          unit="$"
          color={feesColor}
          tooltip="Total trading fees paid during backtest"
        />
      </div>
    </div>
  )
}
