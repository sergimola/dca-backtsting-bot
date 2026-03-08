import React from 'react'

interface MetricCardProps {
  label: string
  value: number
  unit: string
  color?: 'success' | 'danger' | 'neutral'
  tooltip?: string
}

export function MetricCard({
  label,
  value,
  unit,
  color = 'neutral',
  tooltip
}: MetricCardProps) {
  const getColorClass = () => {
    switch (color) {
      case 'success':
        return 'text-green-600'
      case 'danger':
        return 'text-red-600'
      case 'neutral':
      default:
        return 'text-gray-600'
    }
  }

  return (
    <div className="flex justify-between items-center p-4 rounded-lg bg-gray-50 border border-gray-200">
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {tooltip && (
          <p className="text-xs text-gray-500 mt-1 truncate" title={tooltip}>
            {tooltip}
          </p>
        )}
      </div>
      <div className={`text-xl font-bold ${getColorClass()}`} title={tooltip}>
        {value.toFixed(2)}{unit}
      </div>
    </div>
  )
}
