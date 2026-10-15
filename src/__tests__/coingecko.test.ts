import { vi } from 'vitest'
import { CoinGeckoError, derivePreviousClose, fetchCryptoQuotes, fetchCoinDailyHistory, pickCoinForSymbol, searchCoinBySymbol } from '../lib/coingecko'
import { filterNewsForCoin } from '../lib/portfolioExplanation'

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-1' } } }) } }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function stubFetch(body: unknown, ok = true) {
  const fn = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 429, json: async () => body })
  vi.stubGlobal('fetch', fn)
  return fn
}

test('derivePreviousClose backs out the 24h change from the current price', () => {
  expect(derivePreviousClose(110, 10)).toBeCloseTo(100)
  expect(derivePreviousClose(90, -10)).toBeCloseTo(100)
  expect(derivePreviousClose(100, 0)).toBe(100)
})

test('derivePreviousClose returns null for unusable input', () => {
  expect(derivePreviousClose(100, undefined)).toBeNull()
  expect(derivePreviousClose(100, 'abc')).toBeNull()
  expect(derivePreviousClose(100, -100)).toBeNull()
  expect(derivePreviousClose(NaN, 5)).toBeNull()
})

test('fetchCryptoQuotes batches every coin into one request and returns price + previous close', async () => {
  const fetchMock = stubFetch({
    bitcoin: { usd: 60000, usd_24h_change: 20 },
    ethereum: { usd: 3000 },
  })
  const quotes = await fetchCryptoQuotes(['bitcoin', 'ethereum', 'bitcoin', 'missing-coin'])
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const url = String(fetchMock.mock.calls[0][0])
  expect(url).toContain('/simple/price')
  expect(decodeURIComponent(url)).toContain('ids=bitcoin,ethereum,missing-coin')
  expect(quotes.get('bitcoin')?.price).toBe(60000)
  expect(quotes.get('bitcoin')?.previousClose).toBeCloseTo(50000)
  expect(quotes.get('ethereum')?.previousClose).toBeNull()
  expect(quotes.has('missing-coin')).toBe(false)
})

test('keyless CoinGecko calls go straight to CoinGecko with no credentials', async () => {
  const fetchMock = stubFetch({ bitcoin: { usd: 1 } })
  await fetchCryptoQuotes(['bitcoin'])
  const url = String(fetchMock.mock.calls[0][0])
  expect(url.startsWith('https://api.coingecko.com/api/v3/simple/price')).toBe(true)
  expect(url).not.toContain('x_cg_demo_api_key')
})

test('with a saved key the call goes through the market-proxy and carries no key', async () => {
  localStorage.setItem('mne_coingecko_key_set', 'true')
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co')
  const fetchMock = stubFetch({ bitcoin: { usd: 1 } })
  await fetchCryptoQuotes(['bitcoin'])
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('https://abc.supabase.co/functions/v1/market-proxy')
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt-1')
  const sent = JSON.parse(String(init.body))
  expect(sent).toEqual({ provider: 'coingecko', path: 'simple/price', params: expect.objectContaining({ ids: 'bitcoin' }) })
  expect(JSON.stringify(sent)).not.toMatch(/x_cg_demo_api_key|CG-/)
  localStorage.removeItem('mne_coingecko_key_set')
})

test('fetchCryptoQuotes skips the network for an empty id list and throws on a failed response', async () => {
  const fetchMock = stubFetch({})
  expect((await fetchCryptoQuotes([])).size).toBe(0)
  expect(fetchMock).not.toHaveBeenCalled()

  stubFetch({}, false)
  await expect(fetchCryptoQuotes(['bitcoin'])).rejects.toThrow(/keyless rate limit/)
})

test('pickCoinForSymbol prefers the best market-cap rank among exact symbol matches', () => {
  const coin = pickCoinForSymbol('btc', [
    { id: 'wrapped-btc-fake', name: 'Fake BTC', symbol: 'btc', market_cap_rank: null },
    { id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', market_cap_rank: 1, large: 'https://img/btc.png' },
    { id: 'bitcoin-cash', name: 'Bitcoin Cash', symbol: 'bch', market_cap_rank: 20 },
  ])
  expect(coin).toEqual({ id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', logo: 'https://img/btc.png' })
})

test('pickCoinForSymbol returns null when no coin matches the symbol exactly', () => {
  expect(pickCoinForSymbol('btc', [{ id: 'bitcoin-cash', symbol: 'bch' }])).toBeNull()
  expect(pickCoinForSymbol('  ', [{ id: 'bitcoin', symbol: 'btc' }])).toBeNull()
})

test('searchCoinBySymbol resolves a symbol through the search endpoint', async () => {
  const fetchMock = stubFetch({ coins: [{ id: 'ethereum', name: 'Ethereum', symbol: 'ETH', market_cap_rank: 2 }] })
  const coin = await searchCoinBySymbol('eth')
  expect(String(fetchMock.mock.calls[0][0])).toContain('/search?query=eth')
  expect(coin?.id).toBe('ethereum')
})

test('fetchCoinDailyHistory dedupes to one close per UTC day', async () => {
  stubFetch({
    prices: [
      [Date.UTC(2026, 0, 1, 0, 0), 100],
      [Date.UTC(2026, 0, 1, 23, 0), 105],
      [Date.UTC(2026, 0, 2, 0, 0), 110],
      [Date.UTC(2026, 0, 3, 0, 0), -5],
    ],
  })
  const history = await fetchCoinDailyHistory('bitcoin')
  expect(history).toEqual([
    { date: '2026-01-01', price: 105 },
    { date: '2026-01-02', price: 110 },
  ])
})

test('filterNewsForCoin matches by coin name or standalone ticker only', () => {
  const news = [
    { headline: 'Bitcoin climbs past $70k' },
    { headline: 'Analyst says BTC could retest highs' },
    { headline: 'Banks eye ethereum ETFs', summary: '' },
    { headline: 'A new method for testing', summary: 'nothing about eth here' },
    { headline: 'Stocks rally on earnings' },
  ]
  expect(filterNewsForCoin(news, 'BTC', 'bitcoin').map(n => n.headline)).toEqual([
    'Bitcoin climbs past $70k',
    'Analyst says BTC could retest highs',
  ])
  // "ETH" must not match inside "method"; lowercase "eth" isn't a ticker mention either
  expect(filterNewsForCoin(news, 'ETH', 'ethereum').map(n => n.headline)).toEqual(['Banks eye ethereum ETFs'])
})

test('CoinGeckoError tells a keyless user to add a key, and a keyed user to wait', () => {
  const keyless = new CoinGeckoError(429, false)
  expect(keyless.rateLimited).toBe(true)
  expect(keyless.message).toMatch(/Settings/)
  const keyed = new CoinGeckoError(429, true)
  expect(keyed.message).toMatch(/wait a minute/)
  expect(keyed.message).not.toMatch(/Add a free CoinGecko key/)
})

test('CoinGeckoError flags a rejected key only when one was sent', () => {
  expect(new CoinGeckoError(401, true).message).toMatch(/rejected your API key/)
  expect(new CoinGeckoError(403, false).message).toBe('CoinGecko request failed (403).')
})
