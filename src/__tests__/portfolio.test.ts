import {
  computeAssetValue, computeCostBasis, computeUnrealizedGain, computeTotalNetWorth, computeDailyChange,
  isTickerAsset, localDateKey, computeDailyPosition, isTradableFixedIncome, computeFixedIncomeLotCount, computeFixedIncomeCostBasis, computeFixedIncomeExpectedReturn,
} from '../lib/portfolio'

const mockStockAsset = {
  asset_type: 'Stock',
  price: null,
  ticker: { current_price: 100 },
  stock_subtypes: [{
    transactions: [
      { count: '10', cost_price: '80' },
      { count: '5', cost_price: '90' },
    ],
    rsu_grants: []
  }]
} as any

const mockCashAsset = {
  asset_type: 'Cash',
  price: 5000,
  ticker: null,
  stock_subtypes: []
} as any

test('computes stock value from shares * current price', () => {
  expect(computeAssetValue(mockStockAsset)).toBe(1500) // 15 shares * $100
})

test('computes cost basis from lots', () => {
  expect(computeCostBasis(mockStockAsset)).toBe(1250) // (10*80) + (5*90)
})

test('computes unrealized gain', () => {
  expect(computeUnrealizedGain(mockStockAsset)).toBe(250) // 1500 - 1250
})

test('computes total net worth', () => {
  expect(computeTotalNetWorth([mockStockAsset, mockCashAsset])).toBe(6500)
})

test('returns 0 for stock asset with no lots', () => {
  const assetWithNoLots = {
    asset_type: 'Stock',
    price: null,
    ticker: { current_price: 100 },
    stock_subtypes: null,
  } as any
  expect(computeAssetValue(assetWithNoLots)).toBe(0)
  expect(computeCostBasis(assetWithNoLots)).toBe(0)
})

test('computes daily change from current price vs previous close', () => {
  const asset = {
    asset_type: 'Stock',
    price: null,
    ticker: { current_price: 110, previous_close: 100 },
    stock_subtypes: [{ transactions: [{ count: '10', cost_price: '80' }], rsu_grants: [] }],
  } as any
  const change = computeDailyChange(asset)
  expect(change).toEqual({ dollarChange: 100, percentChange: 10 })
})

test('returns null daily change when previous_close is missing or no shares held', () => {
  const noPreviousClose = {
    asset_type: 'Stock',
    price: null,
    ticker: { current_price: 110, previous_close: null },
    stock_subtypes: [{ transactions: [{ count: '10', cost_price: '80' }], rsu_grants: [] }],
  } as any
  expect(computeDailyChange(noPreviousClose)).toBeNull()

  const noShares = {
    asset_type: 'Stock',
    price: null,
    ticker: { current_price: 110, previous_close: 100 },
    stock_subtypes: [],
  } as any
  expect(computeDailyChange(noShares)).toBeNull()

  expect(computeDailyChange(mockCashAsset)).toBeNull()
})

test('never reports a gain/loss for a non-stock asset, even with a price change baked in', () => {
  const cashAssetWithStaleBaseline = {
    ...mockCashAsset,
    price: 871.77,
    initial_price: 10775.85,
  } as any
  expect(computeUnrealizedGain(cashAssetWithStaleBaseline)).toBe(0)
  expect(computeUnrealizedGain(mockCashAsset)).toBe(0)
})

test('isTradableFixedIncome is true only for Bond/T-Bill Fixed Income', () => {
  expect(isTradableFixedIncome({ asset_type: 'Fixed Income', fixed_income_subtype: 'Bond' })).toBe(true)
  expect(isTradableFixedIncome({ asset_type: 'Fixed Income', fixed_income_subtype: 'T-Bill' })).toBe(true)
  expect(isTradableFixedIncome({ asset_type: 'Fixed Income', fixed_income_subtype: 'CD' })).toBe(false)
  expect(isTradableFixedIncome({ asset_type: 'Fixed Income', fixed_income_subtype: 'Deposit' })).toBe(false)
  expect(isTradableFixedIncome({ asset_type: 'Stock' })).toBe(false)
})

const mockTBillAsset = {
  asset_type: 'Fixed Income',
  fixed_income_subtype: 'T-Bill',
  price: null,
  ticker: null,
  stock_subtypes: [],
  interest_rate: null,
  maturity_date: '2026-08-11',
  face_value: 100,
  fixed_income_lots: [
    { count: '10', cost_price: '98', purchase_date: '2025-08-11' },
  ],
} as any

