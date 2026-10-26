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

test('option grants and exercises are private to their owner', async () => {
  const sub = await db.query<{ id: string }>(
    `with a as (insert into public.assets (user_id, name, asset_type) values ($1, 'ACME', 'Stock') returning id)
     insert into public.stock_subtypes (asset_id, subtype) select id, 'ESOP' from a returning id`, [alice])
  const subtypeId = sub.rows[0].id
  const grant = await asUser(db, alice, q => q(
    `insert into public.esop_grants (subtype_id, grant_date, total_options, strike_price, vest_start, vest_end)
     values ($1, '2024-01-01', 100, 5, '2024-01-01', '2027-01-01') returning id`, [subtypeId]))
  const grantId = grant.rows[0].id
  await asUser(db, alice, q => q(
    `insert into public.esop_exercises (grant_id, exercise_date, count, strike_price, cost_price)
     values ($1, '2025-01-01', 10, 5, 20)`, [grantId]))

  expect((await asUser(db, alice, q => q('select 1 from public.esop_grants'))).rows).toHaveLength(1)
  expect((await asUser(db, bob, q => q('select 1 from public.esop_grants'))).rows).toHaveLength(0)
  expect((await asUser(db, bob, q => q('select 1 from public.esop_exercises'))).rows).toHaveLength(0)
  await expect(asUser(db, bob, q => q(
    `insert into public.esop_grants (subtype_id, grant_date, total_options, strike_price, vest_start, vest_end)
     values ($1, '2024-01-01', 1, 1, '2024-01-01', '2025-01-01')`, [subtypeId]))).rejects.toThrow()
  await expect(asUser(db, bob, q => q(
    `insert into public.esop_exercises (grant_id, exercise_date, count, strike_price, cost_price)
     values ($1, '2025-01-01', 1, 1, 1)`, [grantId]))).rejects.toThrow()
})

test('option contracts and a private company price are private to their owner', async () => {
  const asset = await db.query<{ id: string }>(
    "insert into public.assets (user_id, name, asset_type, manual_price) values ($1, 'Acme', 'Stock', 10) returning id", [alice])
  const assetId = asset.rows[0].id
  await asUser(db, alice, q => q(
    `insert into public.option_contracts (asset_id, option_type, strike_price, expiry_date, contracts, premium_per_share, purchase_date)
     values ($1, 'call', 10, '2030-01-01', 1, 1, '2026-01-01')`, [assetId]))
  expect((await asUser(db, alice, q => q('select 1 from public.option_contracts'))).rows).toHaveLength(1)
  expect((await asUser(db, bob, q => q('select 1 from public.option_contracts'))).rows).toHaveLength(0)
  await expect(asUser(db, bob, q => q(
    `insert into public.option_contracts (asset_id, option_type, strike_price, expiry_date, contracts, premium_per_share, purchase_date)
     values ($1, 'put', 10, '2030-01-01', 1, 1, '2026-01-01')`, [assetId]))).rejects.toThrow()
  await expect(db.query(
    `insert into public.option_contracts (asset_id, option_type, strike_price, expiry_date, contracts, premium_per_share, purchase_date)
     values ($1, 'straddle', 10, '2030-01-01', 1, 1, '2026-01-01')`, [assetId])).rejects.toThrow()
})

test('delete_my_data wipes only the caller\'s portfolio rows and keeps their keys', async () => {
  const carol = await createUser(db, 'carol@example.com')
  await asUser(db, carol, q => q("insert into public.locations (user_id, name, account_type) values (auth.uid(), 'Carol Bank', 'Bank')"))
  await asUser(db, carol, q => q("select public.save_llm_key('sk-ant-carol')"))
  await asUser(db, carol, q => q('select public.delete_my_data()'))
  expect((await asUser(db, carol, q => q('select 1 from public.locations'))).rows).toHaveLength(0)
  expect((await asUser(db, carol, q => q('select secret_set from public.llm_credentials'))).rows).toHaveLength(1)
  expect((await asUser(db, bob, q => q('select 1 from public.locations'))).rows).toHaveLength(1)
})
