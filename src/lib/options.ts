// Exchange-traded options (long calls and puts on a listed stock). Valued at
// intrinsic value only — there is no free live option-quote feed, so time
// value is ignored: an out-of-the-money contract shows $0 against the premium
// paid. An expired or closed contract is worth nothing. (Stock options granted
// by an employer are a different thing: see ./esop.)

export type OptionContract = {
  option_type: string
  strike_price: number | string
  expiry_date: string
  contracts: number | string
  multiplier?: number | string | null
  premium_per_share: number | string
  purchase_date?: string | null
  closed_date?: string | null
}

const DEFAULT_MULTIPLIER = 100

/** Local calendar date, YYYY-MM-DD — expiry is a calendar date, not an instant. */
function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Shares of the underlying the contract controls. */
export function contractShares(c: OptionContract): number {
  const multiplier = Number(c.multiplier ?? DEFAULT_MULTIPLIER)
  return Number(c.contracts) * (multiplier > 0 ? multiplier : DEFAULT_MULTIPLIER)
}

export function isContractExpired(c: OptionContract, asOf: Date = new Date()): boolean {
  return c.expiry_date < dateKey(asOf)
}

/** Open = not closed out and not past expiry (it can still be worth something). */
export function isContractOpen(c: OptionContract, asOf: Date = new Date()): boolean {
  return !c.closed_date && !isContractExpired(c, asOf)
}

/** Per-share intrinsic value at `price`: call = price − strike, put = strike − price, never negative. */
export function contractSpread(c: OptionContract, price: number): number {
  const strike = Number(c.strike_price)
  return Math.max(0, c.option_type === 'put' ? strike - price : price - strike)
}

/** Intrinsic value of the open contracts at `price`, unrounded. */
export function contractsIntrinsicValue(contracts: readonly OptionContract[], price: number, asOf: Date = new Date()): number {
  return contracts.reduce(
    (sum, c) => (isContractOpen(c, asOf) ? sum + contractSpread(c, price) * contractShares(c) : sum),
    0,
  )
}

/** Premium paid for the open contracts. */
export function contractsCostBasis(contracts: readonly OptionContract[], asOf: Date = new Date()): number {
  return contracts.reduce(
    (sum, c) => (isContractOpen(c, asOf) ? sum + Number(c.premium_per_share) * contractShares(c) : sum),
    0,
  )
}

/** Realized result of a closed contract: (premium received − premium paid) × shares controlled. */
export function closedContractResult(c: OptionContract & { close_premium_per_share?: number | string | null }): number | null {
  if (!c.closed_date) return null
  return (Number(c.close_premium_per_share ?? 0) - Number(c.premium_per_share)) * contractShares(c)
}
