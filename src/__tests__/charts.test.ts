import { describe, test, expect } from 'vitest'
import {
  groupByAssetType,
  groupByLocation,
  computeUnrealizedPnLByPosition,
  computeCapitalGainsExposure,
  computeCostVsValue,
  computeRsuVesting,
  computeRsuVestEvents,
  rsuVestedSharesAsOf,
  computeThemeDistribution,
} from '../lib/charts'

// ── Shared fixture ────────────────────────────────────────────
const stockAsset = {
  asset_type: 'Stock',
  name: 'Apple Stock',
  price: null,
  ticker: {
    symbol: 'AAPL',
    current_price: 200,
    ticker_themes: [
      { theme: { name: 'AI' } },
      { theme: { name: 'Cloud' } },
    ],
  },
  location: { name: 'Fidelity' },
  stock_subtypes: [
    {
      subtype: 'Market',
      transactions: [
        { count: 10, cost_price: 150, capital_gains_status: 'Long Term' },
      ],
      rsu_grants: [],
    },
    {
      subtype: 'RSU',
      transactions: [
        { count: 5, cost_price: 100, capital_gains_status: 'Short Term' },
      ],
      rsu_grants: [
        {
          grant_date: '2023-01-01',
          total_shares: 100,
          vest_start: '2023-01-01',
          vest_end: '2027-01-01',
          cliff_date: null,
        },
      ],
    },
  ],
}

const cashAsset = {
  asset_type: 'Cash',
  name: 'Checking',
  price: 5000,
  ticker: null,
  location: { name: 'Chase' },
  stock_subtypes: [],
}

// ── groupByAssetType ──────────────────────────────────────────
describe('groupByAssetType', () => {
  test('includes all subtypes when all active', () => {
    const result = groupByAssetType([stockAsset, cashAsset], new Set(['Market', 'ESPP', 'RSU']))
    const stock = result.find(g => g.type === 'Stock')!
    // 10 Market shares + 5 RSU shares = 15 shares × $200 = $3000
    expect(stock.value).toBe(3000)
    const cash = result.find(g => g.type === 'Cash')!
    expect(cash.value).toBe(5000)
  })

  test('excludes RSU shares when RSU toggled off', () => {
    const result = groupByAssetType([stockAsset], new Set(['Market', 'ESPP']))
    const stock = result.find(g => g.type === 'Stock')!
    // Only 10 Market shares × $200 = $2000
    expect(stock.value).toBe(2000)
  })

  test('filters out zero-value groups', () => {
    // Toggle off all subtypes — Stock drops to 0, should not appear
    const result = groupByAssetType([stockAsset], new Set<string>())
    expect(result.find(g => g.type === 'Stock')).toBeUndefined()
  })
})

// ── groupByLocation ───────────────────────────────────────────
describe('groupByLocation', () => {
  test('sums value by location name', () => {
    const result = groupByLocation([stockAsset, cashAsset])
    const fidelity = result.find(g => g.name === 'Fidelity')!
    // 15 shares × $200 = $3000
    expect(fidelity.value).toBe(3000)
    const chase = result.find(g => g.name === 'Chase')!
    expect(chase.value).toBe(5000)
  })
})

// ── computeUnrealizedPnLByPosition ───────────────────────────
describe('computeUnrealizedPnLByPosition', () => {
  test('computes gain per stock position', () => {
    const result = computeUnrealizedPnLByPosition([stockAsset, cashAsset])
    // Only stocks returned
    expect(result).toHaveLength(1)
    // value = 15 × 200 = 3000, cost = 10×150 + 5×100 = 2000, gain = 1000
    expect(result[0].gain).toBe(1000)
    expect(result[0].name).toBe('Apple Stock')
  })

  test('excludes positions with zero gain', () => {
    const flat = {
      ...stockAsset,
      ticker: { symbol: 'XYZ', current_price: 150 },
      stock_subtypes: [
        { subtype: 'Market', transactions: [{ count: 1, cost_price: 150, capital_gains_status: 'Short Term' }], rsu_grants: [] },
      ],
    }
    const result = computeUnrealizedPnLByPosition([flat])
    expect(result).toHaveLength(0)
  })
})

// ── computeCapitalGainsExposure ───────────────────────────────
describe('computeCapitalGainsExposure', () => {
  test('sums short and long term gains', () => {
    const result = computeCapitalGainsExposure([stockAsset])
    // Long Term: 10 × (200 - 150) = 500
    expect(result.longTerm).toBe(500)
    // Short Term: 5 × (200 - 100) = 500
    expect(result.shortTerm).toBe(500)
  })
})

