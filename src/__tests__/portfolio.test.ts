import {
  computeAssetValue, computeCostBasis, computeUnrealizedGain, computeTotalNetWorth, computeDailyChange,
  isTradableFixedIncome, computeFixedIncomeLotCount, computeFixedIncomeCostBasis, computeFixedIncomeExpectedReturn,
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
