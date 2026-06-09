import { useState, useCallback, useEffect } from 'react'
import type { Order, AppState, AppConfig } from './types'
import { PasteArea } from './components/PasteArea'
import { OrderTable } from './components/OrderTable'
import { SubmitControls } from './components/SubmitControls'
import { FillStatus } from './components/FillStatus'
import { SettlementPanel } from './components/SettlementPanel'
import { submitOrders, getConfig } from './api/client'

interface SubmittedOrder {
  emsxSequence: number
  orderId: string
  ticker: string
  bs: 'BUY' | 'SELL'
  lots: number
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('EMPTY')
  const [orders, setOrders] = useState<Order[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [submitted, setSubmitted] = useState<SubmittedOrder[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch(() => {
        // Backend not reachable yet — show placeholder; will retry on next action
      })
  }, [])

  const handleParsed = useCallback((parsed: Order[], errors: string[]) => {
    if (parsed.length === 0 && errors.length === 0) return
    setOrders(parsed)
    setParseErrors(errors)
    setAppState(parsed.length > 0 ? 'REVIEW' : 'EMPTY')
    setSubmitError(null)
  }, [])

  const handleReset = useCallback(() => {
    setOrders([])
    setParseErrors([])
    setSubmitted([])
    setSubmitError(null)
    setAppState('EMPTY')
  }, [])

  const handleSubmit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    setAppState('SUBMITTING')
    try {
      const { results } = await submitOrders(orders)
      const submittedList: SubmittedOrder[] = results.map((r, i) => ({
        emsxSequence: r.emsxSequence,
        orderId: r.orderId,
        ticker: orders[i].ticker,
        bs: orders[i].bs,
        lots: orders[i].lots,
      }))
      setSubmitted(submittedList)
      setAppState('MONITORING')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to submit orders')
      setAppState('REVIEW')
    } finally {
      setSubmitting(false)
    }
  }

  const uniqueTickers = [...new Set(orders.map(o => o.ticker))]

  return (
    <div className="min-h-screen bg-slate-900">
      {appState === 'EMPTY' && (
        <PasteArea onParsed={handleParsed} />
      )}

      {(appState === 'REVIEW' || appState === 'SUBMITTING') && (
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">LME Order Entry</h1>
              <p className="text-slate-400 text-sm mt-0.5">
                {orders.length} LME_NTP order{orders.length !== 1 ? 's' : ''} ready for submission
                {parseErrors.length > 0 && ` · ${parseErrors.length} warning${parseErrors.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <div className="text-xs text-slate-500 text-right">
              <div>Exchange: <span className="text-slate-300">LME</span></div>
              <div>Bloomberg EMSX</div>
            </div>
          </div>

          <OrderTable orders={orders} errors={parseErrors} config={config} />

          {submitError && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
              {submitError}
            </div>
          )}

          <SubmitControls
            orders={orders}
            config={config}
            onSubmit={handleSubmit}
            onReset={handleReset}
            submitting={submitting}
          />
        </div>
      )}

      {(appState === 'MONITORING' || appState === 'SETTLED') && (
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">LME Order Entry</h1>
              <p className="text-slate-400 text-sm mt-0.5">
                {submitted.length} order{submitted.length !== 1 ? 's' : ''} submitted to Bloomberg EMSX
              </p>
            </div>
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors text-sm"
            >
              New Session
            </button>
          </div>

          <FillStatus
            emsxSequences={submitted.map(s => s.emsxSequence)}
            submittedOrders={submitted}
            onAllFilled={() => setAppState('SETTLED')}
          />

          {appState === 'SETTLED' && (
            <div className="border-t border-slate-700 pt-8">
              <SettlementPanel tickers={uniqueTickers} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
