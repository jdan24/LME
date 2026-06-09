import { useState } from 'react'
import type { Order, AppConfig } from '../types'

interface Props {
  orders: Order[]
  config: AppConfig | null
  onSubmit: () => void
  onReset: () => void
  submitting: boolean
}

export function SubmitControls({ orders, config, onSubmit, onReset, submitting }: Props) {
  const [confirming, setConfirming] = useState(false)

  const buys  = orders.filter(o => o.bs === 'BUY')
  const sells = orders.filter(o => o.bs === 'SELL')

  const account      = config?.account      ?? '—'
  const broker       = config?.broker       ?? '—'
  const orderType    = config?.orderType    ?? 'MOC'
  const tif          = config?.tif          ?? 'DAY'
  const handlingInstr = config?.handlingInstr ?? 'MAN'

  if (confirming) {
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 text-center space-y-4">
        <h2 className="text-white text-lg font-semibold">Confirm Order Submission</h2>
        <div className="text-slate-300 text-sm space-y-1">
          <p><span className="font-mono">{orders.length}</span> order{orders.length !== 1 ? 's' : ''} will be submitted to Bloomberg EMSX</p>
          {buys.length  > 0 && <p className="text-green-400">▲ {buys.length}  BUY order{buys.length  !== 1 ? 's' : ''} ({buys.reduce((s, o)  => s + o.lots, 0).toLocaleString()} lots)</p>}
          {sells.length > 0 && <p className="text-red-400">▼ {sells.length} SELL order{sells.length !== 1 ? 's' : ''} ({sells.reduce((s, o) => s + o.lots, 0).toLocaleString()} lots)</p>}
        </div>
        <div className="text-slate-500 text-xs border border-slate-700 rounded-lg p-3 text-left">
          <div className="grid grid-cols-2 gap-1">
            <span>Broker:</span>       <span className="text-slate-300 font-mono">{broker}</span>
            <span>Account:</span>      <span className="text-slate-300 font-mono">{account}</span>
            <span>Order Type:</span>   <span className="text-slate-300 font-mono">{orderType}</span>
            <span>TIF:</span>          <span className="text-slate-300 font-mono">{tif}</span>
            <span>Handling:</span>     <span className="text-slate-300 font-mono">{handlingInstr}</span>
          </div>
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => setConfirming(false)}
            className="px-5 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors text-sm"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting…' : `Submit ${orders.length} Order${orders.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 justify-end">
      <button
        onClick={onReset}
        className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors text-sm"
      >
        Clear & Paste New
      </button>
      <button
        onClick={() => setConfirming(true)}
        className="px-5 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors text-sm font-medium"
      >
        Submit {orders.length} Order{orders.length !== 1 ? 's' : ''} to EMSX →
      </button>
    </div>
  )
}
