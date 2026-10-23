// ESOP (stock option) math. An option grant vests exactly like an RSU grant
// (cliff + equal installments, or continuous — see ./vesting), but each option
// has a strike price and is only worth max(0, price − strike). Exercising
// converts options into shares (a Market tax lot), after which they are valued
// as ordinary shares. portfolio.ts values the unexercised part through
// esopIntrinsicValue; nothing else multiplies options × price.

import { rsuVestedSharesAsOf } from './vesting'

export type EsopExercise = { count: number | string }
export type EsopGrant = {
  grant_date: string
  total_options: number | string
  strike_price: number | string
  vest_start: string
  vest_end: string
  cliff_date?: string | null
  vesting_frequency?: string | null
  expiry_date?: string | null
  ended_at?: string | null
  esop_exercises?: EsopExercise[] | null
}

export type EsopPosition = {
  /** Options vested as of the date (capped by `ended_at`). */
  vested: number
  exercised: number
  /** Vested, not yet exercised, and not expired: what could be exercised now. */
  exercisable: number
  expired: boolean
}

/** The grant shaped like an RSU grant so the shared vesting math applies. */
function asVestingGrant(grant: EsopGrant) {
  return { ...grant, total_shares: Number(grant.total_options) }
}

export function esopVestedOptionsAsOf(grant: EsopGrant, asOf: Date = new Date()): number {
  return rsuVestedSharesAsOf(asVestingGrant(grant), asOf)
}

export function esopExercisedCount(grant: EsopGrant): number {
  return (grant.esop_exercises ?? []).reduce((sum, e) => sum + Number(e.count), 0)
}

export function computeEsopPosition(grant: EsopGrant, asOf: Date = new Date()): EsopPosition {
  const vested = esopVestedOptionsAsOf(grant, asOf)
  const exercised = esopExercisedCount(grant)
  const expired = !!grant.expiry_date && new Date(grant.expiry_date) < asOf
  const exercisable = expired ? 0 : Math.max(0, vested - exercised)
  return { vested, exercised, exercisable, expired }
}

/** Spread of one option at `price` (never negative: an underwater option is
 *  worth nothing, it is simply not exercised). */
export function optionSpread(price: number, strike: number | string): number {
  return Math.max(0, price - Number(strike))
}

/** Intrinsic value of the exercisable options across grants at `price`,
 *  unrounded. Unvested, expired and underwater options contribute 0. */
export function esopIntrinsicValue(grants: readonly EsopGrant[], price: number, asOf: Date = new Date()): number {
  return grants.reduce(
    (sum, g) => sum + computeEsopPosition(g, asOf).exercisable * optionSpread(price, g.strike_price),
    0,
  )
}
