// Shared maths + formatting for the tax-lot layouts (summary / timeline).
// Presentation helpers only: nothing here reads or writes data.

const MS_DAY = 86_400_000

export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (year && month && day) return new Date(year, month - 1, day)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function startOfToday(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_DAY)
}

export function addYear(d: Date): Date {
  return new Date(d.getFullYear() + 1, d.getMonth(), d.getDate())
}

export function toIsoKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

export function fmtMoney(n: number): string {
  // Sub-dollar prices (e.g. a $0.00001 meme coin) need more than 2 decimals
  // to show anything but $0.00.
  const abs = Math.abs(Number(n))
  const maximumFractionDigits = abs > 0 && abs < 1 ? 8 : 2
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits }).format(Number(n))
}

export function fmtMoney0(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

/** Quantity without a unit word. Crypto is tracked to 8 decimals, shares to 4. */
export function fmtQty(n: number, isCrypto = false): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: isCrypto ? 8 : 4 }).format(n)
}

/** "1 share" / "12 shares" / "0.5 units". */
export function qtyText(n: number, isCrypto = false): string {
  return `${fmtQty(n, isCrypto)} ${plural(n, isCrypto ? 'unit' : 'share', isCrypto ? 'units' : 'shares')}`
}

export function qtyWord(n: number, isCrypto = false): string {
  return plural(n, isCrypto ? 'unit' : 'share', isCrypto ? 'units' : 'shares')
}

/** A stock/crypto tax lot with everything either layout shows, derived once. */
export interface StockLot {
  raw: any
  id: string
  date: string
  shares: number
  soldAtVest: number
  cost: number
  basis: number
  value: number | null
  gain: number | null
  pct: number | null
  isLong: boolean
  ltDate: Date | null
  /** Days until the lot turns long term; null once long term or if overdue. */
  toLT: number | null
  held: number | null
  /** 0..1 progress towards the one-year mark. */
  progress: number
}

export function buildStockLot(t: any, price: number | null, today: Date): StockLot {
  const totalVested = Number(t.count ?? 0)
  const soldAtVest = Number(t.sold_at_vest ?? 0)
  const shares = Math.max(0, totalVested - soldAtVest)
  const cost = Number(t.cost_price ?? 0)
  const basis = shares * cost
  const value = price !== null ? shares * price : null
  const gain = value !== null ? value - basis : null
  const isLong = t.capital_gains_status === 'Long Term'
  const bought = parseIsoDate(t.purchase_date)
  const ltDate = bought ? addYear(bought) : null
  const held = bought ? Math.max(0, daysBetween(bought, today)) : null
  let toLT: number | null = null
  if (!isLong && ltDate && ltDate >= today) toLT = daysBetween(today, ltDate)
  const progress = isLong ? 1 : held !== null ? Math.min(1, held / 365) : 0
  return {
    raw: t, id: t.id, date: t.purchase_date, shares, soldAtVest, cost, basis, value, gain,
    pct: gain !== null && basis > 0 ? (gain / basis) * 100 : null,
    isLong, ltDate, toLT, held, progress,
  }
}

export function sumLots(lots: StockLot[]) {
  let shares = 0
  let basis = 0
  let value: number | null = 0
  for (const l of lots) {
    shares += l.shares
    basis += l.basis
    value = value !== null && l.value !== null ? value + l.value : null
  }
  const gain = value !== null ? value - basis : null
  return { shares, basis, value, gain, pct: gain !== null && basis > 0 ? (gain / basis) * 100 : null }
}
