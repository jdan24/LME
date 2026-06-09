import type { Order } from '../types'

// Exact column header names as they appear in EaTrade's clipboard output
const HEADER = {
  contract: 'Contract',
  bs:       'BS',
  lots:     'Lots',
  orderId:  'OrderId',
  mkt:      'Mkt',
} as const

const REQUIRED_HEADERS = Object.values(HEADER)

export function parseClipboard(raw: string): { orders: Order[]; errors: string[] } {
  const errors: string[] = []

  // Strip BOM and split into non-empty lines
  const lines = raw
    .replace(/^﻿/, '')
    .trim()
    .split(/\r?\n/)
    .filter(l => l.trim())

  if (lines.length === 0) {
    return { orders: [], errors: ['Clipboard is empty'] }
  }

  const headerCells = lines[0].split('\t').map(c => c.trim())
  const isHeader = headerCells.some(h => REQUIRED_HEADERS.includes(h as typeof REQUIRED_HEADERS[number]))

  if (!isHeader) {
    return {
      orders: [],
      errors: [
        `Could not find expected column headers. Make sure to copy the grid including the header row from EaTrade.` +
        `\nExpected: ${REQUIRED_HEADERS.join(', ')}` +
        `\nFound:    ${headerCells.join(', ')}`,
      ],
    }
  }

  const idx = {
    contract: headerCells.findIndex(h => h === HEADER.contract),
    bs:       headerCells.findIndex(h => h === HEADER.bs),
    lots:     headerCells.findIndex(h => h === HEADER.lots),
    orderId:  headerCells.findIndex(h => h === HEADER.orderId),
    mkt:      headerCells.findIndex(h => h === HEADER.mkt),
  }

  const missing = (Object.entries(idx) as [keyof typeof idx, number][])
    .filter(([, v]) => v === -1)
    .map(([k]) => HEADER[k])

  if (missing.length > 0) {
    return {
      orders: [],
      errors: [
        `Missing required columns: ${missing.join(', ')}` +
        `\nHeaders found in pasted data: ${headerCells.join(', ')}`,
      ],
    }
  }

  const dataLines = lines.slice(1)
  const orders: Order[] = []

  dataLines.forEach((line, i) => {
    const cells = line.split('\t').map(c => c.trim())
    const mkt = cells[idx.mkt] ?? ''

    if (mkt !== 'LME_NTP') return

    const contract = cells[idx.contract] ?? ''
    const bsRaw    = (cells[idx.bs] ?? '').trim().toUpperCase()
    const lotsRaw  = cells[idx.lots] ?? ''
    const orderId  = cells[idx.orderId] ?? ''

    if (!contract) {
      errors.push(`Row ${i + 2}: missing Contract`)
      return
    }

    // EaTrade sends "B" for Buy and "S" for Sell
    const bsMap: Record<string, 'BUY' | 'SELL'> = { B: 'BUY', S: 'SELL' }
    const bs = bsMap[bsRaw]
    if (!bs) {
      errors.push(`Row ${i + 2}: BS must be B or S, got "${bsRaw}"`)
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
