import { test, expect, vi, beforeEach } from 'vitest'
import { config } from '@/store/config'

// A tiny in-memory stand-in for the three tables involved, recording which
// calls were made so the write-only rules can be asserted.
type Row = Record<string, any>
const tables: Record<string, Row[]> = {}
const calls: string[] = []
let failSecretWrites = false

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
    if (op === 'insert') { rows.push({ ...patch }); return { data: null, error: null } }
    if (op === 'update') {
      const hit = rows.filter(r => r.user_id === filterUser)
      hit.forEach(r => Object.assign(r, patch))
      return { data: null, error: null, ...(wantCount ? { count: hit.length } : {}) }
    }
    const hit = rows.filter(r => r.user_id === filterUser || filterUser === null)
    return { data: single ? (hit[0] ?? null) : hit, error: null }
  }
  return q
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => makeQuery(t),
  }),
}))
vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => makeQuery(t),
  }),
}))

import { saveLlmKey, migrateLegacyClaudeKey } from '@/lib/db/llmCredentials'

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  calls.length = 0
  failSecretWrites = false
  localStorage.clear()
})

test('saving writes the secret with update-then-insert, never an upsert, and flags it', async () => {
  await saveLlmKey('  sk-ant-new  ')
  expect(calls).not.toContain('llm_credential_secrets.upsert')
  expect(calls).toContain('llm_credential_secrets.update')
  expect(calls).toContain('llm_credential_secrets.insert')
  expect(tables.llm_credential_secrets[0].api_key).toBe('sk-ant-new')
  expect(tables.llm_credentials[0].secret_set).toBe(true)
  expect(config.llmKeySet).toBe(true)
})

test('rotating an existing key updates it in place instead of inserting again', async () => {
  await saveLlmKey('sk-ant-1')
  calls.length = 0
  await saveLlmKey('sk-ant-2')
  expect(calls).not.toContain('llm_credential_secrets.insert')
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

test('migration moves a browser-held key to the server, then clears both old copies', async () => {
  localStorage.setItem('mne_claude_api_key', 'sk-ant-old')
  tables.user_settings = [{ user_id: 'u1', claude_api_key: 'sk-ant-old' }]
  await migrateLegacyClaudeKey()
  expect(tables.llm_credential_secrets[0].api_key).toBe('sk-ant-old')
  expect(config.legacyClaudeApiKey).toBe('')
  expect(tables.user_settings[0].claude_api_key).toBeNull()
  expect(config.llmKeySet).toBe(true)
})

test('migration also picks up a key that only exists in user_settings (new device)', async () => {
  tables.user_settings = [{ user_id: 'u1', claude_api_key: 'sk-ant-db' }]
  await migrateLegacyClaudeKey()
  expect(tables.llm_credential_secrets[0].api_key).toBe('sk-ant-db')
  expect(tables.user_settings[0].claude_api_key).toBeNull()
})

test('migration keeps the old copies when the server write fails, so nothing is lost', async () => {
  localStorage.setItem('mne_claude_api_key', 'sk-ant-old')
  tables.user_settings = [{ user_id: 'u1', claude_api_key: 'sk-ant-old' }]
  failSecretWrites = true
  await expect(migrateLegacyClaudeKey()).rejects.toThrow()
  expect(config.legacyClaudeApiKey).toBe('sk-ant-old')
  expect(tables.user_settings[0].claude_api_key).toBe('sk-ant-old')
})

test('migration does nothing when there is no legacy key', async () => {
  tables.user_settings = [{ user_id: 'u1', claude_api_key: null }]
  await migrateLegacyClaudeKey()
  expect(calls.filter(c => c.startsWith('llm_credential'))).toHaveLength(0)
})
