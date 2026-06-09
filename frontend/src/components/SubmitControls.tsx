import { useState } from 'react'
import type { Order } from '../types'

interface Props {
  orders: Order[]
  onSubmit: () => void
  onReset: () => void
  submitting: boolean
}

export function SubmitControls({ orders, onSubmit, onReset, submitting }: Props) {
  const [confirming, setConfirming] = useState(false)

  const buys = orders.filter(o => o.bs === 'BUY')
  const sells = orders.filter(o => o.bs === 'SELL')

  if (confirming) {
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 text-center space-y-4">
        <h2 className="text-white text-lg font-semibold">Confirm Order Submission</h2>
        <div className="text-slate-300 text-sm space-y-1">
          <p><span className="font-mono">{orders.length}</span> order{orders.length !== 1 ? 's' : ''} will be submitted to Bloomberg EMSX</p>
          {buys.length > 0 && <p className="text-green-400">▲ {buys.length} BUY order{buys.length !== 1 ? 's' : ''} ({buys.reduce((s, o) => s + o.lots, 0).toLocaleString()} lots)</p>}
          {sells.length > 0 && <p className="text-red-400">▼ {sells.length} SELL order{sells.length !== 1 ? 's' : ''} ({sells.reduce((s, o) => s + o.lots, 0).toLocaleString()} lots)</p>}
        </div>
        <div className="text-slate-500 text-xs border border-slate-700 rounded-lg p-3 text-left">
          <div className="grid grid-cols-2 gap-1">
            <span>Broker:</span><span className="text-slate-300 font-mono">KMTF</span>
            <span>Account:</span><span className="text-slate-300 font-mono">367A0027</span>
            <span>Order Type:</span><span className="text-slate-300 font-mono">MOC</span>
            <span>TIF:</span><span className="text-slate-300 font-mono">DAY</span>
            <span>Handling:</span><span className="text-slate-300 font-mono">MAN</span>
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
