import type { Order } from '../types'

const REQUIRED_HEADERS = ['Contract', 'BS', 'Lots', 'OrderID', 'MKT']

export function parseClipboard(raw: string): { orders: Order[]; errors: string[] } {
  const errors: string[] = []
  const lines = raw.trim().split(/\r?\n/).filter(l => l.trim())

  if (lines.length === 0) {
    return { orders: [], errors: ['Clipboard is empty'] }
  }

  const headerCells = lines[0].split('\t').map(c => c.trim())
  const isHeader = headerCells.some(h => REQUIRED_HEADERS.includes(h))

  if (!isHeader) {
    return { orders: [], errors: ['Could not find expected column headers (Contract, BS, Lots, OrderID, MKT). Make sure to copy including the header row.'] }
  }

  const idx = {
    contract: headerCells.findIndex(h => h === 'Contract'),
    bs: headerCells.findIndex(h => h === 'BS'),
    lots: headerCells.findIndex(h => h === 'Lots'),
    orderId: headerCells.findIndex(h => h === 'OrderID'),
    mkt: headerCells.findIndex(h => h === 'MKT'),
  }

  const missing = Object.entries(idx)
    .filter(([, v]) => v === -1)
    .map(([k]) => k)

  if (missing.length > 0) {
    return { orders: [], errors: [`Missing required columns: ${missing.join(', ')}`] }
  }

  const dataLines = lines.slice(1)
  const orders: Order[] = []

  dataLines.forEach((line, i) => {
    const cells = line.split('\t').map(c => c.trim())
    const mkt = cells[idx.mkt] ?? ''

    if (mkt !== 'LME_NTP') return

    const contract = cells[idx.contract] ?? ''
    const bs = (cells[idx.bs] ?? '').toUpperCase()
    const lotsRaw = cells[idx.lots] ?? ''
    const orderId = cells[idx.orderId] ?? ''

    if (!contract) {
      errors.push(`Row ${i + 2}: missing Contract`)
      return
    }
    if (bs !== 'BUY' && bs !== 'SELL') {
      errors.push(`Row ${i + 2}: BS must be BUY or SELL, got "${bs}"`)
      return
    }

    const lots = parseInt(lotsRaw, 10)
    if (isNaN(lots) || lots <= 0) {
      errors.push(`Row ${i + 2}: invalid Lots value "${lotsRaw}"`)
      return
    }

    orders.push({
      contract,
      ticker: `${contract} Comdty`,
      bs: bs as 'BUY' | 'SELL',
      lots,
      orderId,
      mkt,
    })
  })

  return { orders, errors }
}
