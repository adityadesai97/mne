import { test, expect, vi, beforeEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => ({ rpc }) }))

import { savePlaidCredentials } from '@/lib/db/plaid'

beforeEach(() => rpc.mockReset())

test('saving Plaid credentials goes through save_plaid_credentials', async () => {
  rpc.mockResolvedValue({ error: null })
  await savePlaidCredentials('cid', 'production', 'secret')
  expect(rpc).toHaveBeenCalledWith('save_plaid_credentials', { p_client_id: 'cid', p_env: 'production', p_secret: 'secret' })
})

test('a blank secret leaves the saved one in place (not sent)', async () => {
  rpc.mockResolvedValue({ error: null })
  await savePlaidCredentials('cid', 'sandbox', '')
  expect(rpc).toHaveBeenCalledWith('save_plaid_credentials', { p_client_id: 'cid', p_env: 'sandbox', p_secret: undefined })
})

test('a database error is thrown so the UI can show it', async () => {
  rpc.mockResolvedValue({ error: new Error('Not authenticated') })
  await expect(savePlaidCredentials('cid', 'production', 'secret')).rejects.toThrow('Not authenticated')
})

// Browser code must never write a no-select-policy secrets table directly:
// an upsert 403s (and signs the user out) and update-then-insert fails on the
// second save. Writes go through the save_* SQL functions.
test('no browser code touches a write-only secrets table directly', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { if (name !== '__tests__') walk(full) } else if (/\.(ts|tsx)$/.test(name)) files.push(full)
    }
  }
  walk(join(process.cwd(), 'src'))
  const offenders = files.filter(f => /\.from\(\s*['"](llm_credential_secrets|market_credential_secrets|plaid_credential_secrets|plaid_item_secrets)['"]/.test(readFileSync(f, 'utf8')))
  expect(offenders).toEqual([])
})
