interface Props {
  environment: 'PROD' | 'UAT'
}

export function EnvironmentBanner({ environment }: Props) {
  if (environment === 'UAT') {
    return (
      <div className="w-full bg-amber-500/20 border-b-2 border-amber-500 px-4 py-2 flex items-center justify-center gap-3">
        <span className="text-amber-400 font-bold text-sm tracking-wide">⚠ UAT ENVIRONMENT</span>
        <span className="text-amber-300/80 text-xs">Orders are staged to the Bloomberg EMSX beta service — not live</span>
      </div>
    )
  }

  return (
    <div className="w-full bg-green-900/20 border-b border-green-900 px-4 py-1.5 flex items-center justify-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
      <span className="text-green-400 text-xs font-medium">LIVE — Bloomberg EMSX production service</span>
    </div>
  )
}
