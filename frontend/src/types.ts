export interface Order {
  contract: string   // e.g. "LAH6"
  ticker: string     // e.g. "LAH6 Comdty"
  bs: 'BUY' | 'SELL'
  lots: number
  orderId: string
  mkt: string
}

export interface SubmittedOrder extends Order {
  emsxSequence: number
  status: string
  filledAmount: number
}

export interface FillStatus {
  emsxSequence: number
  ticker: string
  bs: 'BUY' | 'SELL'
  lots: number
  filledAmount: number
  status: string
}

export interface SettlementPrice {
  ticker: string
  contract: string
  price: number | null
  settleDate: string | null
  freshness: 'today' | 'prior' | 'stale' | 'unavailable'
}

export type AppState =
  | 'EMPTY'
  | 'PARSED'
  | 'REVIEW'
  | 'SUBMITTING'
  | 'MONITORING'
  | 'SETTLED'
