// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, bootstrappedDb, createUser } from './testDb'

let db: PGlite
let alice: string
let bob: string

beforeAll(async () => {
  db = await bootstrappedDb()
  alice = await createUser(db, 'alice@example.com')
  bob = await createUser(db, 'bob@example.com')
}, 60_000)

afterAll(async () => { await db.close() })

test('a user sees only their own rows', async () => {
  await asUser(db, alice, q => q("insert into public.locations (user_id, name, account_type) values (auth.uid(), 'Alice Bank', 'Bank')"))
  await asUser(db, bob, q => q("insert into public.locations (user_id, name, account_type) values (auth.uid(), 'Bob Bank', 'Bank')"))
  const aliceSees = await asUser(db, alice, q => q('select name from public.locations'))
  expect(aliceSees.rows.map(r => r.name)).toEqual(['Alice Bank'])
})

test('a user cannot insert a row owned by someone else', async () => {
  await expect(asUser(db, alice, q =>
    q("insert into public.locations (user_id, name, account_type) values ($1, 'Sneaky', 'Bank')", [bob]),
  )).rejects.toThrow()
})

test('credential secret tables cannot be read by a signed-in user', async () => {
  await asUser(db, alice, q => q("select public.save_llm_key('sk-ant-alice')"))
  await asUser(db, alice, q => q("select public.save_market_keys('fh-alice', 'cg-alice')"))
  for (const table of ['llm_credential_secrets', 'market_credential_secrets', 'plaid_credential_secrets', 'plaid_item_secrets']) {
    let rows = 0
    try {
      rows = (await asUser(db, alice, q => q(`select * from public.${table}`))).rows.length
    } catch { /* permission denied is also a pass */ }
    expect(rows, table).toBe(0)
  }
})

test('save_llm_key can replace a key repeatedly (regression: duplicate key error)', async () => {
  await asUser(db, alice, q => q("select public.save_llm_key('first')"))
  await asUser(db, alice, q => q("select public.save_llm_key('second')"))
  const flag = await asUser(db, alice, q => q('select secret_set from public.llm_credentials'))
  expect(flag.rows).toEqual([{ secret_set: true }])
  const stored = await db.query<{ api_key: string }>('select api_key from public.llm_credential_secrets where user_id = $1', [alice])
  expect(stored.rows).toEqual([{ api_key: 'second' }])
})

test('save_market_keys keeps the other key when only one is given', async () => {
  await asUser(db, bob, q => q("select public.save_market_keys('fh-1', 'cg-1')"))
  await asUser(db, bob, q => q("select public.save_market_keys('fh-2', null)"))
  const stored = await db.query<any>('select finnhub_api_key, coingecko_api_key from public.market_credential_secrets where user_id = $1', [bob])
  expect(stored.rows).toEqual([{ finnhub_api_key: 'fh-2', coingecko_api_key: 'cg-1' }])
})

test('save functions reject a caller with no session', async () => {
  await expect(db.transaction(async tx => {
    await tx.exec('set local role authenticated')
    await tx.query("select public.save_llm_key('x')")
  })).rejects.toThrow(/Not authenticated/)
})

test('anon cannot call the save functions', async () => {
  await expect(db.transaction(async tx => {
    await tx.exec('set local role anon')
    await tx.query("select public.save_llm_key('x')")
  })).rejects.toThrow()
})
