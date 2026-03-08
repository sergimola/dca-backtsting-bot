import React, { useState } from 'react'
import type { SafetyOrderUsage } from '../services/types'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'

interface SafetyOrderChartProps {
  soUsageData: SafetyOrderUsage[]
}

export function SafetyOrderChart({ soUsageData }: SafetyOrderChartProps) {
  const [viewMode, setViewMode] = useState<'chart' | 'list'>('chart')

  // Check if we have any valid data
  const hasData = soUsageData.length > 0 && soUsageData.some(so => so.count > 0)

  if (!hasData) {
    return (
      <div className="w-full py-12 text-center">
        <p className="text-gray-600 text-lg">
          No safety orders were triggered during this backtest
        </p>
      </div>
    )
  }

  const toggleView = () => {
    setViewMode(viewMode === 'chart' ? 'list' : 'chart')
  }

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-gray-900">Safety Order Usage</h3>
        <button
          onClick={toggleView}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
        >
          Switch to {viewMode === 'chart' ? 'List' : 'Chart'} View
        </button>
      </div>

      {viewMode === 'chart' ? (
        <div className="w-full h-96">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={soUsageData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="level" />
              <YAxis />
              <Tooltip
                contentStyle={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb' }}
                cursor={{ fill: 'rgba(79, 70, 229, 0.1)' }}
              />
              <Legend />
              <Bar
                dataKey="count"
                fill="#4f46e5"
                radius={[8, 8, 0, 0]}
                name="Orders Triggered"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b">
                <th className="px-4 py-3 text-left font-semibold text-gray-900">
                  Safety Order Level
                </th>
                <th className="px-4 py-3 text-right font-semibold text-gray-900">Count</th>
              </tr>
            </thead>
            <tbody>
              {soUsageData.map((so, idx) => (
                <tr
                  key={`${so.level}-${idx}`}
                  className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  <td className="px-4 py-3 text-gray-700 border-b">{so.level}</td>
                  <td className="px-4 py-3 text-right text-gray-700 border-b font-medium">
                    {so.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
