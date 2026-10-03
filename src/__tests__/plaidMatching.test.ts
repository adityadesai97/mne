// src/__tests__/plaidMatching.test.ts
import { assetNaturalKey, compatibleManualMatchCandidates, buildCandidateLotsFromPlaidPayload, findMatchingLot, normalizeCryptoSymbol, perUnitCost } from '../lib/plaidMatching'

const base = {
  assetType: 'Stock',
  name: 'AAPL Stock',
  locationName: 'Fidelity',
  ownership: 'Individual',
  tickerSymbol: 'AAPL',
  fixedIncomeSubtype: null,
}

test('same inputs produce the same key', () => {
  expect(assetNaturalKey(base)).toBe(assetNaturalKey({ ...base }))
})

test('is case-insensitive and trims whitespace', () => {
  const upper = { ...base, name: '  AAPL Stock  ', locationName: 'FIDELITY', tickerSymbol: '  aapl  ' }
  expect(assetNaturalKey(upper)).toBe(assetNaturalKey(base))
})

test('a different location produces a different key', () => {
  expect(assetNaturalKey({ ...base, locationName: 'Schwab' })).not.toBe(assetNaturalKey(base))
})

test('a different ticker produces a different key', () => {
  expect(assetNaturalKey({ ...base, tickerSymbol: 'MSFT' })).not.toBe(assetNaturalKey(base))
})

test('null and empty-string ticker symbol collide (both non-stock)', () => {
  const withNull = assetNaturalKey({ ...base, assetType: 'Cash', tickerSymbol: null })
  const withEmpty = assetNaturalKey({ ...base, assetType: 'Cash', tickerSymbol: '' })
  expect(withNull).toBe(withEmpty)
})

test('a CD and a plain Cash asset at the same location do not collide', () => {
  const cd = assetNaturalKey({
    assetType: 'Fixed Income',
    name: 'Chase',
    locationName: 'Chase',
    ownership: 'Individual',
    tickerSymbol: null,
    fixedIncomeSubtype: 'CD',
  })
  const cash = assetNaturalKey({
    assetType: 'Cash',
    name: 'Chase',
    locationName: 'Chase',
    ownership: 'Individual',
    tickerSymbol: null,
    fixedIncomeSubtype: null,
  })
  expect(cd).not.toBe(cash)
})

test('Individual and Joint ownership of the same position do not collide', () => {
  expect(assetNaturalKey({ ...base, ownership: 'Joint' })).not.toBe(assetNaturalKey(base))
})

// ─── compatibleManualMatchCandidates ────────────────────────────────────────

const stockAsset = { id: 'a-aapl', name: 'AAPL Stock', asset_type: 'Stock', ticker: { symbol: 'AAPL', kind: 'stock' }, location: { name: 'Fidelity' } }
const cryptoAsset = { id: 'a-btc', name: 'Bitcoin', asset_type: 'Crypto', ticker: { symbol: 'AAPL', kind: 'crypto' }, location: { name: 'Coinbase' } }
const cashAsset = { id: 'a-cash', name: 'Checking', asset_type: 'Cash', location: { name: 'Chase' } }
const hsaAsset = { id: 'a-hsa', name: 'HSA', asset_type: 'HSA', location: { name: 'Fidelity' } }
const bondAsset = { id: 'a-bond', name: 'T-Bill ladder', asset_type: 'Fixed Income', fixed_income_subtype: 'T-Bill', location: { name: 'Treasury Direct' } }
const cdAsset = { id: 'a-cd', name: '1yr CD', asset_type: 'Fixed Income', fixed_income_subtype: 'CD', location: { name: 'Chase' } }
const allTestAssets = [stockAsset, cryptoAsset, cashAsset, hsaAsset, bondAsset, cdAsset]

test('a detected stock only matches an existing Stock asset with the exact same ticker, never Crypto', () => {
  const candidates = compatibleManualMatchCandidates('stock', { symbol: 'AAPL' }, allTestAssets)
  expect(candidates).toEqual([{ id: 'a-aapl', label: 'AAPL Stock (Fidelity)' }])
})

test('a detected stock does not match a Stock asset for a different ticker', () => {
  const candidates = compatibleManualMatchCandidates('stock', { symbol: 'MSFT' }, allTestAssets)
  expect(candidates).toEqual([])
})

test('a detected cash balance never matches a Crypto, Stock, or Fixed Income asset — only the same flat-balance type', () => {
  const candidates = compatibleManualMatchCandidates('cash', { asset_type: 'Cash' }, allTestAssets)
  expect(candidates).toEqual([{ id: 'a-cash', label: 'Checking (Chase)' }])
})

test('a detected 401k balance does not match an existing Cash asset', () => {
  const candidates = compatibleManualMatchCandidates('cash', { asset_type: '401k' }, allTestAssets)
  expect(candidates).toEqual([])
})

test('a detected T-Bill only matches an existing T-Bill, never a CD or a Bond', () => {
  const candidates = compatibleManualMatchCandidates('fixed_income', { fixed_income_subtype: 'T-Bill' }, allTestAssets)
  expect(candidates).toEqual([{ id: 'a-bond', label: 'T-Bill ladder (Treasury Direct)' }])
})

test('no compatible candidates returns an empty list, not a guess', () => {
  const candidates = compatibleManualMatchCandidates('fixed_income', { fixed_income_subtype: 'Bond' }, allTestAssets)
  expect(candidates).toEqual([])
})

// ─── buildCandidateLotsFromPlaidPayload / findMatchingLot ──────────────────

