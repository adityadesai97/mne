import { describe, test, expect } from 'vitest'
import {
  groupByAssetType,
  groupByLocation,
  computeUnrealizedPnLByPosition,
  computeCapitalGainsExposure,
  computeCostVsValue,
  computeRsuVesting,
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
  test('computes vested shares linearly', () => {
    // Grant: 100 shares, vest_start 2023-01-01, vest_end 2027-01-01 (4 years)
    // today = 2025-01-01 → 2 years elapsed of 4 → 50 shares vested
    const today = new Date('2025-01-01')
    const result = computeRsuVesting([stockAsset], today)
    expect(result).toHaveLength(1)
    expect(result[0].vestedShares).toBe(50)
    expect(result[0].unvestedShares).toBe(50)
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
