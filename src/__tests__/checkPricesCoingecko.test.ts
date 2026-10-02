import { COINGECKO_ID_CHUNK, derivePreviousClose, fetchCryptoQuotes } from '../../supabase/functions/check-prices/coingecko'

afterEach(() => {
  vi.unstubAllGlobals()
})

function res(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } }
}
const noSleep = vi.fn().mockResolvedValue(undefined)

test('quotes come back with a previous close derived from the 24h change', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { bitcoin: { usd: 60000, usd_24h_change: 20 }, ethereum: { usd: 3000 } })))
  const quotes = await fetchCryptoQuotes(['bitcoin', 'ethereum', 'ghost-coin'], undefined, { sleep: noSleep })
  expect(quotes.get('bitcoin')?.price).toBe(60000)
  expect(quotes.get('bitcoin')?.previousClose).toBeCloseTo(50000)
  expect(quotes.get('ethereum')?.previousClose).toBeNull()
  expect(quotes.has('ghost-coin')).toBe(false)
})

test('every user\'s coins go out de-duplicated in as few requests as possible, in chunks', async () => {
  const fetchMock = vi.fn().mockResolvedValue(res(200, {}))
  vi.stubGlobal('fetch', fetchMock)
  // 250 distinct ids, listed twice (as if held by two users) -> 3 chunks, not 500 calls
  const ids = Array.from({ length: 250 }, (_, i) => `coin-${i}`)
  await fetchCryptoQuotes([...ids, ...ids], undefined, { sleep: noSleep })
  expect(fetchMock).toHaveBeenCalledTimes(Math.ceil(250 / COINGECKO_ID_CHUNK))
  const firstIds = decodeURIComponent(String(fetchMock.mock.calls[0][0])).match(/ids=([^&]+)/)![1].split(',')
  expect(firstIds).toHaveLength(COINGECKO_ID_CHUNK)
  expect(new Set(firstIds).size).toBe(COINGECKO_ID_CHUNK)
})

test('no ids means no request', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  expect((await fetchCryptoQuotes([], 'key', { sleep: noSleep })).size).toBe(0)
  expect(fetchMock).not.toHaveBeenCalled()
})

test('the key is sent as a query param only when there is one', async () => {
  const fetchMock = vi.fn().mockResolvedValue(res(200, {}))
  vi.stubGlobal('fetch', fetchMock)
  await fetchCryptoQuotes(['bitcoin'], 'CG-secret', { sleep: noSleep })
  await fetchCryptoQuotes(['bitcoin'], undefined, { sleep: noSleep })
  expect(String(fetchMock.mock.calls[0][0])).toContain('x_cg_demo_api_key=CG-secret')
  expect(String(fetchMock.mock.calls[1][0])).not.toContain('x_cg_demo_api_key')
})

test('a 429 is retried once after a wait, honoring a small Retry-After, and then succeeds', async () => {
  const sleep = vi.fn().mockResolvedValue(undefined)
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(res(429, {}, { 'retry-after': '3' }))
    .mockResolvedValueOnce(res(200, { bitcoin: { usd: 1 } }))
  vi.stubGlobal('fetch', fetchMock)
  const quotes = await fetchCryptoQuotes(['bitcoin'], undefined, { sleep })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(sleep).toHaveBeenCalledWith(3000)
  expect(quotes.get('bitcoin')?.price).toBe(1)
})

test('a huge Retry-After is capped, and the default wait applies without one', async () => {
  const sleep = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(res(429, {}, { 'retry-after': '120' })).mockResolvedValueOnce(res(200, {}))
    .mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200, {})))
  await fetchCryptoQuotes(['a'], undefined, { sleep })
  await fetchCryptoQuotes(['b'], undefined, { sleep })
  expect(sleep.mock.calls[0][0]).toBe(5000)
  expect(sleep.mock.calls[1][0]).toBe(2000)
})

test('a chunk that stays rate limited is skipped without aborting the others or throwing', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const ids = Array.from({ length: COINGECKO_ID_CHUNK + 1 }, (_, i) => `coin-${i}`)
  // chunk 1: 429 then 429 again -> skipped; chunk 2: ok
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(429))
    .mockResolvedValueOnce(res(200, { [`coin-${COINGECKO_ID_CHUNK}`]: { usd: 5 } })))
  const quotes = await fetchCryptoQuotes(ids, undefined, { sleep: noSleep })
  expect([...quotes.keys()]).toEqual([`coin-${COINGECKO_ID_CHUNK}`])
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})

test('a network error is swallowed (best effort) and other failures do not retry', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(res(500))
  vi.stubGlobal('fetch', fetchMock)
  expect((await fetchCryptoQuotes(['a'], undefined, { sleep: noSleep })).size).toBe(0)
  expect((await fetchCryptoQuotes(['b'], undefined, { sleep: noSleep })).size).toBe(0)
  expect(fetchMock).toHaveBeenCalledTimes(2) // no retry on a thrown error or a 500
  warn.mockRestore()
})

test('derivePreviousClose rejects unusable input', () => {
  expect(derivePreviousClose(110, 10)).toBeCloseTo(100)
  expect(derivePreviousClose(100, -100)).toBeNull()
  expect(derivePreviousClose(100, 'x')).toBeNull()
})
