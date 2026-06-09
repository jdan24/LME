// Maps the 2-letter base prefix of an LME contract ticker to a human-readable metal name.
// The full contract code (e.g. "LAH6") starts with these 2 letters.
const METAL_PREFIXES: Record<string, string> = {
  CA: 'Copper',
  LA: 'Aluminium',
  LX: 'Zinc',
  LN: 'Nickel',
  LL: 'Lead',
  LT: 'Tin',
}

export function metalName(contract: string): string {
  const prefix = contract.slice(0, 2).toUpperCase()
  return METAL_PREFIXES[prefix] ?? contract
}

// Bloomberg futures month codes
const MONTH_CODES: Record<string, string> = {
  F: 'Jan', G: 'Feb', H: 'Mar', J: 'Apr',
  K: 'May', M: 'Jun', N: 'Jul', Q: 'Aug',
  U: 'Sep', V: 'Oct', X: 'Nov', Z: 'Dec',
}

// Parses a contract like "LAH6" → { metal: "Aluminium", month: "Mar", year: "2026" }
export function parseContract(contract: string): { metal: string; month: string; year: string } | null {
  if (contract.length < 4) return null
  const prefix = contract.slice(0, 2).toUpperCase()
  const monthCode = contract.slice(2, 3).toUpperCase()
  const yearDigit = contract.slice(3, 4)
  const year = `202${yearDigit}`
  const month = MONTH_CODES[monthCode]
  if (!month) return null
  return { metal: METAL_PREFIXES[prefix] ?? prefix, month, year }
}

export function contractLabel(contract: string): string {
  const parsed = parseContract(contract)
  if (!parsed) return contract
  return `${parsed.metal} ${parsed.month} ${parsed.year}`
}

// Builds the Bloomberg EMSX ticker from an EATrade contract code.
//
// Aluminium (prefix "LA") is the ONLY LME metal whose Bloomberg ticker requires
// a 2-digit year code (e.g. EATrade "LAU6" -> "LAU26 Comdty"). Every other metal
// keeps the single-digit year exactly as EATrade provides it (e.g. "LXF7 Comdty").
export function toEmsxTicker(contract: string): string {
  const c = contract.trim().toUpperCase()

  if (c.slice(0, 2) === 'LA') {
    // LA + single month letter + 1-or-2 digit year
    const m = c.match(/^LA([A-Z])(\d{1,2})$/)
    if (m) {
      const [, month, yr] = m
      // Expand a single-digit year to two digits using the current decade
      // (e.g. in the 2020s, "6" -> "26"). Already-2-digit years pass through.
      const decadeDigit = String(Math.floor(new Date().getFullYear() / 10) % 10)
      const yy = yr.length === 1 ? `${decadeDigit}${yr}` : yr
      return `LA${month}${yy} Comdty`
    }
  }

  return `${c} Comdty`
}
