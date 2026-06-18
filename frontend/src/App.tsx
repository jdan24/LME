import { useState, useCallback, useEffect, useRef } from 'react'
import type { Order, AppState, AppConfig } from './types'
import { PasteArea } from './components/PasteArea'
import { OrderTable } from './components/OrderTable'
import { SubmitControls } from './components/SubmitControls'
import { FillStatus } from './components/FillStatus'
import { SettlementPanel } from './components/SettlementPanel'
import { EnvironmentBanner } from './components/EnvironmentBanner'
import { submitOrders, getConfig, checkDuplicates, getBlotterOrders } from './api/client'
import { isLmeTicker } from './utils/lmeConfig'

// Status is no longer filtered when pulling from the blotter — every status
// (active, filled, cancelled, rejected) is loaded so the Active/Filled/All
// toggle on the Fill Status screen has the full picture to filter from.

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
  const [duplicateMatches, setDuplicateMatches] = useState<Record<string, Array<{ emsxSequence: number; status: string }>>>({})
  const [config, setConfig] = useState<AppConfig | null>(null)

  // Identifies the current import batch so retries from a previous import (or a
  // reset) can be discarded when a newer import supersedes them.
  const dupBatchRef = useRef(0)

  // Mirror of submitted kept in a ref so handleRefreshOrders always sees the
  // latest list without a stale closure (and without [submitted] as a dep).
  const submittedRef = useRef<SubmittedOrder[]>([])

  useEffect(() => { submittedRef.current = submitted }, [submitted])

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
        .then(({ duplicates, checked, matches }) => {
          if (dupBatchRef.current !== batch) return  // superseded by a newer import/reset
          setDupChecked(checked)
          if (duplicates.length > 0) {
            setDuplicateIds(prev => {
              const next = new Set(prev)
              duplicates.forEach(d => next.add(d))
              return next
            })
            if (matches && Object.keys(matches).length > 0) {
              // Union (not overwrite) per orderId: later retries can surface additional
              // EMSX orders as the blotter cache populates, and a match seen on an earlier
              // attempt must not be dropped just because a later attempt's array omits it.
              setDuplicateMatches(prev => {
                const next = { ...prev }
                for (const [orderId, newMatches] of Object.entries(matches)) {
                  const merged = new Map((next[orderId] ?? []).map(m => [m.emsxSequence, m]))
                  newMatches.forEach(m => merged.set(m.emsxSequence, m))
                  next[orderId] = [...merged.values()].sort((a, b) => b.emsxSequence - a.emsxSequence)
                }
                return next
              })
            }
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
    setDuplicateMatches({})
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

  // Pick up a monitoring session without importing: pull every LME order already
  // in the shared EMSX blotter (any status — the Fill Status screen's
  // Active/Filled/All toggle decides what's displayed). Returns the count loaded
  // (0 if none found) and throws if the bridge is unreachable, so the caller can
  // show feedback.
  const handleMonitorBlotter = useCallback(async (): Promise<number> => {
    const { orders: blotter } = await getBlotterOrders()
    // Today as YYYYMMDD (matches EMSX_ORDER_CREATE_DATE). Orders with no create
    // date (0 — e.g. if EMSX didn't deliver the field) are kept rather than hidden.
    const now = new Date()
    const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
    const lme = blotter.filter(o =>
      isLmeTicker(o.ticker) &&
      (!o.createDate || o.createDate === today)
    )
    if (lme.length === 0) return 0
    const list: SubmittedOrder[] = lme.map(o => ({
      emsxSequence: o.emsxSequence,
      orderId: o.notes ?? '',
      ticker: o.ticker,
      bs: o.bs,
      lots: o.lots,
    }))
    setSubmitted(list)
    setAppState('MONITORING')
    return lme.length
  }, [])

  // Called by FillStatus on explicit "Refresh Fills" clicks — checks the blotter
  // for orders that appeared after the current session started (e.g. a re-submitted
  // order with a new emsxSequence the teammate's session doesn't know about yet).
  // Reads submittedRef.current (always current) to avoid stale closures; the
  // functional updater provides a final dedup guard against any concurrent state change.
  const handleRefreshOrders = useCallback(async (): Promise<number> => {
    try {
      const { orders: blotter } = await getBlotterOrders()
      const now = new Date()
      const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
      const knownSeqs = new Set(submittedRef.current.map(o => o.emsxSequence))
      const novel: SubmittedOrder[] = blotter
        .filter(o =>
          isLmeTicker(o.ticker) &&
          !knownSeqs.has(o.emsxSequence) &&
          (!o.createDate || o.createDate === today)
        )
        .map(o => ({
          emsxSequence: o.emsxSequence,
          orderId: o.notes ?? '',
          ticker: o.ticker,
          bs: o.bs,
          lots: o.lots,
        }))
      if (novel.length > 0) {
        setSubmitted(prev => {
          const latestKnown = new Set(prev.map(o => o.emsxSequence))
          const actuallyNew = novel.filter(o => !latestKnown.has(o.emsxSequence))
          return actuallyNew.length > 0 ? [...prev, ...actuallyNew] : prev
        })
      }
      return novel.length
    } catch {
      return 0
    }
  }, [])

  const handleReset = useCallback(() => {
    dupBatchRef.current++  // cancel any in-flight retry loop
    setOrders([])
    setSelected([])
    setDuplicateIds(new Set())
    setDuplicateMatches({})
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

  // Select All checks every row. Rows already in EMSX stay flagged (⚠ IN EMSX)
  // so the trader still sees the duplicate risk before staging.
  const selectAll  = useCallback(
    () => setSelected(orders.map(() => true)),
    [orders]
  )
  const selectNone = useCallback(() => setSelected(prev => prev.map(() => false)), [])
  // Select New checks only rows whose orderId was NOT found in the EMSX blotter,
  // deselecting everything else — an absolute selection like Select All/None.
  const selectNew = useCallback(
    () => setSelected(orders.map(o => !duplicateIds.has(o.orderId))),
    [orders, duplicateIds]
  )

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

      // Merge any team LME orders already in the shared blotter that weren't
      // part of this submission (e.g. staged by a teammate on the same account).
      try {
        const { orders: blotter } = await getBlotterOrders()
        const now = new Date()
        const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
        const ownSeqs = new Set(submittedList.map(o => o.emsxSequence))
        const teamOrders: SubmittedOrder[] = blotter
          .filter(o =>
            isLmeTicker(o.ticker) &&
            !ownSeqs.has(o.emsxSequence) &&
            (!o.createDate || o.createDate === today)
          )
          .map(o => ({
            emsxSequence: o.emsxSequence,
            orderId: o.notes ?? '',
            ticker: o.ticker,
            bs: o.bs,
            lots: o.lots,
          }))
        if (teamOrders.length > 0) {
          setSubmitted([...submittedList, ...teamOrders])
        }
      } catch {
        // best-effort: own submitted orders are still shown if this fails
      }
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
      {config && <EnvironmentBanner environment={config.environment} />}

      {appState === 'EMPTY' && (
        <PasteArea onParsed={handleParsed} onMonitorBlotter={handleMonitorBlotter} />
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
            duplicateMatches={duplicateMatches}
            dupChecked={dupChecked}
            dupChecking={dupChecking}
            onToggle={toggleRow}
            onSelectNew={selectNew}
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
            onRefreshOrders={handleRefreshOrders}
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
