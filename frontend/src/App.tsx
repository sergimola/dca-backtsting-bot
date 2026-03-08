import { ConfigurationForm } from './components/ConfigurationForm'
import type { BacktestConfiguration } from './services/types'

export default function App() {
  const handleSubmit = (config: BacktestConfiguration) => {
    console.log('Form submitted with configuration:', config)
    alert(`Configuration submitted!\n\nEntry Price: ${config.entryPrice}\nAmounts: ${config.amounts.join(', ')}\nSequences: ${config.sequences}\nLeverage: ${config.leverage}\nMargin Ratio: ${config.marginRatio}%`)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">DCA Backtesting Bot</h1>
          <p className="text-lg text-gray-600">Configure your Dollar-Cost Averaging strategy</p>
        </header>

        <div className="bg-white rounded-xl shadow-lg p-8">
          <ConfigurationForm onSubmit={handleSubmit} />
        </div>

        <footer className="text-center mt-8 text-sm text-gray-600">
          <p>Phase 4: ConfigurationForm Visual Verification</p>
        </footer>
      </div>
    </div>
  )
}
