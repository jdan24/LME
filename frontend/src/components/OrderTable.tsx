import { useState } from 'react'
import type { Order, AppConfig } from '../types'
import { contractLabel } from '../utils/lmeConfig'
import { OrderSummary } from './OrderSummary'
import { StatusBadge } from './StatusBadge'

interface Props {
  orders: Order[]
  errors: string[]
  config: AppConfig | null
  selected: boolean[]
  duplicateIds: Set<string>
  duplicateMatches: Record<string, Array<{ emsxSequence: number; status: string }>>
  dupChecked: boolean
  dupChecking: boolean
  onToggle: (index: number) => void
  onSelectAll: () => void
  onSelectNone: () => void
  onRecheckDuplicates: () => void
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

export function OrderTable({
  orders, errors, config, selected, duplicateIds, duplicateMatches, dupChecked, dupChecking,
  onToggle, onSelectAll, onSelectNone, onRecheckDuplicates,
}: Props) {
  const account = config?.account ?? '—'
  const broker  = config?.broker  ?? '—'

  const [showSummary, setShowSummary] = useState(false)

  const selectedCount  = selected.filter(Boolean).length
  const allSelected    = orders.length > 0 && selectedCount === orders.length
  const dupCount = orders.filter(o => duplicateIds.has(o.orderId)).length

  const selectedOrders = orders.filter((_, i) => selected[i])

  return (
    <div className="w-full">
      {errors.length > 0 && (
        <div className="mb-4 bg-yellow-900/40 border border-yellow-600 rounded-lg p-3">
          <p className="text-yellow-400 text-sm font-medium mb-1">Parse warnings ({errors.length})</p>
          <ul className="list-disc list-inside space-y-0.5">
            {errors.map((e, i) => (
              <li key={i} className="text-yellow-300 text-xs">{e}</li>
            ))}
          </ul>
        </div>
      )}

      {dupCheckBanner(dupChecked, dupChecking, dupCount, onRecheckDuplicates)}

      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <span className="text-slate-400 text-sm">
          <span className="text-blue-300 font-medium">{selectedCount}</span> of {orders.length} selected
        </span>
        <div className="flex gap-2">
          <button
            onClick={onSelectAll}
            className="px-3 py-1 rounded-md bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-xs font-medium"
          >
            Select All
          </button>
          <button
            onClick={onSelectNone}
            className="px-3 py-1 rounded-md bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-xs font-medium"
          >
            Select None
          </button>
        </div>
        <button
          onClick={() => setShowSummary(true)}
          className="ml-auto px-3 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-500 transition-colors text-xs font-medium"
        >
          Summarize Selected
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-slate-400 text-left">
              <th className="px-4 py-3 font-medium">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = selectedCount > 0 && !allSelected }}
                  onChange={() => (allSelected ? onSelectNone() : onSelectAll())}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                  aria-label="Select all orders"
                />
              </th>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Symbol</th>
              <th className="px-4 py-3 font-medium">Side</th>
              <th className="px-4 py-3 font-medium text-right">Lots</th>
              <th className="px-4 py-3 font-medium">Order ID</th>
              <th className="px-4 py-3 font-medium">Imported</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Broker</th>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">EMSX Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => {
              const isChecked = selected[i] ?? false
              const isDuplicate = duplicateIds.has(o.orderId)
              const matches = duplicateMatches[o.orderId] ?? []
              return (
                <tr
                  key={i}
                  onClick={() => onToggle(i)}
                  className={`border-t border-slate-700 cursor-pointer transition-colors ${
                    isDuplicate
                      ? 'bg-amber-950/40 hover:bg-amber-950/60'
                      : isChecked
                        ? 'bg-blue-950/40 hover:bg-blue-950/60'
                        : 'hover:bg-slate-800/50'
                  }`}
                >
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggle(i)}
                      className="w-4 h-4 accent-blue-500 cursor-pointer"
                      aria-label={`Select order ${i + 1}`}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-blue-300 flex items-center gap-2">
                      {o.ticker}
                      {isDuplicate && (
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/60 text-amber-300 border border-amber-600">
                          ⚠ IN EMSX{matches.length > 1 ? ` (${matches.length})` : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-500 text-xs">{contractLabel(o.contract)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${
                      o.bs === 'BUY'
                        ? 'bg-green-900/50 text-green-400 border border-green-700'
                        : 'bg-red-900/50 text-red-400 border border-red-700'
                    }`}>
                      {o.bs}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-white">{o.lots.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">{o.orderId}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">{formatTime(o.importedAt)}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">MOC / DAY</td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">{broker}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">{account}</td>
                  <td className="px-4 py-3">
                    {/* Every EMSX match is shown (not just the newest) so the trader can see
                        the full history — e.g. a cancel + re-submit chain — and decide for
                        themselves whether it's safe to proceed, rather than the app picking
                        one status for them. */}
                    {isDuplicate && matches.length > 0
                      ? (
                        <div className="flex flex-col gap-1">
                          {matches.map(m => (
                            <div key={m.emsxSequence} className="flex items-center gap-1.5">
                              <span className="text-slate-500 text-[10px] font-mono">#{m.emsxSequence}</span>
                              <StatusBadge status={m.status} />
                            </div>
                          ))}
                        </div>
                      )
                      : <span className="text-slate-600 text-xs">—</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showSummary && (
        <OrderSummary orders={selectedOrders} onClose={() => setShowSummary(false)} />
      )}
    </div>
  )
}

function dupCheckBanner(
  dupChecked: boolean,
  dupChecking: boolean,
  dupCount: number,
  onRecheck: () => void,
) {
  const recheckBtn = (
    <button
      onClick={onRecheck}
      disabled={dupChecking}
      className="ml-2 px-2 py-0.5 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
    >
      {dupChecking && (
        <span className="inline-block w-3 h-3 border-2 border-slate-400 border-t-white rounded-full animate-spin" />
      )}
      {dupChecking ? 'Checking…' : 'Re-check EMSX'}
    </button>
  )

  if (!dupChecked) {
    return (
      <div className="mb-3 bg-slate-800/60 border border-slate-600 rounded-lg p-2 text-slate-400 text-xs flex items-center">
        <span>Duplicate check skipped — Bloomberg bridge not reachable. Imported orders were not checked against EMSX.</span>
        {recheckBtn}
      </div>
    )
  }
  if (dupCount > 0) {
    return (
      <div className="mb-3 bg-amber-900/30 border border-amber-600 rounded-lg p-2 text-amber-300 text-xs flex items-center">
        <span>{dupCount} order{dupCount !== 1 ? 's' : ''} already in today's EMSX blotter — flagged and left unselected. Re-check a row only if you intend to stage it again.</span>
        {recheckBtn}
      </div>
    )
  }
  return (
    <div className="mb-3 bg-slate-800/60 border border-slate-700 rounded-lg p-2 text-slate-400 text-xs flex items-center">
      <span>
        {dupChecking
          ? 'Checking imported orders against the EMSX blotter…'
          : 'No duplicates found in today’s EMSX blotter. If the blotter was still loading, re-check.'}
      </span>
      {recheckBtn}
    </div>
  )
}
