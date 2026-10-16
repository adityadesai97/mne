import { test, expect } from 'vitest'
import { validateMarketRequest, buildUpstreamUrl, FINNHUB_PATHS } from '../../supabase/functions/market-proxy/index'

test('accepts the Finnhub endpoints mne uses', () => {
  for (const path of FINNHUB_PATHS) {
    const params = path === 'search' ? { q: 'apple' } : { symbol: 'AAPL' }
    expect(validateMarketRequest({ provider: 'finnhub', path, params })).toBeNull()
  }
})

test('accepts the CoinGecko endpoints mne uses, including per-coin charts', () => {
  expect(validateMarketRequest({ provider: 'coingecko', path: 'simple/price', params: { ids: 'bitcoin' } })).toBeNull()
  expect(validateMarketRequest({ provider: 'coingecko', path: 'search', params: { query: 'btc' } })).toBeNull()
  expect(validateMarketRequest({ provider: 'coingecko', path: 'coins/wrapped-bitcoin/market_chart', params: {} })).toBeNull()
})

test('rejects endpoints that are not on the list', () => {
  expect(validateMarketRequest({ provider: 'finnhub', path: 'stock/candle', params: {} })).toMatch(/not allowed/)
  expect(validateMarketRequest({ provider: 'finnhub', path: '../account', params: {} })).toMatch(/not allowed/)
  expect(validateMarketRequest({ provider: 'coingecko', path: 'coins/bitcoin/market_chart/range', params: {} })).toMatch(/not allowed/)
  expect(validateMarketRequest({ provider: 'coingecko', path: 'coins/../ping/market_chart', params: {} })).toMatch(/not allowed/)
})

test('rejects unknown providers and bad bodies', () => {
  expect(validateMarketRequest({ provider: 'iex', path: 'quote' })).toMatch(/provider/)
  expect(validateMarketRequest(null)).toMatch(/JSON object/)
  expect(validateMarketRequest({ provider: 'finnhub' })).toMatch(/path/)
})

test('callers cannot supply or override the API key', () => {
  expect(validateMarketRequest({ provider: 'finnhub', path: 'quote', params: { token: 'x' } })).toMatch(/not allowed/)
  expect(validateMarketRequest({ provider: 'coingecko', path: 'search', params: { x_cg_demo_api_key: 'x' } })).toMatch(/not allowed/)
})

test('rejects non-string and oversized parameter values', () => {
  expect(validateMarketRequest({ provider: 'finnhub', path: 'quote', params: { symbol: 5 } })).toMatch(/short string/)
  expect(validateMarketRequest({ provider: 'finnhub', path: 'quote', params: { symbol: 'A'.repeat(1001) } })).toMatch(/short string/)
})

test('the stored key is attached on the server side only', () => {
  expect(buildUpstreamUrl('finnhub', 'quote', { symbol: 'AAPL' }, 'KEY1')).toBe('https://finnhub.io/api/v1/quote?symbol=AAPL&token=KEY1')
  expect(buildUpstreamUrl('coingecko', 'simple/price', { ids: 'bitcoin' }, 'CG-1')).toBe('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&x_cg_demo_api_key=CG-1')
})

test('Finnhub symbol search accepts only the q parameter', () => {
  expect(validateMarketRequest({ provider: 'finnhub', path: 'search', params: { q: 'apple' } })).toBeNull()
  expect(validateMarketRequest({ provider: 'finnhub', path: 'search', params: { q: 'apple', exchange: 'US' } })).toMatch(/not allowed/)
  expect(validateMarketRequest({ provider: 'finnhub', path: 'search', params: { token: 'x' } })).toMatch(/not allowed/)
  expect(validateMarketRequest({ provider: 'finnhub', path: 'search', params: { q: 'a'.repeat(1001) } })).toMatch(/short string/)
  // the restriction is per-endpoint: other endpoints keep their own params
  expect(validateMarketRequest({ provider: 'finnhub', path: 'quote', params: { symbol: 'AAPL' } })).toBeNull()
})

test('search is not an allowed CoinGecko-style path on other providers', () => {
  expect(buildUpstreamUrl('finnhub', 'search', { q: 'apple' }, 'KEY1')).toBe('https://finnhub.io/api/v1/search?q=apple&token=KEY1')
})
