import type { Order } from '../types'
import { contractLabel } from '../utils/lmeConfig'

interface Props {
  orders: Order[]
  errors: string[]
}

export function OrderTable({ orders, errors }: Props) {
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

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-slate-400 text-left">
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
            {orders.map((o, i) => (
              <tr
                key={i}
                className="border-t border-slate-700 hover:bg-slate-800/50 transition-colors"
              >
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
                <td className="px-4 py-3 text-slate-400 text-xs">KMTF</td>
                <td className="px-4 py-3 text-slate-400 text-xs">367A0027</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
