import React, { useState, useCallback, useMemo } from 'react'
import { FormInput } from './FormInput'
import type { BacktestFormState } from '../services/types'

interface ConfigurationFormProps {
  onSubmit: (config: BacktestFormState) => void | Promise<void>
  initialValues?: BacktestFormState
  isSubmitting?: boolean
  serverErrors?: Record<string, string>
}

type FormErrors = Partial<
  Record<Exclude<keyof BacktestFormState, 'marginType' | 'exitOnLastOrder'>, string>
>
type FormTouched = Partial<Record<keyof BacktestFormState, boolean>>

const EMPTY_FORM: BacktestFormState = {
  tradingPair: '',
  startDate: '',
  endDate: '',
  priceEntry: '',
  priceScale: '',
  amountScale: '',
  numberOfOrders: '',
  amountPerTrade: '',
  marginType: 'cross',
  multiplier: '',
  takeProfitDistancePercent: '',
  accountBalance: '',
  exitOnLastOrder: false,
}

/** Fields that require non-empty string validation before submission */
const REQUIRED_FIELDS: (keyof BacktestFormState)[] = [
  'tradingPair',
  'startDate',
  'endDate',
  'priceEntry',
  'priceScale',
  'amountScale',
  'numberOfOrders',
  'amountPerTrade',
  'multiplier',
  'takeProfitDistancePercent',
  'accountBalance',
]

