export function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase()
  let cls = 'bg-slate-700 text-slate-300'
  if (s === 'FILLED' || s === 'FULLFILL') cls = 'bg-green-900/50 text-green-400 border border-green-700'
  else if (s === 'PARTFILL') cls = 'bg-blue-900/50 text-blue-300 border border-blue-700'
  else if (s === 'WORKING' || s === 'ROUTED') cls = 'bg-yellow-900/50 text-yellow-300 border border-yellow-700'
  else if (s === 'CANCEL' || s === 'REJECTED') cls = 'bg-red-900/50 text-red-400 border border-red-700'

  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}
