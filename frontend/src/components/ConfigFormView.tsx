import React, { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Settings2, Loader2 } from 'lucide-react'
import type { BacktestFormState } from '../services/types'

interface ConfigFormViewProps {
  onSubmit: (config: BacktestFormState) => Promise<void>
  isSubmitting: boolean
  error: string | null
}

const EMPTY_FORM: Record<string, string | boolean> = {
  tradingPair: '',
  startDate: '',
  endDate: '',
  priceEntry: '',
  priceScale: '',
  amountScale: '',
  numberOfOrders: '',
  amountPerTrade: '',
  marginType: 'isolated',
  multiplier: '',
  takeProfitDistancePercent: '',
  accountBalance: '',
  monthlyAddition: '',
  exitOnLastOrder: false,
  enable_wide_events: false,
}

function isNumericValid(val: string) {
  const n = parseFloat(val)
  return !isNaN(n)
}

function toRfc3339(datetimeLocal: string): string {
  // Convert datetime-local (YYYY-MM-DDTHH:MM) to RFC 3339 (YYYY-MM-DDTHH:MM:SSZ)
  if (!datetimeLocal) return ''
  // datetime-local format is: YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS
  // We need to ensure it has :00 seconds and Z timezone
  const parts = datetimeLocal.split('T')
  if (parts.length !== 2) return datetimeLocal
  const [date, time] = parts
  const timeWithSeconds = time.includes(':') && time.split(':').length >= 2 
    ? (time.split(':').length === 2 ? `${time}:00` : time)
    : time
  return `${date}T${timeWithSeconds}Z`
}

