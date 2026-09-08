// src/__tests__/plaidMatching.test.ts
import { assetNaturalKey } from '../lib/plaidMatching'

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
