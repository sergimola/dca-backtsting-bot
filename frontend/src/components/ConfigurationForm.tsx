import React, { useState, useCallback, useMemo } from 'react'
import { FormInput } from './FormInput'
import type { BacktestConfiguration } from '../../services/types'

interface ConfigurationFormProps {
  onSubmit: (config: BacktestConfiguration) => void | Promise<void>
  initialValues?: BacktestConfiguration
  isSubmitting?: boolean
  serverErrors?: Record<string, string>
}

interface FormState {
  entryPrice: number | ''
  amounts: (number | '')[]
  sequences: number | ''
  leverage: number | ''
  marginRatio: number | ''
  market_data_csv_path: string
}

interface FormErrors {
  entryPrice?: string
  amounts?: string
  sequences?: string
  leverage?: string
  marginRatio?: string
}

interface FormTouched {
  entryPrice?: boolean
  amounts?: Record<number, boolean>
  sequences?: boolean
  leverage?: boolean
  marginRatio?: boolean
}

export const ConfigurationForm: React.FC<ConfigurationFormProps> = ({
  onSubmit,
  initialValues,
  isSubmitting = false,
  serverErrors = {},
}) => {
  const [values, setValues] = useState<FormState>({
    entryPrice: initialValues?.entryPrice || '',
    amounts: initialValues?.amounts || [''],
    sequences: initialValues?.sequences || '',
    leverage: initialValues?.leverage || '',
    marginRatio: initialValues?.marginRatio || '',
    market_data_csv_path: initialValues?.market_data_csv_path || '/data/BTCUSDT_1m.csv',
  })

  const [touched, setTouched] = useState<FormTouched>({})
  const [errors, setErrors] = useState<FormErrors>({})

  // Validation logic
  const validateField = useCallback(
    (fieldName: keyof FormState, value: any): string | undefined => {
      switch (fieldName) {
        case 'entryPrice': {
          const numValue = Number(value)
          if (!value && value !== 0) return undefined // Allow empty for now
          if (numValue <= 0) return 'Entry price must be greater than 0'
          return undefined
        }

        case 'amounts': {
          if (!Array.isArray(value)) return undefined
          if (value.length === 0) return 'At least one amount is required'
          const hasInvalid = value.some((v) => {
            if (!v && v !== 0) return false
            return Number(v) <= 0
          })
          if (hasInvalid) return 'All amounts must be greater than 0'
          return undefined
        }

        case 'sequences': {
          const numValue = Number(value)
          if (!value && value !== 0) return undefined
          if (numValue < 1 || numValue > 10) return 'Sequences must be between 1 and 10'
          return undefined
        }

        case 'leverage': {
          const numValue = Number(value)
          if (!value && value !== 0) return undefined
          if (numValue < 1 || numValue > 25) return 'Leverage must be between 1 and 25'
          return undefined
        }

        case 'marginRatio': {
          const numValue = Number(value)
          if (!value && value !== 0) return undefined
          if (numValue < 1 || numValue > 100) return 'Margin ratio must be between 1 and 100'
          return undefined
        }

        default:
          return undefined
      }
    },
    []
  )

  // Validate all fields
  const validateAllFields = useCallback(() => {
    const newErrors: FormErrors = {}

    if (!values.entryPrice && values.entryPrice !== 0) {
      newErrors.entryPrice = 'Entry price is required'
    } else {
      const err = validateField('entryPrice', values.entryPrice)
      if (err) newErrors.entryPrice = err
    }

    if (values.amounts.length === 0 || values.amounts.every((v) => !v && v !== 0)) {
      newErrors.amounts = 'At least one amount is required'
    } else {
      const err = validateField('amounts', values.amounts)
      if (err) newErrors.amounts = err
    }

    if (!values.sequences && values.sequences !== 0) {
      newErrors.sequences = 'Sequences is required'
    } else {
      const err = validateField('sequences', values.sequences)
      if (err) newErrors.sequences = err
    }

    if (!values.leverage && values.leverage !== 0) {
      newErrors.leverage = 'Leverage is required'
    } else {
      const err = validateField('leverage', values.leverage)
      if (err) newErrors.leverage = err
    }

    if (!values.marginRatio && values.marginRatio !== 0) {
      newErrors.marginRatio = 'Margin ratio is required'
    } else {
      const err = validateField('marginRatio', values.marginRatio)
      if (err) newErrors.marginRatio = err
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [values, validateField])

  // Handle field change
  const handleFieldChange = (fieldName: keyof FormState, value: any) => {
    setValues((prev) => ({
      ...prev,
      [fieldName]: value,
    }))

    // Validate on change
    if (touched[fieldName]) {
      const error = validateField(fieldName, value)
      setErrors((prev) => ({
        ...prev,
        [fieldName]: error,
      }))
    }
  }

  // Handle field blur
  const handleBlur = (fieldName: keyof FormState) => {
    setTouched((prev) => ({
      ...prev,
      [fieldName]: true,
    }))

    const error = validateField(fieldName, values[fieldName])
    setErrors((prev) => ({
      ...prev,
      [fieldName]: error,
    }))
  }

  // Handle amount change
  const handleAmountChange = (index: number, value: any) => {
    const newAmounts = [...values.amounts]
    newAmounts[index] = value

    handleFieldChange('amounts', newAmounts)

    // Mark as touched
    setTouched((prev) => ({
      ...prev,
      amounts: {
        ...(prev.amounts || {}),
        [index]: true,
      },
    }))
  }

  // Add new amount
  const handleAddAmount = () => {
    setValues((prev) => ({
      ...prev,
      amounts: [...prev.amounts, ''],
    }))
  }

  // Remove amount
  const handleRemoveAmount = (index: number) => {
    if (values.amounts.length === 1) return // Can't remove last amount

    setValues((prev) => ({
      ...prev,
      amounts: prev.amounts.filter((_, i) => i !== index),
    }))

    // Clear error for this field
    const err = validateField('amounts', values.amounts.filter((_, i) => i !== index))
    setErrors((prev) => ({
      ...prev,
      amounts: err,
    }))
  }

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Mark all fields as touched
    setTouched({
      entryPrice: true,
      sequences: true,
      leverage: true,
      marginRatio: true,
      amounts: values.amounts.reduce(
        (acc, _, i) => {
          acc[i] = true
          return acc
        },
        {} as Record<number, boolean>
      ),
    })

    // Validate all fields
    const validationErrors: FormErrors = {}

    if (!values.entryPrice && values.entryPrice !== 0) {
      validationErrors.entryPrice = 'Entry price is required'
    } else {
      const err = validateField('entryPrice', values.entryPrice)
      if (err) validationErrors.entryPrice = err
    }

    if (values.amounts.length === 0 || values.amounts.every((v) => !v && v !== 0)) {
      validationErrors.amounts = 'At least one amount is required'
    } else {
      const err = validateField('amounts', values.amounts)
      if (err) validationErrors.amounts = err
    }

    if (!values.sequences && values.sequences !== 0) {
      validationErrors.sequences = 'Sequences is required'
    } else {
      const err = validateField('sequences', values.sequences)
      if (err) validationErrors.sequences = err
    }

    if (!values.leverage && values.leverage !== 0) {
      validationErrors.leverage = 'Leverage is required'
    } else {
      const err = validateField('leverage', values.leverage)
      if (err) validationErrors.leverage = err
    }

    if (!values.marginRatio && values.marginRatio !== 0) {
      validationErrors.marginRatio = 'Margin ratio is required'
    } else {
      const err = validateField('marginRatio', values.marginRatio)
      if (err) validationErrors.marginRatio = err
    }

    setErrors(validationErrors)

    if (Object.keys(validationErrors).length > 0) return

    const config: BacktestConfiguration = {
      entryPrice: Number(values.entryPrice),
      amounts: (values.amounts as (number | string)[]).map(Number),
      sequences: Number(values.sequences),
      leverage: Number(values.leverage),
      marginRatio: Number(values.marginRatio),
      market_data_csv_path: values.market_data_csv_path,
    }

    await onSubmit(config)
  }

  // Handle clear
  const handleClear = () => {
    setValues({
      entryPrice: initialValues?.entryPrice || '',
      amounts: initialValues?.amounts || [''],
      sequences: initialValues?.sequences || '',
      leverage: initialValues?.leverage || '',
      marginRatio: initialValues?.marginRatio || '',
      market_data_csv_path: initialValues?.market_data_csv_path || '/data/BTCUSDT_1m.csv',
    })
    setTouched({})
    setErrors({})
  }

  // Calculate form validity without causing infinite loops
  const isFormValid = useMemo(() => {
    const hasAllValues =
      values.entryPrice &&
      values.sequences &&
      values.leverage &&
      values.marginRatio &&
      values.amounts.length > 0 &&
      values.amounts.some((a) => a !== '' && a !== 0)

    // Basic checks before full validation
    if (!hasAllValues) return false

    // Check for any existing errors
    const hasErrors =
      errors.entryPrice ||
      errors.amounts ||
      errors.sequences ||
      errors.leverage ||
      errors.marginRatio

    return !hasErrors
  }, [values, errors])

  return (
    <form onSubmit={handleSubmit} className="p-6 border border-gray-300 rounded-lg bg-white max-w-md mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Backtest Configuration</h2>

      {/* Entry Price */}
      <FormInput
        label="Entry Price"
        type="number"
        value={values.entryPrice}
        onChange={(val) => handleFieldChange('entryPrice', val)}
        onBlur={() => handleBlur('entryPrice')}
        error={errors.entryPrice}
        touched={touched.entryPrice}
        placeholder="e.g., 50000"
        step="0.01"
        serverError={serverErrors.entryPrice}
      />

      {/* Amounts Array */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Amounts</label>
        <div className="space-y-2">
          {values.amounts.map((amount, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="number"
                value={amount}
                onChange={(e) => handleAmountChange(index, e.target.value || '')}
                onBlur={() => {
                  setTouched((prev) => ({
                    ...prev,
                    amounts: {
                      ...(prev.amounts || {}),
                      [index]: true,
                    },
                  }))
                }}
                placeholder="e.g., 100"
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {values.amounts.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveAmount(index)}
                  className="bg-red-500 text-white px-3 py-2 rounded hover:bg-red-600 transition-colors"
                  title="Remove"
                >
                  -
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={handleAddAmount}
          className="mt-2 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 transition-colors"
        >
          + Add
        </button>
        {(errors.amounts || serverErrors.amounts) && touched.amounts ? (
          <p className="text-red-600 text-sm mt-2">{errors.amounts || serverErrors.amounts}</p>
        ) : null}
      </div>

      {/* Sequences */}
      <FormInput
        label="Sequences"
        type="number"
        value={values.sequences}
        onChange={(val) => handleFieldChange('sequences', val)}
        onBlur={() => handleBlur('sequences')}
        error={errors.sequences}
        touched={touched.sequences}
        placeholder="e.g., 5"
        step="1"
        min="1"
        max="10"
        serverError={serverErrors.sequences}
      />

      {/* Leverage */}
      <FormInput
        label="Leverage"
        type="number"
        value={values.leverage}
        onChange={(val) => handleFieldChange('leverage', val)}
        onBlur={() => handleBlur('leverage')}
        error={errors.leverage}
        touched={touched.leverage}
        placeholder="e.g., 2"
        step="0.1"
        min="1"
        max="25"
        serverError={serverErrors.leverage}
      />

      {/* Margin Ratio */}
      <FormInput
        label="Margin Ratio"
        type="number"
        value={values.marginRatio}
        onChange={(val) => handleFieldChange('marginRatio', val)}
        onBlur={() => handleBlur('marginRatio')}
        error={errors.marginRatio}
        touched={touched.marginRatio}
        placeholder="e.g., 50"
        step="0.1"
        min="0"
        max="100"
        serverError={serverErrors.marginRatio}
      />

      {/* Market Data CSV Path */}
      <FormInput
        label="Market Data CSV Path"
        type="text"
        value={values.market_data_csv_path}
        onChange={(val) => handleFieldChange('market_data_csv_path', val)}
        placeholder="/data/BTCUSDT_1m.csv"
        serverError={serverErrors.market_data_csv_path}
      />

      {/* Buttons */}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!isFormValid || isSubmitting}
          className={`flex-1 py-2 rounded font-medium transition-colors ${
            !isFormValid || isSubmitting
              ? 'bg-gray-400 text-gray-700 cursor-not-allowed'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          } ${isSubmitting ? 'flex items-center justify-center' : ''}`}
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
