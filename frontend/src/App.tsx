import { useState, useCallback, useEffect, useRef } from 'react'
import type { Order, AppState, AppConfig } from './types'
import { PasteArea } from './components/PasteArea'
import { OrderTable } from './components/OrderTable'
import { SubmitControls } from './components/SubmitControls'
import { FillStatus } from './components/FillStatus'
import { SettlementPanel } from './components/SettlementPanel'
import { submitOrders, getConfig, checkDuplicates } from './api/client'

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
  const [selected, setSelected] = useState<boolean[]>([])
  const [duplicateIds, setDuplicateIds] = useState<Set<string>>(new Set())
  const [dupChecked, setDupChecked] = useState(true)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [submitted, setSubmitted] = useState<SubmittedOrder[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [dupChecking, setDupChecking] = useState(false)
  const [config, setConfig] = useState<AppConfig | null>(null)

  // Identifies the current import batch so retries from a previous import (or a
  // reset) can be discarded when a newer import supersedes them.
  const dupBatchRef = useRef(0)

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch(() => {
        // Backend not reachable yet — show placeholder; will retry on next action
      })
  }, [])

  // De-dup against EMSX. The order blotter streams into the backend cache
  // asynchronously and can take several seconds to finish its initial load after
  // a bridge restart, so a single check on import can run before the blotter is
  // there. We check immediately, then re-check a few times to catch orders that
  // arrive late. Results are merged (union) so a flag is never lost between tries.
  const runDupCheck = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const batch = ++dupBatchRef.current
    setDupChecking(true)

    const attempt = (delays: number[]) => {
      checkDuplicates(ids)
        .then(({ duplicates, checked }) => {
          if (dupBatchRef.current !== batch) return  // superseded by a newer import/reset
          setDupChecked(checked)
          if (duplicates.length > 0) {
            setDuplicateIds(prev => {
              const next = new Set(prev)
              duplicates.forEach(d => next.add(d))
              return next
            })
          }
          if (delays.length > 0) {
            const [first, ...rest] = delays
            setTimeout(() => { if (dupBatchRef.current === batch) attempt(rest) }, first)
          } else {
            setDupChecking(false)
          }
        })
        .catch(() => {
          if (dupBatchRef.current !== batch) return
          setDupChecked(false)
          setDupChecking(false)
        })
    }

    attempt([2500, 4000, 6000])
  }, [])

  const handleParsed = useCallback((parsed: Order[], errors: string[]) => {
    if (parsed.length === 0 && errors.length === 0) return
    setOrders(parsed)
    // All rows start UNCHECKED — the user explicitly selects which to submit
    setSelected(new Array(parsed.length).fill(false))
    setDuplicateIds(new Set())
    setDupChecked(true)
    setParseErrors(errors)
    setAppState(parsed.length > 0 ? 'REVIEW' : 'EMPTY')
    setSubmitError(null)

    if (parsed.length > 0) {
      runDupCheck(parsed.map(o => o.orderId).filter(Boolean))
    }
  }, [runDupCheck])

  // Manual re-check — lets the trader force a fresh EMSX lookup once the blotter
  // has finished loading, without re-importing.
  const recheckDuplicates = useCallback(() => {
    runDupCheck(orders.map(o => o.orderId).filter(Boolean))
  }, [orders, runDupCheck])

  const handleReset = useCallback(() => {
    dupBatchRef.current++  // cancel any in-flight retry loop
    setOrders([])
    setSelected([])
    setDuplicateIds(new Set())
    setDupChecked(true)
    setDupChecking(false)
    setParseErrors([])
    setSubmitted([])
    setSubmitError(null)
    setAppState('EMPTY')
  }, [])

  const toggleRow = useCallback((index: number) => {
    setSelected(prev => prev.map((v, i) => (i === index ? !v : v)))
  }, [])

  // Select All skips rows already in EMSX (duplicates); a trader can still
  // manually check a flagged row to override.
  const selectAll  = useCallback(
    () => setSelected(orders.map(o => !duplicateIds.has(o.orderId))),
    [orders, duplicateIds]
  )
  const selectNone = useCallback(() => setSelected(prev => prev.map(() => false)), [])

  // Only checked rows are submitted
  const selectedOrders = orders.filter((_, i) => selected[i])

  const handleSubmit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    setAppState('SUBMITTING')
    try {
      const { results } = await submitOrders(selectedOrders)
      const submittedList: SubmittedOrder[] = results.map((r, i) => ({
        emsxSequence: r.emsxSequence,
        orderId: r.orderId,
        ticker: selectedOrders[i].ticker,
        bs: selectedOrders[i].bs,
        lots: selectedOrders[i].lots,
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

  // Settlement is fetched for the tickers that were actually submitted
  const uniqueTickers = [...new Set(submitted.map(s => s.ticker))]

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
                {orders.length} LME_NTP order{orders.length !== 1 ? 's' : ''} imported
                {' · '}
                <span className="text-blue-300">{selectedOrders.length} selected</span>
                {parseErrors.length > 0 && ` · ${parseErrors.length} warning${parseErrors.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <div className="text-xs text-slate-500 text-right">
              <div>Exchange: <span className="text-slate-300">LME</span></div>
              <div>Bloomberg EMSX</div>
            </div>
          </div>

          <OrderTable
            orders={orders}
            errors={parseErrors}
            config={config}
            selected={selected}
            duplicateIds={duplicateIds}
            dupChecked={dupChecked}
            dupChecking={dupChecking}
            onToggle={toggleRow}
            onSelectAll={selectAll}
            onSelectNone={selectNone}
            onRecheckDuplicates={recheckDuplicates}
          />

          {submitError && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
              {submitError}
            </div>
          )}

          <SubmitControls
            orders={selectedOrders}
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
                {submitted.length} order{submitted.length !== 1 ? 's' : ''} staged in Bloomberg EMSX — route manually in EMSX
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
