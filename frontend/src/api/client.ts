import type { Order, FillStatus, SettlementPrice, AppConfig } from '../types'

// In dev (`npm run dev`) the Vite proxy forwards /api → localhost:8000.
// In production the bridge serves index.html itself (on 8000, or the next free
// port if 8000 was taken), so the API is on the same origin. If index.html is
// opened directly as a file instead, fall back to the default port.
const BASE = import.meta.env.DEV || location.protocol.startsWith('http')
  ? '/api'
  : 'http://localhost:8000/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API error ${res.status}: ${body}`)
  }
  return res.json()
}

export async function checkHealth(): Promise<{ status: string; app: string; environment: string; bloomberg: string; emsxReady: boolean }> {
  return request('/health')
}

export async function getConfig(): Promise<AppConfig> {
  return request('/config')
}

export async function submitOrders(orders: Order[]): Promise<{ results: Array<{ emsxSequence: number; status: string; orderId: string }> }> {
  return request('/submit-orders', {
    method: 'POST',
    body: JSON.stringify({ orders }),
  })
}

export async function checkDuplicates(orderIds: string[]): Promise<{ duplicates: string[]; checked: boolean; matches: Record<string, Array<{ emsxSequence: number; status: string }>> }> {
  return request('/check-duplicates', {
    method: 'POST',
    body: JSON.stringify({ orderIds }),
  })
}

export async function getFillStatus(ids: number[]): Promise<{ fills: FillStatus[] }> {
  const params = new URLSearchParams({ ids: ids.join(',') })
  return request(`/fill-status?${params}`)
}

export async function getBlotterOrders(): Promise<{ orders: Array<FillStatus & { notes?: string; createDate?: number }> }> {
  return request('/blotter-orders')
}

export async function getSettlement(tickers: string[]): Promise<{ settlements: SettlementPrice[] }> {
  const params = new URLSearchParams({ tickers: tickers.join(',') })
  return request(`/settlement?${params}`)
}
