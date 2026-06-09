import type { Order, AppConfig } from '../types'
import { contractLabel } from '../utils/lmeConfig'

interface Props {
  orders: Order[]
  errors: string[]
  config: AppConfig | null
  selected: boolean[]
  onToggle: (index: number) => void
  onSelectAll: () => void
  onSelectNone: () => void
}

export function OrderTable({ orders, errors, config, selected, onToggle, onSelectAll, onSelectNone }: Props) {
  const account = config?.account ?? '—'
  const broker  = config?.broker  ?? '—'

  const selectedCount = selected.filter(Boolean).length
  const allSelected   = orders.length > 0 && selectedCount === orders.length

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

      <div className="mb-3 flex items-center gap-3">
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
              <th className="px-4 py-3 font-medium">Contract</th>
              <th className="px-4 py-3 font-medium">Ticker (EMSX)</th>
              <th className="px-4 py-3 font-medium">Side</th>
              <th className="px-4 py-3 font-medium text-right">Lots</th>
              <th className="px-4 py-3 font-medium">Order ID</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Broker</th>
              <th className="px-4 py-3 font-medium">Account</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => {
              const isChecked = selected[i] ?? false
              return (
                <tr
                  key={i}
                  onClick={() => onToggle(i)}
                  className={`border-t border-slate-700 cursor-pointer transition-colors ${
                    isChecked ? 'bg-blue-950/40 hover:bg-blue-950/60' : 'hover:bg-slate-800/50'
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
                    <div className="font-medium text-white">{o.contract}</div>
                    <div className="text-slate-500 text-xs">{contractLabel(o.contract)}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-blue-300">{o.ticker}</td>
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
                  <td className="px-4 py-3 text-slate-400 text-xs">MOC / DAY</td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">{broker}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">{account}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