const mockBondAsset = {
  asset_type: 'Fixed Income',
  fixed_income_subtype: 'Bond',
  price: null,
  ticker: null,
  stock_subtypes: [],
  interest_rate: 5,
  maturity_date: '2026-08-11',
  face_value: 1000,
  fixed_income_lots: [
    { count: '5', cost_price: '1000', purchase_date: '2024-08-11' },
  ],
} as any

test('computes lot count and cost basis for a tradable Fixed Income asset', () => {
  expect(computeFixedIncomeLotCount(mockTBillAsset)).toBe(10)
  expect(computeFixedIncomeCostBasis(mockTBillAsset)).toBe(980) // 10 * 98
})

test('values a tradable Fixed Income asset at lot cost basis, not a flat price', () => {
  expect(computeAssetValue(mockTBillAsset)).toBe(980)
})

test('falls back to price for a tradable Fixed Income asset with no lots yet', () => {
  const noLotsYet = { ...mockTBillAsset, price: 500, fixed_income_lots: [] }
  expect(computeAssetValue(noLotsYet)).toBe(500)
})

test('never reports a gain/loss for a tradable Fixed Income asset (P&L stays stock-only)', () => {
  expect(computeUnrealizedGain(mockTBillAsset)).toBe(0)
  expect(computeUnrealizedGain(mockBondAsset)).toBe(0)
})

test('computes expected return for a T-Bill: discount captured, no periodic interest', () => {
  const result = computeFixedIncomeExpectedReturn(mockTBillAsset)
  expect(result).not.toBeNull()
  expect(result!.costBasis).toBe(980)
  expect(result!.faceValueTotal).toBe(1000)
  expect(result!.capitalGain).toBe(20)
  expect(result!.interestIncome).toBe(0)
  expect(result!.totalExpectedReturn).toBe(20)
  expect(result!.expectedReturnPct).toBeCloseTo(2.0408, 3)
  expect(result!.annualizedYieldPct).toBeCloseTo(2.0408, 3) // ~1 year holding
})

test('computes expected return for a Bond: coupon income plus price gain/loss to par', () => {
  const result = computeFixedIncomeExpectedReturn(mockBondAsset)
  expect(result).not.toBeNull()
  expect(result!.costBasis).toBe(5000)
  expect(result!.faceValueTotal).toBe(5000)
  expect(result!.capitalGain).toBe(0) // bought at par
  expect(result!.interestIncome).toBe(500) // 5 units * $1000 face * 5% * 2 years
  expect(result!.totalExpectedReturn).toBe(500)
  expect(result!.expectedReturnPct).toBeCloseTo(10, 3)
  expect(result!.annualizedYieldPct).toBeCloseTo(5, 3) // 2 year holding
})

test('expected return is null when not tradable, missing lots, or missing face_value/maturity', () => {
  expect(computeFixedIncomeExpectedReturn(mockCashAsset)).toBeNull()
  expect(computeFixedIncomeExpectedReturn({ ...mockTBillAsset, fixed_income_lots: [] })).toBeNull()
  expect(computeFixedIncomeExpectedReturn({ ...mockTBillAsset, face_value: null })).toBeNull()
  expect(computeFixedIncomeExpectedReturn({ ...mockTBillAsset, maturity_date: null })).toBeNull()
})

const mockCryptoAsset = {
  asset_type: 'Crypto',
  price: null,
  ticker: { current_price: 60000.5, previous_close: 50000 },
  stock_subtypes: [{
    transactions: [
      { count: '0.5', cost_price: '40000' },
      { count: '0.25000001', cost_price: '50000' },
    ],
    rsu_grants: [],
  }],
} as any

test('isTickerAsset covers stocks and crypto but not other asset types', () => {
  expect(isTickerAsset({ asset_type: 'Stock' })).toBe(true)
  expect(isTickerAsset({ asset_type: 'Crypto' })).toBe(true)
  expect(isTickerAsset({ asset_type: 'Cash' })).toBe(false)
  expect(isTickerAsset({ asset_type: 'Fixed Income' })).toBe(false)
})