// ── computeCostVsValue ────────────────────────────────────────
describe('computeCostVsValue', () => {
  test('returns cost basis and current value for stocks', () => {
    const result = computeCostVsValue([stockAsset, cashAsset])
    expect(result).toHaveLength(1)
    expect(result[0].costBasis).toBe(2000)   // 10×150 + 5×100
    expect(result[0].currentValue).toBe(3000) // 15×200
  })
})

// ── computeRsuVesting ─────────────────────────────────────────
describe('computeRsuVesting', () => {
  test('computes vested shares via quarterly installments (default frequency)', () => {
    // Grant: 100 shares, grant_date/vest_start 2023-01-01, vest_end 2027-01-01,
    // no vesting_frequency set -> defaults to quarterly. 16 quarters total
    // (4 years / 3 months), 6 shares/quarter, cliff (period 0, no separate
    // cliff_date here) absorbs the remainder: 100 - 6*16 = 4.
    // today = 2025-01-01 is exactly the 8th quarterly mark -> 4 + 8*6 = 52.
    const today = new Date('2025-01-01')
    const result = computeRsuVesting([stockAsset], today)
    expect(result).toHaveLength(1)
    expect(result[0].vestedShares).toBe(52)
    expect(result[0].unvestedShares).toBe(48)
  })

  test('returns 0 vested if before cliff', () => {
    const grantWithCliff = {
      ...stockAsset,
      stock_subtypes: [
        {
          subtype: 'RSU',
          transactions: [],
          rsu_grants: [{
            grant_date: '2024-01-01',
            total_shares: 100,
            vest_start: '2024-01-01',
            vest_end: '2028-01-01',
            cliff_date: '2025-01-01',
          }],
        },
      ],
    }
    const today = new Date('2024-07-01') // before cliff
    const result = computeRsuVesting([grantWithCliff], today)
    expect(result[0].vestedShares).toBe(0)
    expect(result[0].unvestedShares).toBe(100)
  })

  test('returns all vested if past vest_end', () => {
    const today = new Date('2030-01-01')
    const result = computeRsuVesting([stockAsset], today)
    expect(result[0].vestedShares).toBe(100)
    expect(result[0].unvestedShares).toBe(0)
  })

  test('returns empty array if no RSU grants', () => {
    const result = computeRsuVesting([cashAsset])
    expect(result).toHaveLength(0)
  })

  test('sorts rows by vest_end, soonest first, regardless of input/grant_date order', () => {
    const assetWithMultipleGrants = {
      ...stockAsset,
      ticker: { ...stockAsset.ticker, symbol: 'MSFT' },
      stock_subtypes: [
        {
          subtype: 'RSU',
          transactions: [],
          rsu_grants: [
            // Listed latest-vest_end-first and with a later grant_date, so a
            // naive "keep insertion order" or "sort by grant_date" would get
            // this wrong — only sorting by vest_end passes.
            { grant_date: '2024-06-01', total_shares: 50, vest_start: '2024-06-01', vest_end: '2028-06-01', cliff_date: null },
            { grant_date: '2023-01-01', total_shares: 100, vest_start: '2023-01-01', vest_end: '2026-01-01', cliff_date: null },
          ],
        },
      ],
    }
    const today = new Date('2025-01-01')
    const result = computeRsuVesting([assetWithMultipleGrants], today)
    expect(result).toHaveLength(2)
    expect(result[0].label).toContain('01/01/2023')
    expect(result[1].label).toContain('06/01/2024')
  })
})

