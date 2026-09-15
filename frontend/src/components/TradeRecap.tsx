import { useEffect, useRef, useState } from 'react'
import { getSettlement } from '../api/client'
import type { FillStatus, SettlementPrice } from '../types'
import { DEAD_STATUSES } from '../utils/orderStatus'

interface SubmittedOrder {
  emsxSequence: number
  ticker: string
  bs: 'BUY' | 'SELL'
  lots: number
}

interface Props {
  submittedOrders: SubmittedOrder[]
  fills: FillStatus[]
  traderNames: Record<number, string>
  onTraderNamesChange: (names: Record<number, string>) => void
}

interface RecapRow {
  emsxSequence: number
  side: 'BUY' | 'SELL'
  ticker: string
  qty: number
  price: number | null
  settleDate: string
  // null until settlement for this ticker has been loaded
  freshness: SettlementPrice['freshness'] | null
  trader: string
}

const COLUMNS = ['Side', 'Bloomberg Ticker', 'Qty', 'Price', 'Settle Date', 'Trader'] as const

// Screen-only cue on the Settle Date cell (copies stay plain text). Labels match SettlementPanel.
const FRESHNESS: Record<SettlementPrice['freshness'], { label: string; cls: string }> = {
  today: { label: "Today's settlement", cls: 'text-white' },
  prior: { label: 'Prior day (LME not yet published)', cls: 'text-amber-300' },
  stale: { label: 'Stale (>1 day old)', cls: 'text-red-400' },
  unavailable: { label: 'Unavailable', cls: 'text-red-400' },
}

// No thousands separator — pastes cleanly into Bloomberg (per-row copy only).
function formatPrice(price: number | null): string {
  if (price === null) return '—'
  return price.toFixed(2)
}

// With thousands separator for display and table copy.
function formatPriceDisplay(price: number | null): string {
  if (price === null) return '—'
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Bloomberg settle date (ISO YYYY-MM-DD from /api/settlement) → MM/DD/YYYY.
function formatSettleDate(iso: string | null | undefined): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ''
}