export function ConfigFormView({ onSubmit, isSubmitting, error }: ConfigFormViewProps) {
  const location = useLocation()
  const [form, setForm] = useState<Record<string, string | boolean>>(() => {
    const prefill = (location.state as { prefillConfig?: Partial<BacktestFormState> } | null)?.prefillConfig
    if (!prefill) return { ...EMPTY_FORM }
    return {
      ...EMPTY_FORM,
      ...Object.fromEntries(
        Object.entries(prefill).map(([k, v]) => [k, v == null ? EMPTY_FORM[k] ?? '' : v])
      ),
    }
  })
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')

  // T069: re-apply prefillConfig when navigation state changes
  useEffect(() => {
    const prefill = (location.state as { prefillConfig?: Partial<BacktestFormState> } | null)?.prefillConfig
    if (!prefill) return
    setForm(prev => ({
      ...prev,
      ...Object.fromEntries(
        Object.entries(prefill).map(([k, v]) => [k, v == null ? EMPTY_FORM[k] ?? '' : v])
      ),
    }))
  }, [location.state])

  const setField = (key: string, value: string | boolean) =>
    setForm(prev => ({ ...prev, [key]: value }))

  // T052: Export current form state to clipboard as JSON.
  const handleExport = () => {
    const exportData: Record<string, string | boolean> = { ...form }
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2)).catch(() => { /* ignore */ })
  }

  // T053: Import — parse JSON, populate matching form fields; use first array element for sweep params.
  const handleImport = () => {
    try {
      const data = JSON.parse(importText) as Record<string, unknown>
      const fieldMap: Record<string, string> = {
        trading_pair: 'tradingPair', symbol: 'tradingPair', tradingPair: 'tradingPair',
        start_date: 'startDate', startDate: 'startDate',
        end_date: 'endDate', endDate: 'endDate',
        price_entry: 'priceEntry', priceEntry: 'priceEntry',
        price_scale: 'priceScale', priceScale: 'priceScale',
        amount_scale: 'amountScale', amountScale: 'amountScale',
        number_of_orders: 'numberOfOrders', numberOfOrders: 'numberOfOrders',
        amount_per_trade: 'amountPerTrade', amountPerTrade: 'amountPerTrade',
        margin_type: 'marginType', marginType: 'marginType',
        multiplier: 'multiplier',
        take_profit_distance_percent: 'takeProfitDistancePercent', takeProfitDistancePercent: 'takeProfitDistancePercent',
        account_balance: 'accountBalance', accountBalance: 'accountBalance',
        monthly_addition: 'monthlyAddition', monthlyAddition: 'monthlyAddition',
        exit_on_last_order: 'exitOnLastOrder', exitOnLastOrder: 'exitOnLastOrder',
        enable_wide_events: 'enable_wide_events',
      }
      const updates: Record<string, string | boolean> = {}
      for (const [srcKey, formKey] of Object.entries(fieldMap)) {
        if (data[srcKey] == null) continue
        let raw = data[srcKey]
        // Use first element for array values (sweep → single-run compatibility).
        if (Array.isArray(raw)) raw = raw[0]
        if (formKey === 'exitOnLastOrder' || formKey === 'enable_wide_events') {
          updates[formKey] = Boolean(raw)
        } else {
          updates[formKey] = String(raw)
        }
      }
      setForm(prev => ({ ...prev, ...updates }))
      setShowImport(false)
      setImportText('')
    } catch { /* ignore parse errors */ }
  }

  const numericFields = ['priceEntry', 'priceScale', 'amountScale', 'numberOfOrders',
    'amountPerTrade', 'multiplier', 'takeProfitDistancePercent', 'accountBalance']

  const isValid =
    form.tradingPair &&
    form.startDate &&
    form.endDate &&
    numericFields.every(f => isNumericValid(form[f] as string)) &&
    (!form.monthlyAddition || parseFloat(form.monthlyAddition as string) >= 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return

    const config: BacktestFormState = {
      tradingPair:               (form.tradingPair as string).trim(),
      startDate:                 toRfc3339(form.startDate as string),
      endDate:                   toRfc3339(form.endDate as string),
      priceEntry:                form.priceEntry as string,
      priceScale:                form.priceScale as string,
      amountScale:               form.amountScale as string,
      numberOfOrders:            form.numberOfOrders as string,
      amountPerTrade:            form.amountPerTrade as string,
      marginType:                (form.marginType as string) as 'cross' | 'isolated',
      multiplier:                form.multiplier as string,
      takeProfitDistancePercent: form.takeProfitDistancePercent as string,
      accountBalance:            form.accountBalance as string,
      monthlyAddition:           form.monthlyAddition as string,
      exitOnLastOrder:           form.exitOnLastOrder as boolean,
      enable_wide_events:        (form.enable_wide_events as boolean) || false,
    }
    await onSubmit(config)
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left description panel */}
      <div className="w-1/3 flex flex-col items-center justify-center p-8 border-r border-slate-800">
        <Settings2 className="w-10 h-10 text-blue-400 mb-4" />
        <h2 className="text-xl font-bold text-slate-100 mb-2">New Backtest</h2>
        <p className="text-sm text-slate-400 text-center">
          Configure your DCA strategy parameters and run a historical simulation.
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
        {/* T051: Import/Export toolbar */}
        <div className="flex justify-end gap-1 mb-3">
          <button
            type="button"
            onClick={() => setShowImport(v => !v)}
            className="text-[10px] px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-400"
          >
            Import Config
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="text-[10px] px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-400"
          >
            Export Config
          </button>
        </div>

        {/* T053: Import modal */}
        {showImport && (
          <div className="mb-4 p-3 bg-slate-900 border border-slate-700 rounded">
            <textarea
              aria-label="Import config JSON"
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs font-mono h-28 focus:border-blue-500 focus:outline-none"
              placeholder="Paste exported JSON here…"
              value={importText}
              onChange={e => setImportText(e.target.value)}
            />
            <div className="flex gap-1 mt-1.5 justify-end">
              <button
                type="button"
                onClick={() => { setShowImport(false); setImportText('') }}
                className="text-[10px] px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                className="text-[10px] px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded text-white"
              >
                Apply
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="grid grid-cols-2 gap-4">

            {/* Trading pair */}
            <div className="col-span-2">
              <label htmlFor="tradingPair" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Trading Pair
              </label>
              <input
                id="tradingPair"
                aria-label="Trading pair"
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="BTC/USDT"
                value={form.tradingPair as string}
                onChange={e => setField('tradingPair', e.target.value)}
              />
            </div>

            {/* Start date */}
            <div lang="es-ES">
              <label htmlFor="startDate" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Start Date
              </label>
              <input
                id="startDate"
                aria-label="Start date"
                type="datetime-local"
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                value={form.startDate as string}
                onChange={e => setField('startDate', e.target.value)}
              />
            </div>

            {/* End date */}
            <div lang="es-ES">
              <label htmlFor="endDate" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                End Date
              </label>
              <input
                id="endDate"
                aria-label="End date"
                type="datetime-local"
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                value={form.endDate as string}
                onChange={e => setField('endDate', e.target.value)}
              />
            </div>

            {/* Entry price */}
            <div>
              <label htmlFor="priceEntry" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Price Entry (First Safety Order Drop %)
              </label>
              <div className="relative">
                <input
                  id="priceEntry"
                  aria-label="Entry price"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 pr-8 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="1.5"
                  value={form.priceEntry as string}
                  onChange={e => setField('priceEntry', e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">%</span>
              </div>
            </div>

            {/* Price scale */}
            <div>
              <label htmlFor="priceScale" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Price Scale
              </label>
              <div className="relative">
                <input
                  id="priceScale"
                  aria-label="Price scale"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 pr-8 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="1.10"
                  value={form.priceScale as string}
                  onChange={e => setField('priceScale', e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">%</span>
              </div>
            </div>

            {/* Amount scale */}
            <div>
              <label htmlFor="amountScale" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Amount Scale
              </label>
              <div className="relative">
                <input
                  id="amountScale"
                  aria-label="Amount scale"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 pr-6 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="2.0"
                  value={form.amountScale as string}
                  onChange={e => setField('amountScale', e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">x</span>
              </div>
            </div>

            {/* Number of orders */}
            <div>
              <label htmlFor="numberOfOrders" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Number of Orders
              </label>
              <input
                id="numberOfOrders"
                aria-label="Number of orders"
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="5"
                value={form.numberOfOrders as string}
                onChange={e => setField('numberOfOrders', e.target.value)}
              />
            </div>

            {/* Amount per trade */}
            <div>
              <label htmlFor="amountPerTrade" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Amount Per Trade
              </label>
              <input
                id="amountPerTrade"
                aria-label="Amount per trade"
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="0.10"
                value={form.amountPerTrade as string}
                onChange={e => setField('amountPerTrade', e.target.value)}
              />
            </div>

            {/* Margin type */}
            <div>
              <label htmlFor="marginType" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Margin Type
              </label>
              <select
                id="marginType"
                aria-label="Margin type"
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                value={form.marginType as string}
                onChange={e => setField('marginType', e.target.value)}
              >
                <option value="isolated">isolated</option>
                <option value="cross">cross</option>
              </select>
            </div>

            {/* Multiplier */}
            <div>
              <label htmlFor="multiplier" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Multiplier
              </label>
              <input
                id="multiplier"
                aria-label="Multiplier"
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="1"
                value={form.multiplier as string}
                onChange={e => setField('multiplier', e.target.value)}
              />
            </div>

            {/* Take profit */}
            <div>
              <label htmlFor="takeProfitDistancePercent" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Take Profit %
              </label>
              <div className="relative">
                <input
                  id="takeProfitDistancePercent"
                  aria-label="Take profit distance percent"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 pr-8 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="2.5"
                  value={form.takeProfitDistancePercent as string}
                  onChange={e => setField('takeProfitDistancePercent', e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 text-xs">%</span>
              </div>
            </div>

            {/* Account balance */}
            <div>
              <label htmlFor="accountBalance" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Account Balance
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                <input
                  id="accountBalance"
                  aria-label="Account balance"
                  className="w-full bg-slate-900 border border-slate-700 rounded pl-7 pr-3 py-2 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="1000"
                  value={form.accountBalance as string}
                  onChange={e => setField('accountBalance', e.target.value)}
                />
              </div>
            </div>

            {/* Monthly addition */}
            <div>
              <label htmlFor="monthlyAddition" className="block text-xs uppercase tracking-widest text-slate-400 mb-1">
                Monthly Addition (optional)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                <input
                  id="monthlyAddition"
                  aria-label="Monthly addition"
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full bg-slate-900 border border-slate-700 rounded pl-7 pr-3 py-2 text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="0"
                  value={form.monthlyAddition as string}
                  onChange={e => setField('monthlyAddition', e.target.value)}
                />
              </div>
            </div>

            {/* Exit on last order toggle */}
            <div className="col-span-2 flex items-center gap-3">
              <span className="text-xs uppercase tracking-widest text-slate-400">Exit on Last Order</span>
              <button
                type="button"
                role="switch"
                aria-checked={form.exitOnLastOrder as boolean}
                onClick={() => setField('exitOnLastOrder', !(form.exitOnLastOrder as boolean))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  form.exitOnLastOrder ? 'bg-blue-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    form.exitOnLastOrder ? 'translate-x-4' : 'translate-x-1'
                  }`}
                />
              </button>
              {/* Hidden checkbox for form accessibility */}
              <input
                type="checkbox"
                className="sr-only"
                checked={form.exitOnLastOrder as boolean}
                onChange={e => setField('exitOnLastOrder', e.target.checked)}
                aria-hidden="true"
                tabIndex={-1}
              />
            </div>

            {/* Enable wide events toggle */}
            <div className="col-span-2 flex items-center gap-3">
              <span className="text-xs uppercase tracking-widest text-slate-400">Enable Wide Events</span>
              <button
                type="button"
                role="switch"
                aria-label="Enable Wide Events"
                aria-checked={form.enable_wide_events as boolean}
                onClick={() => setField('enable_wide_events', !(form.enable_wide_events as boolean))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  form.enable_wide_events ? 'bg-blue-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    form.enable_wide_events ? 'translate-x-4' : 'translate-x-1'
                  }`}
                />
              </button>
              <input
                type="checkbox"
                className="sr-only"
                checked={form.enable_wide_events as boolean}
                onChange={e => setField('enable_wide_events', e.target.checked)}
                aria-hidden="true"
                tabIndex={-1}
              />
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div className="mt-4 p-3 bg-rose-900/30 border border-rose-700 rounded text-sm text-rose-300">
              {error}
            </div>
          )}

          {/* Submit */}
          <div className="mt-6">
            <button
              type="submit"
              disabled={!isValid || isSubmitting}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                'Run Backtest'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