test('falls back to the single aggregate lot when Plaid reports no per-lot breakdown', () => {
  const lots = buildCandidateLotsFromPlaidPayload({ count: 10, cost_price: 150, purchase_date: '2026-01-01' })
  expect(lots).toEqual([{ count: 10, cost_price: 150, purchase_date: '2026-01-01' }])
})

test('an empty _lots array still falls back to the aggregate figure rather than producing nothing', () => {
  const lots = buildCandidateLotsFromPlaidPayload({ count: 10, cost_price: 150, purchase_date: '2026-01-01', _lots: [] })
  expect(lots).toEqual([{ count: 10, cost_price: 150, purchase_date: '2026-01-01' }])
})

test('uses every reported lot when Plaid supplies a per-lot breakdown', () => {
  const lots = buildCandidateLotsFromPlaidPayload({
    count: 15,
    cost_price: 140,
    purchase_date: '2026-01-01',
    _lots: [
      { quantity: 10, purchase_price: 150, purchase_date: '2026-01-01' },
      { quantity: 5, purchase_price: 120, purchase_date: '2026-02-01' },
    ],
  })
  expect(lots).toEqual([
    { count: 10, cost_price: 150, purchase_date: '2026-01-01' },
    { count: 5, cost_price: 120, purchase_date: '2026-02-01' },
  ])
})

test('a lot with no quantity, cost, or purchase date is dropped rather than inserted with bad data', () => {
  const lots = buildCandidateLotsFromPlaidPayload({
    count: 10,
    cost_price: 150,
    purchase_date: '2026-01-01',
    _lots: [{ quantity: 10, purchase_price: 150, purchase_date: null }],
  })
  expect(lots).toEqual([])
})

test('no usable data at all (no _lots, no aggregate figures) produces no lots — never falls back to inserting garbage', () => {
  expect(buildCandidateLotsFromPlaidPayload({})).toEqual([])
})

test('findMatchingLot finds an existing lot with the same date/count/cost within tolerance', () => {
  const existing = [{ id: 'txn-1', count: 10, cost_price: 150.001, purchase_date: '2026-01-01' }]
  expect(findMatchingLot({ count: 10, cost_price: 150, purchase_date: '2026-01-01' }, existing)).toEqual(existing[0])
})

test('findMatchingLot returns null for a genuinely different purchase on the same day', () => {
  const existing = [{ id: 'txn-1', count: 10, cost_price: 150, purchase_date: '2026-01-01' }]
  expect(findMatchingLot({ count: 5, cost_price: 200, purchase_date: '2026-01-01' }, existing)).toBeNull()
})

test('findMatchingLot never matches across different purchase dates', () => {
  const existing = [{ id: 'txn-1', count: 10, cost_price: 150, purchase_date: '2026-01-01' }]
  expect(findMatchingLot({ count: 10, cost_price: 150, purchase_date: '2026-02-01' }, existing)).toBeNull()
})

test('an empty existing-lots list never matches — nothing to dedupe against, so the lot is new', () => {
  expect(findMatchingLot({ count: 10, cost_price: 150, purchase_date: '2026-01-01' }, [])).toBeNull()
})

test('normalizeCryptoSymbol strips a delimited quote currency but keeps stablecoins', () => {
  expect(normalizeCryptoSymbol('btc')).toBe('BTC')
  expect(normalizeCryptoSymbol('BTC-USD')).toBe('BTC')
  expect(normalizeCryptoSymbol('eth/usdt')).toBe('ETH')
  expect(normalizeCryptoSymbol('USDT')).toBe('USDT')
  expect(normalizeCryptoSymbol('USDC')).toBe('USDC')
  expect(normalizeCryptoSymbol('  ')).toBeNull()
  expect(normalizeCryptoSymbol(null)).toBeNull()
})

test('perUnitCost divides Plaid\'s total cost basis by quantity', () => {
  expect(perUnitCost({ cost_basis: 1000, quantity: 4 })).toBe(250)
  expect(perUnitCost({ cost_basis: 100, quantity: 0.5 })).toBe(200)
  expect(perUnitCost({ cost_basis: null, quantity: 4 })).toBeNull()
  expect(perUnitCost({ cost_basis: 100, quantity: 0 })).toBeNull()
})

test('a detected coin only links to an existing Crypto asset of the same symbol', () => {
  const assets = [
    { id: 'stock', name: 'BTC Stock', asset_type: 'Stock', ticker: { symbol: 'BTC', kind: 'stock' } },
    { id: 'coin', name: 'BTC', asset_type: 'Crypto', location: { name: 'Robinhood' }, ticker: { symbol: 'BTC', kind: 'crypto' } },
    { id: 'other', name: 'ETH', asset_type: 'Crypto', ticker: { symbol: 'ETH', kind: 'crypto' } },
  ]
  expect(compatibleManualMatchCandidates('stock', { symbol: 'btc', asset_class: 'Crypto' }, assets).map((c) => c.id)).toEqual(['coin'])
})

test('a detected stock never links to a Crypto asset, even with the same symbol', () => {
  const assets = [
    { id: 'coin', name: 'BTC', asset_type: 'Crypto', ticker: { symbol: 'BTC', kind: 'crypto' } },
    { id: 'stock', name: 'BTC Stock', asset_type: 'Stock', ticker: { symbol: 'BTC', kind: 'stock' } },
  ]
  expect(compatibleManualMatchCandidates('stock', { symbol: 'BTC' }, assets).map((c) => c.id)).toEqual(['stock'])
})
