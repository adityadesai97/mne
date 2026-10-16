import { test, expect, vi, beforeEach } from 'vitest'

const finnhubFetch = vi.fn()
const coingeckoFetch = vi.fn()
vi.mock('@/lib/marketData', () => ({
  finnhubFetch: (...a: unknown[]) => finnhubFetch(...a),
  coingeckoFetch: (...a: unknown[]) => coingeckoFetch(...a),
}))
vi.mock('@/store/config', () => ({ config: { coingeckoKeySet: false } }))

import { searchStocks, searchCrypto, normalizeStockResults, rankSuggestions, StockSearchError, searchErrorMessage } from '@/lib/symbolSearch'
import { CoinGeckoError } from '@/lib/coingecko'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => { finnhubFetch.mockReset(); coingeckoFetch.mockReset() })

test('empty or whitespace queries never hit the network', async () => {
  expect(await searchStocks('   ')).toEqual([])
  expect(await searchCrypto('')).toEqual([])
  expect(finnhubFetch).not.toHaveBeenCalled()
  expect(coingeckoFetch).not.toHaveBeenCalled()
})

test('stock results keep supported types, drop foreign listings, rank exact symbol first and cap at 8', async () => {
  const result = [
    { description: 'APPLE HOSPITALITY REIT INC', displaySymbol: 'APLE', symbol: 'APLE', type: 'REIT' },
    { description: 'APPLE INC', displaySymbol: 'AAPL', symbol: 'AAPL', type: 'Common Stock' },
    { description: 'APPLE INC', displaySymbol: 'AAPL.SW', symbol: 'AAPL.SW', type: 'Common Stock' },
    { description: 'APPLE WARRANT', displaySymbol: 'AAPLW', symbol: 'AAPLW', type: 'Warrant' },
    { description: 'BERKSHIRE HATHAWAY INC-CL B', displaySymbol: 'BRK.B', symbol: 'BRK.B', type: 'Common Stock' },
    { description: 'APPLE INC', displaySymbol: 'AAPL', symbol: 'AAPL', type: 'Common Stock' },
    ...Array.from({ length: 12 }, (_, i) => ({ description: `X${i}`, displaySymbol: `ZZ${i}`, symbol: `ZZ${i}`, type: 'ETP' })),
  ]
  finnhubFetch.mockResolvedValue(json({ count: result.length, result }))
  const signal = new AbortController().signal
  const out = await searchStocks(' aapl ', signal)
  expect(finnhubFetch).toHaveBeenCalledWith('search', { q: 'aapl' }, signal)
  expect(out[0]).toMatchObject({ symbol: 'AAPL', name: 'Apple Inc', label: 'Stock', kind: 'stock' })
  expect(out.map(o => o.symbol)).not.toContain('AAPL.SW')
  expect(out.map(o => o.symbol)).not.toContain('AAPLW')
  expect(out.filter(o => o.symbol === 'AAPL')).toHaveLength(1)
  expect(out.length).toBe(8)
  expect(out.find(o => o.symbol === 'ZZ0')?.label).toBe('ETF')
})

test('single-letter share classes are kept', () => {
  const out = normalizeStockResults({ result: [{ description: 'BERKSHIRE', symbol: 'BRK.B', type: 'Common Stock' }] }, 'brk')
  expect(out.map(o => o.symbol)).toEqual(['BRK.B'])
})

test('rankSuggestions puts exact, then prefix, then the rest, stably', () => {
  const out = rankSuggestions([{ symbol: 'XAAPL' }, { symbol: 'AAPLX' }, { symbol: 'AAPL' }], 'aapl')
  expect(out.map(o => o.symbol)).toEqual(['AAPL', 'AAPLX', 'XAAPL'])
})

test('stock search failures throw a StockSearchError with the status', async () => {
  finnhubFetch.mockResolvedValue(json({ error: 'That endpoint is not allowed.' }, 400))
  await expect(searchStocks('aapl')).rejects.toMatchObject({ name: 'StockSearchError', status: 400 })
  finnhubFetch.mockResolvedValue(json({ error: 'No Finnhub API key' }, 409))
  await expect(searchStocks('aapl')).rejects.toBeInstanceOf(StockSearchError)
  expect(searchErrorMessage(new StockSearchError(400))).toMatch(/still type a symbol/)
})

test('crypto results: exact symbol first, then market-cap rank, with coin ids', async () => {
  coingeckoFetch.mockResolvedValue(json({ coins: [
    { id: 'wrapped-bitcoin', name: 'Wrapped Bitcoin', symbol: 'WBTC', market_cap_rank: 15, thumb: 't1' },
    { id: 'bitcoin-cash', name: 'Bitcoin Cash', symbol: 'BCH', market_cap_rank: 20, large: 'l2' },
    { id: 'fake-btc', name: 'Fake BTC', symbol: 'BTC', market_cap_rank: null },
    { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', market_cap_rank: 1, large: 'l0' },
  ] }))
  const out = await searchCrypto('btc')
  expect(coingeckoFetch).toHaveBeenCalledWith('search', { query: 'btc' }, undefined)
  expect(out.map(o => o.coinId)).toEqual(['bitcoin', 'fake-btc', 'wrapped-bitcoin', 'bitcoin-cash'])
  expect(out[0]).toMatchObject({ symbol: 'BTC', name: 'Bitcoin', label: '#1', kind: 'crypto', logo: 'l0' })
  expect(out[1].label).toBe('Crypto')
})

test('CoinGecko rate limit surfaces its user-facing message', async () => {
  coingeckoFetch.mockResolvedValue(json({}, 429))
  const err = await searchCrypto('btc').catch(e => e)
  expect(err).toBeInstanceOf(CoinGeckoError)
  expect(searchErrorMessage(err)).toMatch(/rate limit/)
})
