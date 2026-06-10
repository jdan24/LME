import { useMemo, useState } from 'react'

// Minimal shape so both the order-entry table (full Order) and the Fill Status
// page (submitted orders) can summarize without sharing a concrete type.
interface SummaryOrder {
  bs: 'BUY' | 'SELL'
  ticker: string
  lots: number
}

interface Props {
  orders: SummaryOrder[]   // the orders to summarize (grouped by ordered lots)
  onClose: () => void
}

interface Group {
  bs: 'BUY' | 'SELL'
  ticker: string
  orders: number
  quantity: number
}

export function OrderSummary({ orders, onClose }: Props) {
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>()
    for (const o of orders) {
      const key = `${o.bs}|${o.ticker}`
      const g = map.get(key)
      if (g) {
        g.orders += 1
        g.quantity += o.lots
      } else {
        map.set(key, { bs: o.bs, ticker: o.ticker, orders: 1, quantity: o.lots })
      }
    }
    // Sort: BUY before SELL, then ticker alphabetically
    return [...map.values()].sort((a, b) =>
      a.bs === b.bs ? a.ticker.localeCompare(b.ticker) : a.bs === 'BUY' ? -1 : 1
    )
  }, [orders])

  const totalQty   = groups.reduce((s, g) => s + g.quantity, 0)
  const totalRows  = orders.length

  const [copied, setCopied] = useState(false)
  const [copiedTable, setCopiedTable] = useState(false)

  const buildTsv = () => {
    const header = ['Side', 'Symbol', 'Orders', 'Quantity'].join('\t')
    const body = groups.map(g => [g.bs, g.ticker, g.orders, g.quantity].join('\t'))
    const total = ['TOTAL', '', totalRows, totalQty].join('\t')
    return [header, ...body, total].join('\n')
  }

  // A real HTML <table> so Bloomberg chat (and Outlook/Excel) recognize it as a
  // table on paste, rather than a blob of tab-separated text.
  const buildHtml = () => {
    const td = (v: string | number, align = 'left') => `<td align="${align}">${v}</td>`
    const rows = groups
      .map(g => `<tr>${td(g.bs)}${td(g.ticker)}${td(g.orders, 'right')}${td(g.quantity, 'right')}</tr>`)
      .join('')
    return (
      `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse">` +
      `<thead><tr><th>Side</th><th>Symbol</th><th>Orders</th><th>Quantity</th></tr></thead>` +
      `<tbody>${rows}` +
      `<tr>${td('TOTAL')}<td></td>${td(totalRows, 'right')}${td(totalQty, 'right')}</tr>` +
      `</tbody></table>`
    )
  }

  const flash = (set: (v: boolean) => void) => {
    set(true)
    setTimeout(() => set(false), 2000)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildTsv())
      flash(setCopied)
    } catch {
      window.prompt('Copy the summary:', buildTsv())
    }
  }

  const handleCopyTable = async () => {
    const tsv = buildTsv()
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([buildHtml()], { type: 'text/html' }),
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
        }),
      ])
      flash(setCopiedTable)
    } catch {
      // Rich clipboard can be blocked (e.g. file://) — fall back to plain text.
      try {
        await navigator.clipboard.writeText(tsv)
        flash(setCopiedTable)
      } catch {
        window.prompt('Copy the summary:', tsv)
      }
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-2xl w-full space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-white text-lg font-semibold">Order Summary — Selected</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {orders.length === 0 ? (
          <p className="text-slate-400 text-sm">No orders selected. Check some rows to summarize them.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              {/* Plain table so a manual drag-select copies cleanly into Excel */}
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-slate-400 text-left">
                    <th className="px-4 py-2 font-medium">Side</th>
                    <th className="px-4 py-2 font-medium">Symbol</th>
                    <th className="px-4 py-2 font-medium text-right">Orders</th>
                    <th className="px-4 py-2 font-medium text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, i) => (
                    <tr key={i} className="border-t border-slate-700">
                      <td className={`px-4 py-2 font-bold ${g.bs === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                        {g.bs}
                      </td>
                      <td className="px-4 py-2 font-mono text-blue-300">{g.ticker}</td>
                      <td className="px-4 py-2 text-right text-slate-300">{g.orders}</td>
                      <td className="px-4 py-2 text-right font-mono text-white">{g.quantity.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-500 bg-slate-900/70 font-semibold">
                    <td className="px-4 py-2 text-slate-200">TOTAL</td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-right text-slate-200">{totalRows}</td>
                    <td className="px-4 py-2 text-right font-mono text-white">{totalQty.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-slate-500 text-xs">
                {totalRows} order{totalRows !== 1 ? 's' : ''} across {groups.length} group{groups.length !== 1 ? 's' : ''} · {totalQty.toLocaleString()} total lots
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-sm font-medium"
                >
                  {copied ? 'Copied ✓' : 'Copy as Text'}
                </button>
                <button
                  onClick={handleCopyTable}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors text-sm font-medium"
                  title="Copies an HTML table — pastes cleanly into Bloomberg chat, Outlook, and Excel"
                >
                  {copiedTable ? 'Copied ✓' : 'Copy as Table'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
