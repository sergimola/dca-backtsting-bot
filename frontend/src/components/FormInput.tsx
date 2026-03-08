import React from 'react'

interface FormInputProps {
  label: string
  type: string
  value: any
  onChange: (value: any) => void
  onBlur?: () => void
  error?: string
  touched?: boolean
  placeholder?: string
  serverError?: string
  name?: string
  [key: string]: any
}

export const FormInput: React.FC<FormInputProps> = ({
  label,
  type,
  value,
  onChange,
  onBlur,
  error,
  touched,
  placeholder,
  serverError,
  name,
  ...inputProps
}) => {
  const finalError = error || serverError
  const showError = finalError && touched
  const inputId = name || label.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="mb-4">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value || '')}
        onBlur={onBlur}
        placeholder={placeholder}
        className={`w-full border rounded px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 ${
          showError
            ? 'border-red-500 focus:ring-red-500 bg-red-50'
            : 'border-gray-300 focus:ring-blue-500'
        }`}
        {...inputProps}
      />
      {showError && <p className="text-red-600 text-sm mt-1">{finalError}</p>}
    </div>
  )
}
