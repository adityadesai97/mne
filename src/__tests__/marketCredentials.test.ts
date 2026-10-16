import { test, expect, vi, beforeEach } from 'vitest'
import { config } from '@/store/config'

// A tiny in-memory stand-in for the three tables involved, recording which
// calls were made so the write-only rules can be asserted.
type Row = Record<string, any>
const tables: Record<string, Row[]> = {}
const calls: string[] = []
let failSecretWrites = false

const NO_SELECT = new Set(['llm_credential_secrets', 'market_credential_secrets'])

function makeQuery(table: string) {
  let filterUser: string | null = null
  let op: 'select' | 'update' | 'insert' | 'upsert' | null = null
  let patch: Row = {}
  let wantCount = false
  const q: any = {
    select() { op = op ?? 'select'; return q },
    eq(_col: string, v: string) { filterUser = v; return q },
    upsert(row: Row) { calls.push(`${table}.upsert`); op = 'upsert'; patch = row; return q },
    update(p: Row, opts?: { count?: string }) { calls.push(`${table}.update`); op = 'update'; patch = p; wantCount = !!opts?.count; return q },
    insert(row: Row) { calls.push(`${table}.insert`); op = 'insert'; patch = row; return q },
    maybeSingle() { return Promise.resolve(run(true)) },
    then(res: any, rej: any) { return Promise.resolve(run(false)).then(res, rej) },
  }
  function run(single: boolean) {
    const rows = (tables[table] ??= [])
    if (table === 'market_credential_secrets' && failSecretWrites && (op === 'update' || op === 'insert')) {
      return { data: null, error: new Error('permission denied'), count: 0 }
    }
    if (op === 'upsert') {
      const i = rows.findIndex(r => r.user_id === patch.user_id)
      if (i >= 0) rows[i] = { ...rows[i], ...patch }; else rows.push({ ...patch })
      return { data: null, error: null }
    }
    if (op === 'insert') {
      if (rows.some(r => r.user_id === patch.user_id)) {
        return { data: null, error: new Error(`duplicate key value violates unique constraint "${table}_pkey"`), count: 0 }
      }
      rows.push({ ...patch }); return { data: null, error: null }
    }
    if (op === 'update') {
      const hit = NO_SELECT.has(table) ? [] : rows.filter(r => r.user_id === filterUser)
      hit.forEach(r => Object.assign(r, patch))
      return { data: null, error: null, ...(wantCount ? { count: hit.length } : {}) }
    }
    const hit = rows.filter(r => r.user_id === filterUser || filterUser === null)
    return { data: single ? (hit[0] ?? null) : hit, error: null }
  }
  return q
}

// The save_market_keys SQL function: upserts, keeping a key the call leaves null.
function rpc(name: string, args: any) {
  calls.push(`rpc.${name}`)
  if (name !== 'save_market_keys') return Promise.resolve({ data: null, error: new Error('unknown function') })
  if (failSecretWrites) return Promise.resolve({ data: null, error: new Error('permission denied') })
  const creds = (tables.market_credentials ??= [])
  const secrets = (tables.market_credential_secrets ??= [])
  const c = creds.find(r => r.user_id === 'u1') ?? (creds.push({ user_id: 'u1', finnhub_set: false, coingecko_set: false }), creds[creds.length - 1])
  const sec = secrets.find(r => r.user_id === 'u1') ?? (secrets.push({ user_id: 'u1' }), secrets[secrets.length - 1])
  if (args.p_finnhub) { sec.finnhub_api_key = args.p_finnhub; c.finnhub_set = true }
  if (args.p_coingecko) { sec.coingecko_api_key = args.p_coingecko; c.coingecko_set = true }
  return Promise.resolve({ data: null, error: null })
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => makeQuery(t),
    rpc: (name: string, args: any) => rpc(name, args),
  }),
}))
vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => makeQuery(t),
    rpc: (name: string, args: any) => rpc(name, args),
  }),
}))

import { saveMarketKeys, migrateLegacyMarketKeys } from '@/lib/db/marketCredentials'

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  calls.length = 0
  failSecretWrites = false
  localStorage.clear()
})

test('saving goes through save_market_keys and flags both keys', async () => {
  await saveMarketKeys({ finnhubApiKey: ' fh-1 ', coingeckoApiKey: 'CG-1' })
  expect(calls).toContain('rpc.save_market_keys')
  expect(tables.market_credential_secrets[0]).toMatchObject({ finnhub_api_key: 'fh-1', coingecko_api_key: 'CG-1' })
  expect(tables.market_credentials[0]).toMatchObject({ finnhub_set: true, coingecko_set: true })
  expect(config.finnhubKeySet).toBe(true)
  expect(config.coingeckoKeySet).toBe(true)
})

test('replacing a saved key works and leaves the other key alone', async () => {
  await saveMarketKeys({ finnhubApiKey: 'fh-1', coingeckoApiKey: 'CG-1' })
  await saveMarketKeys({ finnhubApiKey: 'fh-2' })
  expect(tables.market_credential_secrets).toHaveLength(1)
  expect(tables.market_credential_secrets[0]).toMatchObject({ finnhub_api_key: 'fh-2', coingecko_api_key: 'CG-1' })
})

test('saving only Finnhub leaves CoinGecko untouched', async () => {
  await saveMarketKeys({ finnhubApiKey: 'fh-1' })
  expect(tables.market_credential_secrets[0].coingecko_api_key).toBeUndefined()
  expect(config.coingeckoKeySet).toBe(false)
})

test('blank keys write nothing', async () => {
  await saveMarketKeys({ finnhubApiKey: '  ', coingeckoApiKey: '' })
  expect(calls).toHaveLength(0)
})

test('a failed secret write never claims the key is saved', async () => {
  failSecretWrites = true
  await expect(saveMarketKeys({ finnhubApiKey: 'fh-1' })).rejects.toThrow()
  expect(config.finnhubKeySet).toBe(false)
})

test('migration moves browser-held keys to the server and clears the local copies', async () => {
  localStorage.setItem('mne_finnhub_api_key', 'fh-old')
  localStorage.setItem('mne_coingecko_api_key', 'CG-old')
  await migrateLegacyMarketKeys()
  expect(tables.market_credential_secrets[0]).toMatchObject({ finnhub_api_key: 'fh-old', coingecko_api_key: 'CG-old' })
  expect(config.legacyFinnhubApiKey).toBe('')
  expect(config.legacyCoingeckoApiKey).toBe('')
})

test('migration never overwrites a key already saved on the server', async () => {
  localStorage.setItem('mne_finnhub_api_key', 'fh-old')
  tables.market_credentials = [{ user_id: 'u1', finnhub_set: true, coingecko_set: false }]
  tables.market_credential_secrets = [{ user_id: 'u1', finnhub_api_key: 'fh-new' }]
  await migrateLegacyMarketKeys()
  expect(tables.market_credential_secrets[0].finnhub_api_key).toBe('fh-new')
  expect(config.legacyFinnhubApiKey).toBe('')
})

test('migration keeps the old copies when the server write fails', async () => {
  localStorage.setItem('mne_finnhub_api_key', 'fh-old')
  failSecretWrites = true
  await expect(migrateLegacyMarketKeys()).rejects.toThrow()
  expect(config.legacyFinnhubApiKey).toBe('fh-old')
})

test('migration does nothing without legacy keys', async () => {
  await migrateLegacyMarketKeys()
  expect(calls.filter(c => c.startsWith('market_credential'))).toHaveLength(0)
})
