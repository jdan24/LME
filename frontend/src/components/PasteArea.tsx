import { useEffect } from 'react'
import { parseClipboard } from '../utils/parseClipboard'
import type { Order } from '../types'

interface Props {
  onParsed: (orders: Order[], errors: string[]) => void
}

export function PasteArea({ onParsed }: Props) {
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!text.trim()) return
      const { orders, errors } = parseClipboard(text)
      onParsed(orders, errors)
    }
    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [onParsed])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white mb-2">LME Order Entry</h1>
        <p className="text-slate-400 text-sm">3rd Wednesday Futures · Bloomberg EMSX</p>
      </div>

      <div className="border-2 border-dashed border-slate-600 rounded-xl p-16 text-center w-full max-w-lg hover:border-blue-500 transition-colors cursor-default">
        <div className="text-5xl mb-4">📋</div>
        <p className="text-slate-300 text-lg font-medium mb-1">
          Press <kbd className="bg-slate-700 text-white px-2 py-0.5 rounded text-sm font-mono">Ctrl+V</kbd> anywhere
        </p>
        <p className="text-slate-500 text-sm">
          Paste your EATrade clipboard data to begin
        </p>
      </div>

      <p className="text-slate-600 text-xs max-w-sm text-center">
        Only rows with <code className="text-slate-400 bg-slate-800 px-1 rounded">MKT = LME_NTP</code> will be processed.
        All other exchange rows are ignored.
      </p>
    </div>
  )
}
