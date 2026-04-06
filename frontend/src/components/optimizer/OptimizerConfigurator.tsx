/**
 * OptimizerConfigurator — Left panel with Fixed/Sweep parameter fields,
 * fixed fields (symbol, timeframe, dates), Quick Date buttons, JSON Import/Export.
 */
import React, { useState } from 'react'
import { SweepParameterField } from './SweepParameterField'
import { CombinatorialFooter } from './CombinatorialFooter'
import type { OptimizerFormState, ParameterField, SweepCounts } from '../../hooks/useOptimizer'

interface Props {
  formState: OptimizerFormState
  sweepCounts: SweepCounts | null
  onUpdateField: (name: string, patch: Partial<ParameterField>) => void
  onUpdateFormField: (field: string, value: string | boolean) => void
  onLaunch: () => void
  isLaunching?: boolean
}

export function OptimizerConfigurator({
  formState,
  sweepCounts,
  onUpdateField,
  onUpdateFormField,
  onLaunch,
  isLaunching,
}: Props) {
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')

  const setQuickDate = (preset: 'ytd' | '6m' | '30d') => {
    const now = new Date()
    let start: Date
    switch (preset) {
      case 'ytd':
        start = new Date(now.getFullYear(), 0, 1)
        break
      case '6m':
        start = new Date(now)
        start.setMonth(start.getMonth() - 6)
        break
      case '30d':
        start = new Date(now)
        start.setDate(start.getDate() - 30)
        break
    }
    onUpdateFormField('startDate', start.toISOString().replace(/\.\d{3}Z$/, 'Z'))
    onUpdateFormField('endDate', now.toISOString().replace(/\.\d{3}Z$/, 'Z'))
  }

  // T049: Generate "Since [Y]" and "[Y] Only" buttons for the last 5 years.
  const generateYearButtons = () => {
    const currentYear = new Date().getFullYear()
    const buttons: Array<{ label: string; start: string; end: string }> = []
    for (let y = currentYear - 5; y <= currentYear - 1; y++) {
      const today = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      buttons.push({
        label: `Since ${y}`,
        start: `${y}-01-01T00:00:00Z`,
        end: today,
      })
      buttons.push({
        label: `${y} Only`,
        start: `${y}-01-01T00:00:00Z`,
        end: `${y}-12-31T23:59:59Z`,
      })
    }
    return buttons
  }

  const yearButtons = generateYearButtons()

  const handleExport = () => {
    const exportData: Record<string, any> = {
      symbol: formState.symbol,
      startDate: formState.startDate,
      endDate: formState.endDate,
      accountBalance: formState.accountBalance,
    }
    formState.parameters.forEach(p => {
      exportData[p.name] = p.mode === 'fixed' ? p.fixedValue : p.listInput
    })
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2))
  }

  const handleImport = () => {
    try {
      const data = JSON.parse(importText)
      if (data.symbol) onUpdateFormField('symbol', data.symbol)
      if (data.startDate) onUpdateFormField('startDate', data.startDate)
      if (data.endDate) onUpdateFormField('endDate', data.endDate)
      if (data.accountBalance) onUpdateFormField('accountBalance', data.accountBalance)
      if (data.monthlyAddition != null && data.monthly_addition == null) {
        data.monthly_addition = data.monthlyAddition
      }
      formState.parameters.forEach(p => {
        if (data[p.name] != null) {
          const raw = data[p.name]

          if (Array.isArray(raw)) {
            const listInput = raw.map(v => String(v).trim()).filter(Boolean).join(', ')
            onUpdateField(p.name, {
              mode: 'sweep',
              listInput,
              fixedValue: '',
              range: { start: '', end: '', step: '' },
            })
            return
          }

          const value = String(raw).trim()
          if (value.includes(',')) {
            const listInput = value
              .split(',')
              .map(v => v.trim())
              .filter(Boolean)
              .join(', ')
            onUpdateField(p.name, {
              mode: 'sweep',
              listInput,
              fixedValue: '',
              range: { start: '', end: '', step: '' },
            })
            return
          }

          onUpdateField(p.name, {
            mode: 'fixed',
            fixedValue: value,
            listInput: '',
            range: { start: '', end: '', step: '' },
          })
        }
      })
      setShowImport(false)
      setImportText('')
    } catch { /* ignore parse errors */ }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Optimizer Config</h2>
          <div className="flex gap-1">
            <button
              onClick={() => setShowImport(!showImport)}
              className="text-[10px] px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-400"
            >
              Import
            </button>
            <button
              onClick={handleExport}
              className="text-[10px] px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-400"
            >
              Export
            </button>
          </div>
        </div>

        {/* Import modal */}
        {showImport && (
          <div className="p-3 bg-slate-800 rounded border border-slate-600 space-y-2">
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="Paste JSON config..."
              className="w-full h-24 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-300 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={handleImport} className="text-xs px-3 py-1 bg-blue-600/20 text-blue-400 rounded border border-blue-600/30">
                Apply
              </button>
              <button onClick={() => setShowImport(false)} className="text-xs px-3 py-1 bg-slate-700 text-slate-400 rounded">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Fixed fields */}
        <div className="space-y-2">
          <div>
            <label className="text-xs text-slate-400 font-medium">Symbol</label>
            <input
              type="text"
              value={formState.symbol}
              onChange={e => onUpdateFormField('symbol', e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium">Account Balance</label>
            <input
              type="number"
              value={formState.accountBalance}
              onChange={e => onUpdateFormField('accountBalance', e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200"
              step="any"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-400 font-medium">Start Date</label>
              <input
                type="text"
                value={formState.startDate}
                onChange={e => onUpdateFormField('startDate', e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium">End Date</label>
              <input
                type="text"
                value={formState.endDate}
                onChange={e => onUpdateFormField('endDate', e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200"
              />
            </div>
          </div>

          <div className="flex gap-1">
            <button onClick={() => setQuickDate('ytd')} className="text-[10px] px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-400">YTD</button>
            <button onClick={() => setQuickDate('6m')} className="text-[10px] px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-400">Last 6M</button>
            <button onClick={() => setQuickDate('30d')} className="text-[10px] px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-400">Last 30D</button>
          </div>

          {/* T049: Year-based quick dates — dynamically generated for last 5 years */}
          <div className="flex gap-1 flex-wrap overflow-x-auto pb-0.5">
            {yearButtons.map(btn => (
              <button
                key={btn.label}
                onClick={() => {
                  onUpdateFormField('startDate', btn.start)
                  onUpdateFormField('endDate', btn.end)
                }}
                className="text-[10px] px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-400 whitespace-nowrap shrink-0"
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-slate-700" />

        {/* Stop-Loss Configuration */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Stop-Loss</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-slate-400">
                {formState.stop_loss_enabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={formState.stop_loss_enabled}
                onClick={() => onUpdateFormField('stop_loss_enabled', !formState.stop_loss_enabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  formState.stop_loss_enabled ? 'bg-blue-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    formState.stop_loss_enabled ? 'translate-x-4' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>
          </div>

          {formState.stop_loss_enabled && (
            <div className="space-y-3 pl-2 border-l-2 border-blue-600/30">
              <div>
                <label className="text-xs text-slate-400 font-medium">Baseline</label>
                <select
                  value={formState.stop_loss_baseline}
                  onChange={e => onUpdateFormField('stop_loss_baseline', e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200"
                >
                  <option value="average_entries">Average Entries</option>
                  <option value="first_entry">First Entry</option>
                </select>
              </div>
              {formState.parameters
                .filter(p => p.name === 'stop_loss_percent' || p.name === 'stop_loss_timeout_minutes')
                .map(p => (
                  <SweepParameterField
                    key={p.name}
                    field={p}
                    onChange={patch => onUpdateField(p.name, patch)}
                  />
                ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-slate-700" />

        {/* Margin Type */}
        <div className="space-y-2">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Margin Type</p>
          <select
            value={formState.marginType}
            onChange={e => onUpdateFormField('marginType', e.target.value)}
            className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200"
          >
            <option value="isolated">Isolated</option>
            <option value="cross">Cross</option>
          </select>
        </div>

        {/* Divider */}
        <div className="border-t border-slate-700" />

        {/* Sweepable parameters */}
        <div className="space-y-3">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Parameters</p>
          {formState.parameters
            .filter(p => p.name !== 'stop_loss_percent' && p.name !== 'stop_loss_timeout_minutes')
            .map(p => (
            <SweepParameterField
              key={p.name}
              field={p}
              onChange={patch => onUpdateField(p.name, patch)}
            />
          ))}
        </div>
      </div>

      {/* Sticky footer */}
      <CombinatorialFooter
        sweepCounts={sweepCounts}
        onLaunch={onLaunch}
        isLoading={isLaunching}
      />
    </div>
  )
}
