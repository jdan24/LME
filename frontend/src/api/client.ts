import type { Order, FillStatus, SettlementPrice, AppConfig } from '../types'

// In dev (`npm run dev`) the Vite proxy forwards /api → localhost:8000.
// In production (built index.html opened as a file) we need the absolute URL.
const BASE = import.meta.env.DEV ? '/api' : 'http://localhost:8000/api'

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

export async function checkHealth(): Promise<{ status: string; bloomberg: string }> {
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

export async function checkDuplicates(orderIds: string[]): Promise<{ duplicates: string[]; checked: boolean; statuses: Record<string, string> }> {
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