// ── computeRsuVestEvents / rsuVestedSharesAsOf ────────────────
// Regression coverage for the "app said 19 shares vest next month, real
// brokerage statement said 25" bug: vesting isn't a smooth curve, it's
// discrete installments, and these two real grants (reproduced from the
// reporting user's actual CRM RSUs) must reproduce their actual vest
// amounts exactly.
describe('computeRsuVestEvents / rsuVestedSharesAsOf', () => {
  const grant250 = { grant_date: '2024-03-22', total_shares: 250, vest_start: '2025-03-22', vest_end: '2028-03-22', cliff_date: '2025-03-22', vesting_frequency: 'quarterly' }
  const grant147 = { grant_date: '2025-03-22', total_shares: 147, vest_start: '2026-03-22', vest_end: '2029-03-22', cliff_date: null, vesting_frequency: 'quarterly' }

  test('reproduces the real quarterly vest amounts for September 2026', () => {
    expect(rsuVestedSharesAsOf(grant250, new Date('2026-09-30')) - rsuVestedSharesAsOf(grant250, new Date('2026-09-01'))).toBe(16)
    expect(rsuVestedSharesAsOf(grant147, new Date('2026-09-30')) - rsuVestedSharesAsOf(grant147, new Date('2026-09-01'))).toBe(9)
  })

  test('all quarterly events sum to exactly total_shares', () => {
    const events = computeRsuVestEvents(grant250)
    expect(events.reduce((sum, e) => sum + e.shares, 0)).toBe(250)
  })

  test('cliff absorbs the rounding remainder, later periods are uniform', () => {
    const events = computeRsuVestEvents(grant250)
    // 250 shares / 16 quarters = 15.625 -> 16 per non-cliff quarter, cliff
    // gets whatever's left (250 - 16*12 = 58), not a naive 1/16th.
    expect(events[0].shares).toBe(58)
    expect(events.slice(1).every((e) => e.shares === 16)).toBe(true)
  })

  test('monthly frequency vests every month instead of every quarter', () => {
    // No separate cliff_date -> vest_start is the schedule's day zero, so
    // the "cliff" event itself covers 0 elapsed periods (0 shares) and the
    // 12 real monthly installments follow it.
    const monthly = { grant_date: '2024-01-01', total_shares: 48, vest_start: '2024-01-01', vest_end: '2025-01-01', cliff_date: null, vesting_frequency: 'monthly' }
    const events = computeRsuVestEvents(monthly)
    const nonZero = events.filter((e) => e.shares > 0)
    expect(nonZero).toHaveLength(12)
    expect(nonZero.every((e) => e.shares === 4)).toBe(true)
    expect(events.reduce((sum, e) => sum + e.shares, 0)).toBe(48)
  })

  test('annually frequency vests once a year', () => {
    const annual = { grant_date: '2020-01-01', total_shares: 400, vest_start: '2021-01-01', vest_end: '2024-01-01', cliff_date: '2021-01-01', vesting_frequency: 'annually' }
    const events = computeRsuVestEvents(annual)
    expect(events).toHaveLength(4)
    expect(events.every((e) => e.shares === 100)).toBe(true)
  })

  test('continuous frequency falls back to smooth linear interpolation', () => {
    const continuous = { grant_date: '2023-01-01', total_shares: 100, vest_start: '2023-01-01', vest_end: '2027-01-01', cliff_date: null, vesting_frequency: 'continuous' }
    expect(computeRsuVestEvents(continuous)).toHaveLength(0)
    // 2 of 4 years elapsed -> 50 vested, matching the pre-discrete-model math
    expect(rsuVestedSharesAsOf(continuous, new Date('2025-01-01'))).toBe(50)
  })

  test('defaults to quarterly when vesting_frequency is unset', () => {
    const noFrequency = { grant_date: '2024-03-22', total_shares: 250, vest_start: '2025-03-22', vest_end: '2028-03-22', cliff_date: '2025-03-22' }
    expect(rsuVestedSharesAsOf(noFrequency, new Date('2026-09-30'))).toBe(rsuVestedSharesAsOf(grant250, new Date('2026-09-30')))
  })

  test('nothing vests before the cliff/first vest date', () => {
    expect(rsuVestedSharesAsOf(grant147, new Date('2026-01-01'))).toBe(0)
  })

  test('everything is vested past vest_end', () => {
    expect(rsuVestedSharesAsOf(grant250, new Date('2030-01-01'))).toBe(250)
  })
})

describe('computeThemeDistribution', () => {
  test('splits stock value equally across assigned themes', () => {
    const result = computeThemeDistribution([stockAsset], false)
    expect(result).toHaveLength(2)
    expect(result.find((row) => row.name === 'AI')?.value).toBe(1500)
    expect(result.find((row) => row.name === 'Cloud')?.value).toBe(1500)
  })

  test('adds cash bucket only when includeCash is enabled', () => {
    const withoutCash = computeThemeDistribution([stockAsset, cashAsset], false)
    expect(withoutCash.find((row) => row.name === 'Cash')).toBeUndefined()

    const withCash = computeThemeDistribution([stockAsset, cashAsset], true)
    expect(withCash.find((row) => row.name === 'Cash')?.value).toBe(5000)
  })

  test('uses Uncategorized when stock ticker has no themes', () => {
    const unthemedStock = {
      ...stockAsset,
      ticker: { symbol: 'MSFT', current_price: 100, ticker_themes: [] },
    }
    const result = computeThemeDistribution([unthemedStock], false)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Uncategorized')
  })
})
