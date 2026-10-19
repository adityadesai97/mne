import { test, expect } from 'vitest'
import { closedContractResult, contractsCostBasis, contractsIntrinsicValue, isContractOpen } from '@/lib/options'
import { computeAssetValue, computeCostBasis, computeSubtypeValue, getLivePrice } from '@/lib/portfolio'
import { validateOptionContract } from '@/lib/db/optionContracts'

const call = (over: any = {}) => ({ option_type: 'call', strike_price: 100, expiry_date: '2030-01-01', contracts: 2, multiplier: 100, premium_per_share: 5, ...over })
const put = (over: any = {}) => call({ option_type: 'put', ...over })
const NOW = new Date('2026-10-19T12:00:00')

test('a call is worth price − strike per share, a put strike − price, never negative', () => {
  expect(contractsIntrinsicValue([call()], 130, NOW)).toBe(30 * 200)
  expect(contractsIntrinsicValue([call()], 90, NOW)).toBe(0)
  expect(contractsIntrinsicValue([put()], 80, NOW)).toBe(20 * 200)
  expect(contractsIntrinsicValue([put()], 120, NOW)).toBe(0)
})

test('expired and closed contracts are worth nothing and carry no cost basis', () => {
  const expired = call({ expiry_date: '2026-10-18' })
  const closed = call({ closed_date: '2026-10-01', close_premium_per_share: 7 })
  expect(isContractOpen(expired, NOW)).toBe(false)
  expect(contractsIntrinsicValue([expired, closed], 500, NOW)).toBe(0)
  expect(contractsCostBasis([expired, closed], NOW)).toBe(0)
  // expiring today is still open
  expect(isContractOpen(call({ expiry_date: '2026-10-19' }), NOW)).toBe(true)
})

test('realized result of a closed contract', () => {
  expect(closedContractResult(call({ closed_date: '2026-10-01', close_premium_per_share: 7 }))).toBe((7 - 5) * 200)
  expect(closedContractResult(call())).toBeNull()
})

const stock = (extra: any = {}) => ({
  asset_type: 'Stock', price: null, ticker: { current_price: 130 },
  stock_subtypes: [{ subtype: 'Market', transactions: [{ count: 10, cost_price: 100 }], rsu_grants: [] }],
  ...extra,
})

test('contracts add intrinsic value and premium cost to the position', () => {
  const a = stock({ option_contracts: [call()] }) as any
  expect(computeAssetValue(a)).toBe(10 * 130 + 30 * 200)
  expect(computeCostBasis(a)).toBe(10 * 100 + 5 * 200)
})

test('contracts count in the subtype filter only when Options is active', () => {
  const a = stock({ option_contracts: [call()] }) as any
  expect(computeSubtypeValue(a, new Set(['Market']))).toBe(1300)
  expect(computeSubtypeValue(a, new Set(['Market', 'Options']))).toBe(computeAssetValue(a))
})

test('a private company (no ticker) is priced by its manual price', () => {
  const priv = { asset_type: 'Stock', price: null, ticker: null, manual_price: 12.5,
    stock_subtypes: [{ subtype: 'Market', transactions: [{ count: 100, cost_price: 5 }], rsu_grants: [] }] } as any
  expect(getLivePrice(priv)).toBe(12.5)
  expect(computeAssetValue(priv)).toBe(1250)
  expect(computeAssetValue({ ...priv, manual_price: null })).toBe(0)
  // a ticker, when there is one, wins over a stale manual price
  expect(getLivePrice({ ticker: { current_price: 9 }, manual_price: 12.5 })).toBe(9)
})

test('contract validation', () => {
  const ok = { option_type: 'call' as const, strike_price: 100, expiry_date: '2030-01-01', contracts: 1, premium_per_share: 2, purchase_date: '2026-10-01' }
  expect(validateOptionContract(ok)).toBeNull()
  expect(validateOptionContract({ ...ok, contracts: 0 })).toMatch(/Contracts/)
  expect(validateOptionContract({ ...ok, strike_price: NaN })).toMatch(/Strike/)
  expect(validateOptionContract({ ...ok, expiry_date: '' })).toMatch(/expiry/)
})
