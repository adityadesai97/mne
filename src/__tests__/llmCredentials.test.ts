import { test, expect, vi, beforeEach } from 'vitest'
import { config } from '@/store/config'

// A tiny in-memory stand-in for the three tables involved, recording which
// calls were made so the write-only rules can be asserted.
type Row = Record<string, any>
const tables: Record<string, Row[]> = {}
const calls: string[] = []
let failSecretWrites = false

// What the real database does for a table with RLS on and no select policy:
// an UPDATE ... WHERE user_id = ... sees no rows and silently changes nothing,
// and an INSERT of an existing primary key is a duplicate-key error.
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
    if (table === 'llm_credential_secrets' && failSecretWrites && (op === 'update' || op === 'insert')) {
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

// The save_llm_key SQL function: writes the key and flag together, upserting.
function rpc(name: string, args: any) {
  calls.push(`rpc.${name}`)
  if (name !== 'save_llm_key') return Promise.resolve({ data: null, error: new Error('unknown function') })
  if (failSecretWrites) return Promise.resolve({ data: null, error: new Error('permission denied') })
  const creds = (tables.llm_credentials ??= [])
  const secrets = (tables.llm_credential_secrets ??= [])
  const c = creds.find(r => r.user_id === 'u1')
  if (c) c.secret_set = true; else creds.push({ user_id: 'u1', secret_set: true })
  const sec = secrets.find(r => r.user_id === 'u1')
  if (sec) sec.api_key = String(args.p_key).trim(); else secrets.push({ user_id: 'u1', api_key: String(args.p_key).trim() })
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

import { saveLlmKey, migrateLegacyClaudeKey } from '@/lib/db/llmCredentials'

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  calls.length = 0
  failSecretWrites = false
  localStorage.clear()
})

test('saving goes through the save_llm_key function and flags the key', async () => {
  await saveLlmKey('  sk-ant-new  ')
  expect(calls).toContain('rpc.save_llm_key')
  expect(calls).not.toContain('llm_credential_secrets.upsert')
  expect(tables.llm_credential_secrets[0].api_key).toBe('sk-ant-new')
  expect(tables.llm_credentials[0].secret_set).toBe(true)
  expect(config.llmKeySet).toBe(true)
})

test('replacing an existing key works (regression: duplicate key on llm_credential_secrets_pkey)', async () => {
  await saveLlmKey('sk-ant-1')
  await saveLlmKey('sk-ant-2')
  expect(tables.llm_credential_secrets).toHaveLength(1)
  expect(tables.llm_credential_secrets[0].api_key).toBe('sk-ant-2')
})

test('an empty key is rejected and nothing is written', async () => {
  await expect(saveLlmKey('   ')).rejects.toThrow(/Enter a Claude API key/)
  expect(calls).toHaveLength(0)
})

test('a failed secret write never claims the key is saved', async () => {
  failSecretWrites = true
  await expect(saveLlmKey('sk-ant-x')).rejects.toThrow()
  expect(config.llmKeySet).toBe(false)
  expect(tables.llm_credentials?.[0]?.secret_set).not.toBe(true)
})

test('migration moves a browser-held key to the server, then clears the local copy', async () => {
  localStorage.setItem('mne_claude_api_key', 'sk-ant-old')
  await migrateLegacyClaudeKey()
  expect(tables.llm_credential_secrets[0].api_key).toBe('sk-ant-old')
  expect(config.legacyClaudeApiKey).toBe('')
  expect(config.llmKeySet).toBe(true)
})

test('migration keeps the old copies when the server write fails, so nothing is lost', async () => {
  localStorage.setItem('mne_claude_api_key', 'sk-ant-old')
  failSecretWrites = true
  await expect(migrateLegacyClaudeKey()).rejects.toThrow()
  expect(config.legacyClaudeApiKey).toBe('sk-ant-old')
})

test('migration does nothing when there is no legacy key', async () => {
  await migrateLegacyClaudeKey()
  expect(calls.filter(c => c.startsWith('llm_credential'))).toHaveLength(0)
})