// Typed trader names are free text — tabs/newlines would break the TSV layout.
function cleanTrader(name: string): string {
  return name.replace(/[\t\r\n]+/g, ' ').trim()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Fills are marked to settlement, so the recap is sent before EMSX reports fills:
// every live (not cancelled/rejected) order at its ordered lots, priced at the
// Bloomberg settlement for its ticker. Orders with no EMSX status yet count as live.
function buildRows(
  submittedOrders: SubmittedOrder[],
  fills: FillStatus[],
  settlements: SettlementPrice[],
  traderNames: Record<number, string>,
): RecapRow[] {
  const byTicker = new Map(settlements.map((s) => [s.ticker, s]))
  return submittedOrders
    .filter((o) => {
      const status = fills.find((f) => f.emsxSequence === o.emsxSequence)?.status
      return !status || !DEAD_STATUSES.has(status.toUpperCase())
    })
    .map((o) => {
      const s = byTicker.get(o.ticker)
      return {
        emsxSequence: o.emsxSequence,
        side: o.bs,
        ticker: o.ticker,
        qty: o.lots,
        price: s?.price ?? null,
        settleDate: formatSettleDate(s?.settleDate),
        freshness: s?.freshness ?? null,
        trader: traderNames[o.emsxSequence] ?? '',
      }
    })
}

// Cells for one row, in COLUMNS order.
function rowCells(r: RecapRow): string[] {
  return [r.side, r.ticker, r.qty.toLocaleString(), formatPriceDisplay(r.price), r.settleDate, cleanTrader(r.trader)]
}

// Tab-separated value text — pastes cleanly into Excel / Bloomberg / Outlook.
function toTSV(rows: RecapRow[]): string {
  const header = COLUMNS.join('\t')
  const body = rows.map((r) => rowCells(r).join('\t')).join('\n')
  return `${header}\n${body}`
}

// Real HTML <table> so a clipboard paste lands as a table in Bloomberg chat /
// Outlook / Excel rather than a blob of tab-separated text.
function toHtml(rows: RecapRow[]): string {
  const numeric = new Set([2, 3])  // Qty, Price — right-aligned
  const body = rows
    .map((r) =>
      `<tr>${rowCells(r)
        .map((v, i) => `<td align="${numeric.has(i) ? 'right' : 'left'}">${escapeHtml(v)}</td>`)
        .join('')}</tr>`,
    )
    .join('')
  return (
    `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse">` +
    `<thead><tr>${COLUMNS.map((c) => `<th>${c}</th>`).join('')}</tr></thead>` +
    `<tbody>${body}</tbody></table>`
  )
}

export function TradeRecap({ submittedOrders, fills, traderNames, onTraderNamesChange }: Props) {
  const [copied, setCopied] = useState(false)
  const [copiedPriceIdx, setCopiedPriceIdx] = useState<number | null>(null)
  const [applyAllName, setApplyAllName] = useState('')
  const [settlements, setSettlements] = useState<SettlementPrice[]>([])
  const [settleLoading, setSettleLoading] = useState(false)
  const [settleError, setSettleError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  // Discards a slower settlement response that a newer request has superseded.
  const settleRequestRef = useRef(0)

  const rows = buildRows(submittedOrders, fills, settlements, traderNames)
  // Stable key for the set of tickers, so settlement is re-fetched only when it
  // changes (e.g. Refresh Fills picked up a teammate's order).
  const tickerKey = [...new Set(rows.map((r) => r.ticker))].sort().join(',')

  const loadSettlement = async () => {
    if (!tickerKey) return
    const request = ++settleRequestRef.current
    setSettleLoading(true)
    setSettleError(null)
    try {
      const { settlements: data } = await getSettlement(tickerKey.split(','))
      if (settleRequestRef.current !== request) return
      setSettlements(data)
      setLastRefreshed(new Date())
    } catch (e) {
      if (settleRequestRef.current !== request) return
      setSettleError(e instanceof Error ? e.message : 'Unknown error fetching settlement prices')
    } finally {
      if (settleRequestRef.current === request) setSettleLoading(false)
    }
  }

  useEffect(() => {
    loadSettlement()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey])

  if (rows.length === 0) return null

  const setTrader = (emsxSequence: number, name: string) => {
    onTraderNamesChange({ ...traderNames, [emsxSequence]: name })
  }

  // Overwrites the trader on every recap row; individual rows can still be edited after.
  const applyToAll = () => {
    const next = { ...traderNames }
    for (const r of rows) next[r.emsxSequence] = applyAllName
    onTraderNamesChange(next)
  }

  // Copy a single settlement price exactly as shown in the table (e.g. "7676.00").
  const copyPrice = async (price: number, idx: number) => {
    const text = formatPrice(price)
    try {
      await navigator.clipboard.writeText(text)
      setCopiedPriceIdx(idx)
      setTimeout(() => setCopiedPriceIdx((cur) => (cur === idx ? null : cur)), 1500)
    } catch {
      window.prompt('Copy price:', text)
    }
  }

  const copyTable = async () => {
    const tsv = toTSV(rows)
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([toHtml(rows)], { type: 'text/html' }),
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
        }),
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Rich clipboard can be blocked (e.g. file://) — fall back to plain text.
      try {
        await navigator.clipboard.writeText(tsv)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        window.prompt('Copy the trade recap:', tsv)
      }
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-white text-base font-semibold">Trade Recap</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            {rows.length} trade{rows.length !== 1 ? 's' : ''} · priced at Bloomberg settlement
            {lastRefreshed && ` · last refreshed ${lastRefreshed.toLocaleTimeString()}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              applyToAll()
            }}
            className="flex items-center gap-1.5"
          >
            <input
              type="text"
              value={applyAllName}
              onChange={(e) => setApplyAllName(e.target.value)}
              placeholder="Trader for all rows"
              aria-label="Trader name for all rows"
              className="px-2 py-1.5 w-44 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-sm"
            >
              Apply to All
            </button>
          </form>
          <button
            onClick={loadSettlement}
            disabled={settleLoading}
            className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            {settleLoading ? (
              <span className="inline-block w-3.5 h-3.5 border-2 border-slate-400 border-t-white rounded-full animate-spin" />
            ) : '↻'}
            Refresh Settlement
          </button>
          <button
            onClick={copyTable}
            className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-sm flex items-center gap-1.5"
          >
            {copied ? '✓ Copied' : '⧉ Copy Table'}
          </button>
        </div>
      </div>

      {settleError && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-xs">
          Couldn't load settlement prices: {settleError}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-slate-400 text-left">
              <th className="px-4 py-2 font-medium">Side</th>
              <th className="px-4 py-2 font-medium">Bloomberg Ticker</th>
              <th className="px-4 py-2 font-medium text-right">Qty</th>
              <th className="px-4 py-2 font-medium text-right">Price</th>
              <th className="px-4 py-2 font-medium">Settle Date</th>
              <th className="px-4 py-2 font-medium">Trader</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.emsxSequence} className="border-t border-slate-700">
                <td className="px-4 py-2 font-medium text-white">{r.side}</td>
                <td className="px-4 py-2 font-mono text-white">{r.ticker}</td>
                <td className="px-4 py-2 text-right font-mono text-white">{r.qty.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-mono text-white">
                  <div className="flex items-center justify-end gap-1.5">
                    <span>{formatPriceDisplay(r.price)}</span>
                    {r.price !== null && (
                      <button
                        onClick={() => copyPrice(r.price as number, i)}
                        title="Copy price"
                        aria-label="Copy price"
                        className="text-slate-400 hover:text-white text-xs px-1 rounded hover:bg-slate-700 transition-colors"
                      >
                        {copiedPriceIdx === i ? '✓' : '⧉'}
                      </button>
                    )}
                  </div>
                </td>
                <td
                  className={`px-4 py-2 font-mono ${r.freshness ? FRESHNESS[r.freshness].cls : 'text-slate-500'}`}
                  title={r.freshness ? FRESHNESS[r.freshness].label : 'Loading settlement…'}
                >
                  {r.settleDate || '—'}
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={r.trader}
                    onChange={(e) => setTrader(r.emsxSequence, e.target.value)}
                    placeholder="Trader"
                    aria-label={`Trader for ${r.ticker} ${r.side}`}
                    className="px-2 py-1 w-36 rounded bg-slate-900 border border-slate-600 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