export const ConfigurationForm: React.FC<ConfigurationFormProps> = ({
  onSubmit,
  initialValues,
  isSubmitting = false,
  serverErrors = {},
}) => {
  const [values, setValues] = useState<BacktestFormState>({ ...EMPTY_FORM, ...initialValues })
  const [touched, setTouched] = useState<FormTouched>({})
  const [errors, setErrors] = useState<FormErrors>({})

  const validateField = useCallback(
    (field: keyof BacktestFormState, value: any): string | undefined => {
      switch (field) {
        case 'tradingPair':
          if (!value || (value as string).trim() === '') return 'Trading pair is required'
          return undefined

        case 'startDate':
          if (!value) return 'Start date is required'
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value as string)) return 'Start date must be YYYY-MM-DD'
          return undefined

        case 'endDate':
          if (!value) return 'End date is required'
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value as string)) return 'End date must be YYYY-MM-DD'
          return undefined

        case 'priceEntry': {
          const n = parseFloat(value as string)
          if (!value) return 'Price entry is required'
          if (isNaN(n) || n <= 0) return 'Price entry must be greater than 0'
          return undefined
        }

        case 'priceScale': {
          const n = parseFloat(value as string)
          if (!value) return 'Price scale is required'
          if (isNaN(n) || n <= 0) return 'Price scale must be greater than 0'
          return undefined
        }

        case 'amountScale': {
          const n = parseFloat(value as string)
          if (!value) return 'Amount scale is required'
          if (isNaN(n) || n <= 0) return 'Amount scale must be greater than 0'
          return undefined
        }

        case 'numberOfOrders': {
          const n = parseInt(value as string, 10)
          if (!value) return 'Number of orders is required'
          if (isNaN(n) || n < 1) return 'Number of orders must be >= 1'
          return undefined
        }

        case 'amountPerTrade': {
          const n = parseFloat(value as string)
          if (!value) return 'Amount per trade is required'
          if (isNaN(n) || n <= 0 || n > 1) return 'Amount per trade must be between 0 and 1'
          return undefined
        }

        case 'multiplier': {
          const n = parseInt(value as string, 10)
          if (!value) return 'Multiplier is required'
          if (isNaN(n) || n < 1) return 'Multiplier must be >= 1'
          return undefined
        }

        case 'takeProfitDistancePercent': {
          const n = parseFloat(value as string)
          if (!value) return 'Take profit distance is required'
          if (isNaN(n) || n <= 0) return 'Take profit distance must be greater than 0'
          return undefined
        }

        case 'accountBalance': {
          const n = parseFloat(value as string)
          if (!value) return 'Account balance is required'
          if (isNaN(n) || n <= 0) return 'Account balance must be greater than 0'
          return undefined
        }

        default:
          return undefined
      }
    },
    [],
  )

  const validateAll = useCallback(() => {
    const newErrors: FormErrors = {}
    for (const f of REQUIRED_FIELDS) {
      const err = validateField(f, values[f])
      if (err) (newErrors as any)[f] = err
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [values, validateField])

  const handleChange = (field: keyof BacktestFormState, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    if (touched[field]) {
      const err = validateField(field, value)
      setErrors((prev) => ({ ...prev, [field]: err }))
    }
  }

  const handleBlur = (field: keyof BacktestFormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }))
    const err = validateField(field, values[field])
    setErrors((prev) => ({ ...prev, [field]: err }))
  }

  const isFormValid = useMemo(() => {
    const allFilled = REQUIRED_FIELDS.every((f) => {
      const v = values[f]
      return typeof v === 'string' && v.trim() !== ''
    })
    if (!allFilled) return false
    return !Object.values(errors).some(Boolean)
  }, [values, errors])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const allTouched: FormTouched = {}
    ;(Object.keys(values) as (keyof BacktestFormState)[]).forEach((k) => {
      allTouched[k] = true
    })
    setTouched(allTouched)
    if (!validateAll()) return
    await onSubmit(values)
  }

  const handleClear = () => {
    setValues({ ...EMPTY_FORM, ...initialValues })
    setTouched({})
    setErrors({})
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="p-6 border border-gray-300 rounded-lg bg-white max-w-3xl mx-auto"
    >
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Backtest Configuration</h2>

      <div className="grid grid-cols-2 gap-x-6">
        <FormInput
          label="Trading Pair"
          type="text"
          value={values.tradingPair}
          onChange={(val) => handleChange('tradingPair', val)}
          onBlur={() => handleBlur('tradingPair')}
          error={errors.tradingPair}
          touched={touched.tradingPair}
          placeholder="e.g., BTC/USDT"
          serverError={serverErrors.tradingPair}
        />

        <FormInput
          label="Start Date"
          type="text"
          value={values.startDate}
          onChange={(val) => handleChange('startDate', val)}
          onBlur={() => handleBlur('startDate')}
          error={errors.startDate}
          touched={touched.startDate}
          placeholder="YYYY-MM-DD"
          serverError={serverErrors.startDate}
        />

        <FormInput
          label="End Date"
          type="text"
          value={values.endDate}
          onChange={(val) => handleChange('endDate', val)}
          onBlur={() => handleBlur('endDate')}
          error={errors.endDate}
          touched={touched.endDate}
          placeholder="YYYY-MM-DD"
          serverError={serverErrors.endDate}
        />

        <FormInput
          label="Price Entry (First Safety Order Drop) (%)"
          type="text"
          value={values.priceEntry}
          onChange={(val) => handleChange('priceEntry', val)}
          onBlur={() => handleBlur('priceEntry')}
          error={errors.priceEntry}
          touched={touched.priceEntry}
          placeholder="e.g., 2.0"
          serverError={serverErrors.priceEntry}
        />

        <FormInput
          label="Price Scale (%)"
          type="text"
          value={values.priceScale}
          onChange={(val) => handleChange('priceScale', val)}
          onBlur={() => handleBlur('priceScale')}
          error={errors.priceScale}
          touched={touched.priceScale}
          placeholder="e.g., 1.10"
          serverError={serverErrors.priceScale}
        />

        <FormInput
          label="Amount Scale (%)"
          type="text"
          value={values.amountScale}
          onChange={(val) => handleChange('amountScale', val)}
          onBlur={() => handleBlur('amountScale')}
          error={errors.amountScale}
          touched={touched.amountScale}
          placeholder="e.g., 2.0"
          serverError={serverErrors.amountScale}
        />

        <FormInput
          label="Number of Orders"
          type="text"
          value={values.numberOfOrders}
          onChange={(val) => handleChange('numberOfOrders', val)}
          onBlur={() => handleBlur('numberOfOrders')}
          error={errors.numberOfOrders}
          touched={touched.numberOfOrders}
          placeholder="e.g., 5"
          serverError={serverErrors.numberOfOrders}
        />

        <FormInput
          label="Amount Per Trade"
          type="text"
          value={values.amountPerTrade}
          onChange={(val) => handleChange('amountPerTrade', val)}
          onBlur={() => handleBlur('amountPerTrade')}
          error={errors.amountPerTrade}
          touched={touched.amountPerTrade}
          placeholder="e.g., 0.10 (fraction of balance)"
          serverError={serverErrors.amountPerTrade}
        />

        {/* Margin Type — select element */}
        <div className="mb-4">
          <label
            htmlFor="margin-type"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Margin Type
          </label>
          <select
            id="margin-type"
            value={values.marginType}
            onChange={(e) =>
              handleChange('marginType', e.target.value as 'cross' | 'isolated')
            }
            className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="cross">Cross</option>
            <option value="isolated">Isolated</option>
          </select>
        </div>

        <FormInput
          label="Multiplier"
          type="text"
          value={values.multiplier}
          onChange={(val) => handleChange('multiplier', val)}
          onBlur={() => handleBlur('multiplier')}
          error={errors.multiplier}
          touched={touched.multiplier}
          placeholder="e.g., 1"
          serverError={serverErrors.multiplier}
        />

        <FormInput
          label="Take Profit Distance %"
          type="text"
          value={values.takeProfitDistancePercent}
          onChange={(val) => handleChange('takeProfitDistancePercent', val)}
          onBlur={() => handleBlur('takeProfitDistancePercent')}
          error={errors.takeProfitDistancePercent}
          touched={touched.takeProfitDistancePercent}
          placeholder="e.g., 2.5"
          serverError={serverErrors.takeProfitDistancePercent}
        />

        <FormInput
          label="Account Balance"
          type="text"
          value={values.accountBalance}
          onChange={(val) => handleChange('accountBalance', val)}
          onBlur={() => handleBlur('accountBalance')}
          error={errors.accountBalance}
          touched={touched.accountBalance}
          placeholder="e.g., 1000.00"
          serverError={serverErrors.accountBalance}
        />
      </div>

      {/* Exit on Last Order — full width checkbox */}
      <div className="mb-6 flex items-center gap-3">
        <input
          id="exit-on-last-order"
          type="checkbox"
          checked={values.exitOnLastOrder}
          onChange={(e) => handleChange('exitOnLastOrder', e.target.checked)}
          className="w-4 h-4 border-gray-300 rounded"
        />
        <label htmlFor="exit-on-last-order" className="text-sm font-medium text-gray-700">
          Exit on Last Order
        </label>
      </div>

      {/* Submit / Clear */}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!isFormValid || isSubmitting}
          className={`flex-1 py-2 rounded font-medium transition-colors ${
            !isFormValid || isSubmitting
              ? 'bg-gray-400 text-gray-700 cursor-not-allowed'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          {isSubmitting ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></span>
              Submitting...
            </>
          ) : (
            'Submit'
          )}
        </button>

        <button
          type="button"
          onClick={handleClear}
          className="flex-1 py-2 rounded font-medium bg-gray-500 text-white hover:bg-gray-600 transition-colors"
        >
          Clear
        </button>
      </div>
    </form>
  )
}

