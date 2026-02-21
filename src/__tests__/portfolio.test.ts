import { computeAssetValue, computeCostBasis, computeUnrealizedGain, computeTotalNetWorth } from '../lib/portfolio'

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
