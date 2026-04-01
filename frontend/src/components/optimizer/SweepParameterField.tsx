/**
 * SweepParameterField — Fixed/Sweep toggle with value input or Range popover.
 */
import React, { useState } from 'react'
import Decimal from 'decimal.js'
import type { ParameterField } from '../../hooks/useOptimizer'

interface Props {
  field: ParameterField
  onChange: (patch: Partial<ParameterField>) => void
}

export function SweepParameterField({ field, onChange }: Props) {
  const [showRange, setShowRange] = useState(false)

  const toggleMode = () => {
    onChange({ mode: field.mode === 'fixed' ? 'sweep' : 'fixed' })
  }

  const applyRange = () => {
    try {
      const s = new Decimal(field.range.start)
      const e = new Decimal(field.range.end)
      const st = new Decimal(field.range.step)
      if (st.lte(0) || s.gt(e)) return

      const values: string[] = []
      let current = s
      while (current.lte(e)) {
        values.push(current.toString())
        current = current.plus(st)
      }
      onChange({ listInput: values.join(', ') })
      setShowRange(false)
    } catch { /* ignore invalid decimal input */ }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-slate-400 font-medium">{field.label}</label>
        <button
          onClick={toggleMode}
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            field.mode === 'sweep'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'bg-slate-700 text-slate-400 border border-slate-600'
          }`}
        >
          {field.mode === 'fixed' ? 'Fixed' : 'Sweep'}
        </button>
      </div>

      {field.mode === 'fixed' ? (
        <input
          type="number"
          value={field.fixedValue}
          onChange={e => onChange({ fixedValue: e.target.value })}
          className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
          step="any"
        />
      ) : (
        <div className="relative">
          <input
            type="text"
            value={field.listInput}
            onChange={e => onChange({ listInput: e.target.value })}
            placeholder="1.0, 1.5, 2.0"
            className="w-full px-2 py-1.5 bg-yellow-900/10 border border-amber-600/30 rounded text-sm text-slate-200 focus:border-amber-500 focus:outline-none font-medium"
          />
          <button
            onClick={() => setShowRange(!showRange)}
            className="absolute right-1 top-1 text-[10px] px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-400"
          >
            Range
          </button>

          {showRange && (
            <div className="absolute z-10 mt-1 p-3 bg-slate-800 border border-slate-600 rounded-lg shadow-xl w-full space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500">Start</label>
                  <input
                    type="number"
                    value={field.range.start}
                    onChange={e => onChange({ range: { ...field.range, start: e.target.value } })}
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs"
                    step="any"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">End</label>
                  <input
                    type="number"
                    value={field.range.end}
                    onChange={e => onChange({ range: { ...field.range, end: e.target.value } })}
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs"
                    step="any"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">Step</label>
                  <input
                    type="number"
                    value={field.range.step}
                    onChange={e => onChange({ range: { ...field.range, step: e.target.value } })}
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs"
                    step="any"
                  />
                </div>
              </div>
              <button
                onClick={applyRange}
                className="w-full py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 text-xs rounded border border-amber-600/30"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
