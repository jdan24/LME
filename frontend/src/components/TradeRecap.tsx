import { useState } from 'react'
import type { FillStatus } from '../types'

interface SubmittedOrder {
  emsxSequence: number
  ticker: string
  bs: 'BUY' | 'SELL'
  lots: number
}

interface Props {
  submittedOrders: SubmittedOrder[]
  fills: FillStatus[]
}

interface RecapRow {
  date: string
  side: 'BUY' | 'SELL'
  ticker: string
  qty: number
  price: number
}

const COLUMNS = ['Date', 'Side', 'Bloomberg Ticker', 'Qty', 'Price'] as const

// No thousands separator — pastes cleanly into Bloomberg (per-row copy only).
function formatPrice(price: number): string {
  if (!price) return '—'
  return price.toFixed(2)
}

// With thousands separator for display, table copy, and email draft.
function formatPriceDisplay(price: number): string {
  if (!price) return '—'
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// YYYYMMDD → MM/DD/YYYY. Falls back to today when the create date is unknown
// (e.g. EMSX didn't deliver the create-time field) — recaps are same-day.
function formatDate(yyyymmdd: number): string {
  const s = String(yyyymmdd)
  if (yyyymmdd && s.length === 8) {
    return `${s.slice(4, 6)}/${s.slice(6, 8)}/${s.slice(0, 4)}`
  }
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

// Builds the recap from each order that has at least one fill. Quantity reflects
// the filled amount (not the ordered amount) and price is the EMSX average fill.
function buildRows(submittedOrders: SubmittedOrder[], fills: FillStatus[]): RecapRow[] {
  return submittedOrders
    .map((o) => {
      const fill = fills.find((f) => f.emsxSequence === o.emsxSequence)
      const qty = fill?.filledAmount ?? 0
      return {
        date: formatDate(fill?.createDate ?? 0),
        side: o.bs,
        ticker: o.ticker,
        qty,
        price: fill?.avgPrice ?? 0,
      }
    })
    .filter((r) => r.qty > 0)
}

// Cells for one row, in COLUMNS order.
function rowCells(r: RecapRow): string[] {
  return [r.date, r.side, r.ticker, r.qty.toLocaleString(), formatPriceDisplay(r.price)]
}

// Tab-separated value text — pastes cleanly into Excel / Bloomberg / Outlook.
function toTSV(rows: RecapRow[]): string {
  const header = COLUMNS.join('\t')
  const body = rows.map((r) => rowCells(r).join('\t')).join('\n')
  return `${header}\n${body}`
}

// Bordered plain-text table for the email body — reads as a table in any client.
function toBorderedTable(rows: RecapRow[]): string {
  const headers = [...COLUMNS]
  const data = rows.map(rowCells)
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map((row) => row[i].length)))
  const numeric = new Set([3, 4])  // Qty, Price — right-aligned
  const border = '+' + widths.map((w) => '-'.repeat(w + 2)).join('+') + '+'
  const fmt = (cells: string[]) =>
    '| ' + cells.map((c, i) => (numeric.has(i) ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join(' | ') + ' |'
  return [border, fmt(headers), border, ...data.map(fmt), border].join('\n')
}

// Real HTML <table> so a clipboard paste lands as a table in Bloomberg chat /
// Outlook / Excel rather than a blob of tab-separated text.
function toHtml(rows: RecapRow[]): string {
  const td = (v: string, align = 'left') => `<td align="${align}">${v}</td>`
  const body = rows
    .map((r) => `<tr>${td(r.date)}${td(r.side)}${td(r.ticker)}${td(r.qty.toLocaleString(), 'right')}${td(formatPriceDisplay(r.price), 'right')}</tr>`)
    .join('')
  return (
    `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse">` +
    `<thead><tr><th>Date</th><th>Side</th><th>Bloomberg Ticker</th><th>Qty</th><th>Price</th></tr></thead>` +
    `<tbody>${body}</tbody></table>`
  )
}

export function TradeRecap({ submittedOrders, fills }: Props) {
  const [copied, setCopied] = useState(false)
  const [copiedPriceIdx, setCopiedPriceIdx] = useState<number | null>(null)
  const rows = buildRows(submittedOrders, fills)

  if (rows.length === 0) return null

  // Copy a single fill price exactly as shown in the table (e.g. "7676.00").
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

  const emailDraft = () => {
    const subject = `LME Trade Recap — ${new Date().toLocaleDateString()}`
    const body = `Trade recap:\n\n${toBorderedTable(rows)}\n`
    window.location.href =
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white text-base font-semibold">Trade Recap</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            {rows.length} filled trade{rows.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyTable}
            className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-sm flex items-center gap-1.5"
          >
            {copied ? '✓ Copied' : '⧉ Copy Table'}
          </button>
          <button
            onClick={emailDraft}
            className="px-3 py-1.5 rounded-lg bg-blue-700 text-white hover:bg-blue-600 transition-colors text-sm flex items-center gap-1.5"
          >
            ✉ Email Draft
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-slate-400 text-left">
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Side</th>
              <th className="px-4 py-2 font-medium">Bloomberg Ticker</th>
              <th className="px-4 py-2 font-medium text-right">Qty</th>
              <th className="px-4 py-2 font-medium text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-700">
                <td className="px-4 py-2 font-mono text-white">{r.date}</td>
                <td className="px-4 py-2 font-medium text-white">{r.side}</td>
                <td className="px-4 py-2 font-mono text-white">{r.ticker}</td>
                <td className="px-4 py-2 text-right font-mono text-white">{r.qty.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-mono text-white">
                  <div className="flex items-center justify-end gap-1.5">
                    <span>{formatPriceDisplay(r.price)}</span>
                    {r.price > 0 && (
                      <button
                        onClick={() => copyPrice(r.price, i)}
                        title="Copy price"
                        aria-label="Copy price"
                        className="text-slate-400 hover:text-white text-xs px-1 rounded hover:bg-slate-700 transition-colors"
                      >
                        {copiedPriceIdx === i ? '✓' : '⧉'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
