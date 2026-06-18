import { useState, useEffect } from 'react'
import { getFillStatus } from '../api/client'
import type { FillStatus as FillStatusType, FillStatusFilter } from '../types'
import { contractLabel } from '../utils/lmeConfig'
import { TradeRecap } from './TradeRecap'
import { OrderSummary } from './OrderSummary'
import { StatusBadge } from './StatusBadge'

interface Props {
  emsxSequences: number[]
  submittedOrders: Array<{ emsxSequence: number; orderId: string; ticker: string; bs: 'BUY' | 'SELL'; lots: number }>
  onAllFilled: () => void
  onRefreshOrders?: () => Promise<number>
}

// Explicit set avoids substring matches (e.g. /CANCEL/i would unintentionally
// match a status string like "FULLFILL_CANCEL" if Bloomberg ever uses one).
const DEAD_STATUSES = new Set(['CANCEL', 'CANCELED', 'CANCELLED', 'CXLPENDING', 'REJECTED'])
const FILLED_STATUSES = new Set(['FILLED', 'FULLFILL'])

const FILTER_LABELS: Record<FillStatusFilter, string> = {
  ACTIVE: 'Active',
  FILLED: 'Filled',
  ALL: 'All',
}

// Display-only filter — never affects allFilled/settlement or the recap, which
// always consider every order regardless of which tab is selected.
function matchesFilter(status: string, mode: FillStatusFilter): boolean {
  const s = status.toUpperCase()
  if (mode === 'ALL') return true
  if (mode === 'FILLED') return FILLED_STATUSES.has(s)
  return !DEAD_STATUSES.has(s) && !FILLED_STATUSES.has(s)
}

export function FillStatus({ emsxSequences, submittedOrders, onAllFilled, onRefreshOrders }: Props) {
  const [fills, setFills] = useState<FillStatusType[]>([])
  const [loading, setLoading] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSummary, setShowSummary] = useState(false)
  const [newOrdersAdded, setNewOrdersAdded] = useState(0)
  const [filterMode, setFilterMode] = useState<FillStatusFilter>('ACTIVE')

  // Settlement/recap always consider every order, regardless of the display filter.
  const allFilled = fills.length > 0 && fills.every(f => f.filledAmount >= f.lots)

  const refresh = async (syncBlotter = true) => {
    setLoading(true)
    setError(null)
    setNewOrdersAdded(0)
    try {
      const { fills: updated } = await getFillStatus(emsxSequences)
      setFills(updated)
      setLastRefreshed(new Date())
      if (syncBlotter && onRefreshOrders) {
        const added = await onRefreshOrders()
        if (added > 0) {
          setNewOrdersAdded(added)
          setTimeout(() => setNewOrdersAdded(0), 5000)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error fetching fills')
    } finally {
      setLoading(false)
    }
  }

  // Pull fills once on mount so the screen is populated immediately — both after
  // submitting and when a teammate picks up a session from the blotter.
  // syncBlotter=false avoids racing handleSubmit's concurrent blotter merge, which
  // would cause duplicate rows (both would append the same working orders to submitted).
  useEffect(() => {
    if (emsxSequences.length > 0) refresh(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const contractFromTicker = (ticker: string) => ticker.replace(' Comdty', '')

  const visibleOrders = submittedOrders.filter(o =>
    matchesFilter(fills.find(f => f.emsxSequence === o.emsxSequence)?.status ?? 'PENDING', filterMode)
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white text-lg font-semibold">Fill Status</h2>
          {lastRefreshed && (
            <p className="text-slate-500 text-xs mt-0.5">
              Last refreshed: {lastRefreshed.toLocaleTimeString()}
            </p>
          )}
          {newOrdersAdded > 0 && (
            <p className="text-blue-400 text-xs mt-0.5">
              {newOrdersAdded} new order{newOrdersAdded !== 1 ? 's' : ''} picked up from EMSX
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-700 overflow-hidden">
            {(Object.keys(FILTER_LABELS) as FillStatusFilter[]).map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterMode === mode
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {FILTER_LABELS[mode]}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowSummary(true)}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors text-sm font-medium"
          >
            Summarize Selected
          </button>
          <button
            onClick={() => refresh()}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-slate-400 border-t-white rounded-full animate-spin" />
            ) : '↻'}
            Refresh Fills
          </button>
        </div>
      </div>

      {showSummary && (
        <OrderSummary orders={submittedOrders} onClose={() => setShowSummary(false)} />
      )}

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-slate-400 text-left">
              <th className="px-4 py-3 font-medium">Seq #</th>
              <th className="px-4 py-3 font-medium">Order ID</th>
              <th className="px-4 py-3 font-medium">Symbol</th>
              <th className="px-4 py-3 font-medium">Side</th>
              <th className="px-4 py-3 font-medium text-right">Ordered</th>
              <th className="px-4 py-3 font-medium text-right">Filled</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500 text-sm">
                  No {FILTER_LABELS[filterMode].toLowerCase()} orders to show.
                </td>
              </tr>
            )}
            {visibleOrders.map((o) => {
              const fill = fills.find(f => f.emsxSequence === o.emsxSequence)
              const filled = fill?.filledAmount ?? 0
              const pct = Math.min(100, Math.round((filled / o.lots) * 100))
              const status = fill?.status ?? 'PENDING'

              return (
                <tr key={o.emsxSequence} className="border-t border-slate-700">
                  <td className="px-4 py-3 font-mono text-slate-400 text-xs">{o.emsxSequence}</td>
                  <td className="px-4 py-3 font-mono text-slate-400 text-xs">{o.orderId || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-white">{o.ticker}</div>
                    <div className="text-slate-500 text-xs">{contractLabel(contractFromTicker(o.ticker))}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${
                      o.bs === 'BUY'
                        ? 'bg-green-900/50 text-green-400 border border-green-700'
                        : 'bg-red-900/50 text-red-400 border border-red-700'
                    }`}>{o.bs}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-white">{o.lots.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-mono text-white">{filled.toLocaleString()}</div>
                    {fill && (
                      <div className="w-full bg-slate-700 rounded-full h-1 mt-1">
                        <div
                          className="bg-blue-500 h-1 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <TradeRecap submittedOrders={submittedOrders} fills={fills} />

      {allFilled && (
        <div className="flex justify-end">
          <button
            onClick={onAllFilled}
            className="px-5 py-2 rounded-lg bg-green-700 text-white hover:bg-green-600 transition-colors text-sm font-medium"
          >
            All Filled — Get Settlement Prices →
          </button>
        </div>
      )}
    </div>
  )
}

