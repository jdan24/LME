import { useState, useEffect } from 'react'
import { getSettlement } from '../api/client'
import type { SettlementPrice } from '../types'
import { contractLabel } from '../utils/lmeConfig'

interface Props {
  tickers: string[]
}

export function SettlementPanel({ tickers }: Props) {
  const [settlements, setSettlements] = useState<SettlementPrice[]>([])
  const [loading, setLoading] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetch = async () => {
    setLoading(true)
    setError(null)
    try {
      const { settlements: data } = await getSettlement(tickers)
      setSettlements(data)
      setLastRefreshed(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error fetching settlements')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (tickers.length > 0) fetch()
  }, [])

  const freshnessConfig: Record<SettlementPrice['freshness'], { label: string; rowCls: string; badgeCls: string }> = {
    today: {
      label: "Today's Settlement",
      rowCls: 'bg-green-950/30 border-l-4 border-l-green-500',
      badgeCls: 'bg-green-900/50 text-green-400 border border-green-700',
    },
    prior: {
      label: 'Prior Day (LME not yet published)',
      rowCls: 'bg-orange-950/30 border-l-4 border-l-orange-400',
      badgeCls: 'bg-orange-900/50 text-orange-300 border border-orange-700',
    },
    stale: {
      label: 'Stale (>1 day old)',
      rowCls: 'bg-red-950/30 border-l-4 border-l-red-500',
      badgeCls: 'bg-red-900/50 text-red-400 border border-red-700',
    },
    unavailable: {
      label: 'Unavailable',
      rowCls: 'border-l-4 border-l-slate-600',
      badgeCls: 'bg-slate-700 text-slate-400',
    },
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white text-lg font-semibold">Settlement Prices</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Fields: <code className="text-slate-400">PX_SETTLE_ACTUAL_RT</code> · <code className="text-slate-400">PX_SETTLE_LAST_DT_RT</code>
          </p>
          {lastRefreshed && (
            <p className="text-slate-500 text-xs mt-0.5">
              Last refreshed: {lastRefreshed.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={fetch}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-sm disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? (
            <span className="inline-block w-4 h-4 border-2 border-slate-400 border-t-white rounded-full animate-spin" />
          ) : '↻'}
          Refresh Settlement
        </button>
      </div>

      <div className="mb-3 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-green-500" /> Today's settlement
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-orange-400" /> Prior day (waiting)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-red-500" /> Stale / unavailable
        </span>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading && settlements.length === 0 ? (
        <div className="text-slate-400 text-sm text-center py-10">Loading settlement prices…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-700 divide-y divide-slate-700">
          {settlements.map((s) => {
            const cfg = freshnessConfig[s.freshness]
            return (
              <div key={s.ticker} className={`px-4 py-3 flex items-center gap-4 ${cfg.rowCls}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{s.contract}</span>
                    <span className="text-slate-500 text-xs">{contractLabel(s.contract)}</span>
                  </div>
                  <div className="text-slate-400 text-xs font-mono">{s.ticker}</div>
                </div>
                <div className="text-right min-w-[120px]">
                  <div className="text-white text-lg font-mono font-semibold">
                    {s.price !== null ? s.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                  </div>
                  <div className="text-slate-400 text-xs">{s.settleDate ?? '—'}</div>
                </div>
                <div className="min-w-[180px] text-right">
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs ${cfg.badgeCls}`}>
                    {cfg.label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
