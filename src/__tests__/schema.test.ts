import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Every asset_type the app can create. assets_asset_type_check is a DB-side
// allowlist, so adding a type in app code without widening it fails at insert
// time in production (this is how Crypto first shipped broken) — this test
// makes that a CI failure instead.
const APP_ASSET_TYPES = ['Stock', 'Crypto', '401k', 'Fixed Income', 'Cash', 'HSA']

function allowlist(sql: string): string[] | null {
  const matches = [...sql.matchAll(/assets_asset_type_check\s+check\s*\(\s*asset_type\s+in\s*\(([^)]*)\)\s*\)/gi)]
  if (matches.length === 0) return null
  // Last definition wins, same as running the file top to bottom.
  return [...matches[matches.length - 1][1].matchAll(/'([^']+)'/g)].map(m => m[1])
}

test('self_host_bootstrap.sql allows every asset type the app creates', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/sql/self_host_bootstrap.sql'), 'utf8')
  const allowed = allowlist(sql)
  expect(allowed).not.toBeNull()
  for (const type of APP_ASSET_TYPES) expect(allowed).toContain(type)
})

test('the newest migration touching assets_asset_type_check allows every asset type the app creates', () => {
  const dir = join(process.cwd(), 'supabase/migrations')
  const latest = readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => ({ f, allowed: allowlist(readFileSync(join(dir, f), 'utf8')) }))
    .filter(x => x.allowed !== null)
    .pop()
  expect(latest).toBeDefined()
  for (const type of APP_ASSET_TYPES) expect(latest!.allowed).toContain(type)
})

// locations_account_type_check exists only on hosted projects (not in the
// bootstrap), so only the newest migration touching it is checked.
test('the newest migration touching locations_account_type_check allows Crypto and the other account types', () => {
  const dir = join(process.cwd(), 'supabase/migrations')
  const latest = readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => readFileSync(join(dir, f), 'utf8'))
    .filter(sql => /locations_account_type_check/i.test(sql) && /check\s*\(\s*account_type\s+in/i.test(sql))
    .pop()
  expect(latest).toBeDefined()
  for (const type of ['Investment', 'Checking', 'Savings', 'Misc', 'Crypto']) expect(latest).toContain(`'${type}'`)
})
