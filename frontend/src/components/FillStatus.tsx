import { useState, useEffect } from 'react'
import { getFillStatus } from '../api/client'
import type { FillStatus as FillStatusType } from '../types'
import { contractLabel } from '../utils/lmeConfig'
import { TradeRecap } from './TradeRecap'
import { OrderSummary } from './OrderSummary'
import { StatusBadge } from './StatusBadge'

interface Props {
  emsxSequences: number[]
  submittedOrders: Array<{ emsxSequence: number; orderId: string; ticker: string; bs: 'BUY' | 'SELL'; lots: number }>
  onAllFilled: () => void
}

export function FillStatus({ emsxSequences, submittedOrders, onAllFilled }: Props) {
  const [fills, setFills] = useState<FillStatusType[]>([])
  const [loading, setLoading] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSummary, setShowSummary] = useState(false)

  const allFilled = fills.length > 0 && fills.every(f => f.filledAmount >= f.lots)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const { fills: updated } = await getFillStatus(emsxSequences)
      setFills(updated)
      setLastRefreshed(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error fetching fills')
    } finally {
      setLoading(false)
    }
  }

  // Pull fills once on mount so the screen is populated immediately — both after
  // submitting and when a teammate picks up a session from the blotter.
  useEffect(() => {
    if (emsxSequences.length > 0) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const contractFromTicker = (ticker: string) => ticker.replace(' Comdty', '')

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
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSummary(true)}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors text-sm font-medium"
          >
            Summarize Selected
          </button>
          <button
            onClick={refresh}
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
            {submittedOrders.map((o) => {
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

