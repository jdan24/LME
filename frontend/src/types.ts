export interface Order {
  contract: string   // e.g. "LAH6"
  ticker: string     // e.g. "LAH6 Comdty"
  bs: 'BUY' | 'SELL'
  lots: number
  orderId: string
  mkt: string
  importedAt: string // ISO timestamp captured when the row was pasted (not sent to EMSX)
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
  avgPrice: number
  status: string
  createDate: number   // order create date as YYYYMMDD (0 if unknown)
}

export interface SettlementPrice {
  ticker: string
  contract: string
  price: number | null
  settleDate: string | null
  freshness: 'today' | 'prior' | 'stale' | 'unavailable'
}

export interface AppConfig {
  account: string
  broker: string
  orderType: string
  tif: string
  handlingInstr: string
  environment: 'PROD' | 'UAT'
}

export type AppState =
  | 'EMPTY'
  | 'PARSED'
  | 'REVIEW'
  | 'SUBMITTING'
  | 'MONITORING'
  | 'SETTLED'

// Controls which EMSX statuses are displayed on the Fill Status screen.
export type FillStatusFilter = 'ACTIVE' | 'FILLED' | 'ALL'
