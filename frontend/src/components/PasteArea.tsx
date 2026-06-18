import { useRef, useEffect, useState } from 'react'
import { parseClipboard } from '../utils/parseClipboard'
import type { Order } from '../types'

interface Props {
  onParsed: (orders: Order[], errors: string[]) => void
  // Pull LME orders already in the shared EMSX blotter. Resolves to the number
  // of orders loaded (0 if none); rejects if the bridge is unreachable.
  onMonitorBlotter: () => Promise<number>
}

export function PasteArea({ onParsed, onMonitorBlotter }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [raw, setRaw] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [monitorMsg, setMonitorMsg] = useState<string | null>(null)

  // Auto-focus the textarea so Ctrl+V works immediately without clicking
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const parse = (text: string) => {
    setRaw(text)
    if (!text.trim()) return

    const { orders, errors } = parseClipboard(text)

    if (orders.length === 0 && errors.length > 0) {
      setParseError(errors[0])
      return
    }
    if (orders.length === 0) {
      setParseError('No LME_NTP rows found. Make sure to copy data that includes the header row.')
      return
    }

    setParseError(null)
    onParsed(orders, errors)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text.trim()) return
    e.preventDefault()
    parse(text)
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    parse(e.target.value)
  }

  const handleMonitor = async () => {
    setMonitorLoading(true)
    setMonitorMsg(null)
    try {
      const count = await onMonitorBlotter()
      // On success the view navigates to Fill Status; only a zero result returns here.
      if (count === 0) {
        setMonitorMsg('No LME orders found in the EMSX blotter.')
      }
    } catch (e) {
      setMonitorMsg(
        e instanceof Error
          ? `Could not reach the Bloomberg bridge: ${e.message}`
          : 'Could not load orders from the EMSX blotter.'
      )
    } finally {
      setMonitorLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white mb-2">LME Order Entry</h1>
        <p className="text-slate-400 text-sm">3rd Wednesday Futures · Bloomberg EMSX</p>
      </div>

      <div className="w-full max-w-2xl space-y-3">
        <div className="flex items-baseline justify-between">
          <label className="text-slate-300 text-sm font-medium">
            EATrade order data
          </label>
          <span className="text-slate-500 text-xs">
            Click the box and press <kbd className="bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded text-xs font-mono">Ctrl+V</kbd>
          </span>
        </div>

        <textarea
          ref={textareaRef}
          value={raw}
          onPaste={handlePaste}
          onChange={handleChange}
          placeholder="Paste your EATrade clipboard data here…"
          rows={10}
          spellCheck={false}
          className="w-full bg-slate-800 border border-slate-600 rounded-lg p-4 text-slate-200 text-xs font-mono leading-relaxed placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y"
        />

        {parseError && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {parseError}
          </div>
        )}

        {!parseError && !raw && (
          <p className="text-slate-600 text-xs">
            Copy the order grid from EATrade (including the header row), then paste here.
            Only rows where <code className="text-slate-500 bg-slate-800 px-1 rounded">MKT = LME_NTP</code> are processed.
          </p>
        )}

        {raw && !parseError && (
          <p className="text-slate-500 text-xs">Parsing…</p>
        )}

        {/* Pick up a monitoring session without importing — pulls orders already
            staged in the shared EMSX blotter. */}
        <div className="pt-2 border-t border-slate-800 flex items-center gap-3">
          <button
            onClick={handleMonitor}
            disabled={monitorLoading}
            className="px-4 py-2 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {monitorLoading && (
              <span className="inline-block w-4 h-4 border-2 border-slate-400 border-t-white rounded-full animate-spin" />
            )}
            Monitor orders already in EMSX →
          </button>
          <span className="text-slate-500 text-xs">
            Skip importing — track fills for orders already staged in the blotter.
          </span>
        </div>

        {monitorMsg && (
          <div className="bg-slate-800/60 border border-slate-600 rounded-lg px-4 py-2 text-slate-300 text-xs">
            {monitorMsg}
          </div>
        )}
      </div>
    </div>
  )
}