test('crypto asset value is fractional units x live price', () => {
  // 0.75000001 coins x 60000.5
  expect(computeAssetValue(mockCryptoAsset)).toBe(45000.38)
})

test('crypto cost basis, unrealized gain and daily change work like a stock position', () => {
  expect(computeCostBasis(mockCryptoAsset)).toBe(32500)
  expect(computeUnrealizedGain(mockCryptoAsset)).toBeCloseTo(45000.38 - 32500, 2)
  const change = computeDailyChange(mockCryptoAsset)
  expect(change?.percentChange).toBeCloseTo(20.001, 2)
  expect(change?.dollarChange).toBeCloseTo(0.75000001 * 10000.5, 1)
})

test('a crypto asset with no price yet is valued at 0, not NaN', () => {
  expect(computeAssetValue({ ...mockCryptoAsset, ticker: { current_price: null } })).toBe(0)
})

// ── Daily change measures what was held today ────────────────────────────

const TODAY = '2026-10-03'
function dailyAsset(lots: { units: number; cost: number; boughtOn?: string }[], now = 110, prev = 100, assetType = 'Stock') {
  return {
    asset_type: assetType,
    price: null,
    ticker: { current_price: now, previous_close: prev },
    stock_subtypes: [{
      transactions: lots.map(l => ({ count: String(l.units), cost_price: String(l.cost), ...(l.boughtOn ? { purchase_date: l.boughtOn } : {}) })),
      rsu_grants: [],
    }],
  } as any
}

test('a lot bought today is measured from its purchase price; older lots still from previous_close', () => {
  const asset = dailyAsset([{ units: 10, cost: 80, boughtOn: '2026-09-01' }, { units: 10, cost: 108, boughtOn: TODAY }])
  const change = computeDailyChange(asset, TODAY)
  // old lot: 10 x (110-100) = 100; new lot: 10 x (110-108) = 20; start value 1000 + 1080
  expect(change?.dollarChange).toBe(120)
  expect(change?.percentChange).toBeCloseTo((120 * 100) / 2080, 8)
  expect(change?.sinceBuy).toBeUndefined()
})

test('a position bought entirely today is its return since purchase and flagged sinceBuy', () => {
  const change = computeDailyChange(dailyAsset([{ units: 10, cost: 108, boughtOn: TODAY }]), TODAY)
  expect(change).toEqual({ dollarChange: 20, percentChange: (20 * 100) / 1080, sinceBuy: true })
})

test('lots bought before today, or with no purchase date, keep the previous_close anchor (unchanged behavior)', () => {
  expect(computeDailyChange(dailyAsset([{ units: 10, cost: 80, boughtOn: '2026-10-02' }]), TODAY)).toEqual({ dollarChange: 100, percentChange: 10 })
  expect(computeDailyChange(dailyAsset([{ units: 10, cost: 80 }]), TODAY)).toEqual({ dollarChange: 100, percentChange: 10 })
  // a lot bought today with no usable cost basis also keeps the old anchor
  expect(computeDailyChange(dailyAsset([{ units: 10, cost: 0, boughtOn: TODAY }]), TODAY)).toEqual({ dollarChange: 100, percentChange: 10 })
})

test('a coin up ~158% in 24h is a ~flat day for a position bought today near the current price', () => {
  // prev (24h ago) 88.3, now 227.94, bought today at 227 -> the day's +158% isn't this position's move
  const change = computeDailyChange(dailyAsset([{ units: 21.6817, cost: 227, boughtOn: TODAY }], 227.94, 88.3, 'Crypto'), TODAY)
  expect(change?.sinceBuy).toBe(true)
  expect(change?.percentChange).toBeCloseTo(((227.94 - 227) / 227) * 100, 6)
  expect(Math.abs(change!.percentChange)).toBeLessThan(1)
})

test('computeDailyPosition exposes the dollar move and the value it is measured against', () => {
  const position = computeDailyPosition(dailyAsset([{ units: 10, cost: 80, boughtOn: '2026-09-01' }, { units: 5, cost: 108, boughtOn: TODAY }]), TODAY)
  expect(position).toEqual({ dollarChange: 10 * 10 + 5 * 2, startValue: 10 * 100 + 5 * 108, allBoughtToday: false })
})

test('localDateKey is the local calendar date, zero-padded', () => {
  expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  expect(localDateKey(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
})
