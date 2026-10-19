// Vesting schedule math shared by RSU grants and ESOP option grants. Lives in
// its own module (not charts.ts) so portfolio.ts can value options without
// importing charts.ts, which itself imports portfolio.ts.

// ── RSU Vesting Progress ──────────────────────────────────────
//
// A grant vests either as discrete installments (the real-world shape —
// a lump at the cliff, then equal chunks every month/quarter/year through
// vest_end) or, for a grant nobody's told the app the cadence of, as a
// smooth continuous accrual across [vest_start, vest_end]. This is the one
// place that math lives; the RSU progress chart, the command bar's
// vesting-schedule tool, and the vest-alert edge function (which ports a
// copy, since it can't import from src/) all key off it.

export type RsuVestingFrequency = 'monthly' | 'quarterly' | 'annually' | 'continuous'

const RSU_VESTING_FREQUENCY_MONTHS: Record<Exclude<RsuVestingFrequency, 'continuous'>, number> = {
  monthly: 1,
  quarterly: 3,
  annually: 12,
}

export function normalizeRsuVestingFrequency(value: unknown): RsuVestingFrequency {
  return value === 'monthly' || value === 'quarterly' || value === 'annually' || value === 'continuous'
    ? value
    : 'quarterly'
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setMonth(result.getMonth() + months)
  return result
}

export type RsuVestEvent = { date: Date; shares: number }

// Builds the discrete vest-event list for a grant: a lump at the cliff
// (grant.cliff_date, or grant.vest_start when no separate cliff was
// recorded) covering however many periods elapsed since grant_date, then
// one event every `periodMonths` after that through vest_end. The cliff
// absorbs the rounding remainder so events sum to exactly total_shares —
// standard equity-administration practice, and what reproduces real vest
// amounts (verified against an actual brokerage statement) rather than
// naively splitting total_shares evenly across every period including
// the cliff.
export function computeRsuVestEvents(grant: any): RsuVestEvent[] {
  const frequency = normalizeRsuVestingFrequency(grant?.vesting_frequency)
  if (frequency === 'continuous') return []
  const periodMonths = RSU_VESTING_FREQUENCY_MONTHS[frequency]
  const grantDate = new Date(grant.grant_date)
  const vestEnd = new Date(grant.vest_end)
  const firstVestDate = new Date(grant.cliff_date ?? grant.vest_start)
  const total = Number(grant.total_shares)
  if (!(total > 0) || !(vestEnd > grantDate) || !(firstVestDate <= vestEnd)) return []

  let totalPeriods = 0
  let cursor = new Date(grantDate)
  while (cursor < vestEnd) {
    cursor = addMonths(cursor, periodMonths)
    totalPeriods += 1
  }
  if (totalPeriods <= 0) return []

  let periodsAtCliff = 0
  cursor = new Date(grantDate)
  while (cursor < firstVestDate) {
    cursor = addMonths(cursor, periodMonths)
    periodsAtCliff += 1
  }

  const remainingPeriods = totalPeriods - periodsAtCliff
  const perPeriodShares = Math.round(total / totalPeriods)
  const cliffShares = total - perPeriodShares * remainingPeriods

  const events: RsuVestEvent[] = [{ date: firstVestDate, shares: Math.max(0, cliffShares) }]
  cursor = new Date(firstVestDate)
  for (let i = 0; i < remainingPeriods; i += 1) {
    cursor = addMonths(cursor, periodMonths)
    events.push({ date: cursor, shares: perPeriodShares })
  }
  return events
}

// Shares vested as of a given date — the one primitive every vesting
// question (progress chart, "how many vest next month", alert thresholds)
// reduces to.
export function rsuVestedSharesAsOf(grant: any, asOf: Date): number {
  const total = Number(grant?.total_shares) || 0
  const endedAt = grant?.ended_at ? new Date(grant.ended_at) : null
  const effective = endedAt && endedAt < asOf ? endedAt : asOf

  const frequency = normalizeRsuVestingFrequency(grant?.vesting_frequency)
  if (frequency === 'continuous') {
    const vestStart = new Date(grant.vest_start)
    const vestEnd = new Date(grant.vest_end)
    const cliffDate = grant.cliff_date ? new Date(grant.cliff_date) : null
    if (effective >= vestEnd) return total
    if (effective >= vestStart && (!cliffDate || effective >= cliffDate)) {
      const elapsed = effective.getTime() - vestStart.getTime()
      const duration = vestEnd.getTime() - vestStart.getTime()
      return duration > 0 ? Math.floor((elapsed / duration) * total) : total
    }
    return 0
  }

  let vested = 0
  for (const event of computeRsuVestEvents(grant)) {
    if (event.date <= effective) vested += event.shares
  }
  return Math.min(vested, total)
}
