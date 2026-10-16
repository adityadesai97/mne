// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { bootstrappedDb, createUser } from './testDb'
import { computeAssetValue, computeTotalNetWorth } from '../../lib/portfolio'

let db: PGlite
let full: string, noPrice: string, empty: string, zero: string, existing: string

const D = '2026-10-16'

async function one(sql: string, params: unknown[] = []): Promise<string> {
  const { rows } = await db.query<{ id: string }>(sql, params)
  return rows[0].id
}
const ticker = (u: string, sym: string, price: number | null, kind = 'stock') =>
  one('insert into public.tickers (user_id, symbol, current_price, kind) values ($1,$2,$3,$4) returning id', [u, sym, price, kind])
const asset = (u: string, name: string, type: string, o: { price?: number; ticker?: string; fi?: string } = {}) =>
  one('insert into public.assets (user_id, name, asset_type, price, ticker_id, fixed_income_subtype) values ($1,$2,$3,$4,$5,$6) returning id',
    [u, name, type, o.price ?? null, o.ticker ?? null, o.fi ?? null])
async function lot(assetId: string, subtype: string, count: number, cost: number, sold = 0) {
  const ss = await db.query<{ id: string }>(
    `insert into public.stock_subtypes (asset_id, subtype) values ($1,$2)
     on conflict (asset_id, subtype) do update set subtype = excluded.subtype returning id`, [assetId, subtype])
  await db.query('insert into public.transactions (subtype_id, count, cost_price, purchase_date, sold_at_vest) values ($1,$2,$3,$4,$5)',
    [ss.rows[0].id, count, cost, '2025-01-01', sold])
}
const bondLot = (assetId: string, count: number, cost: number) =>
  db.query('insert into public.fixed_income_lots (asset_id, count, cost_price, purchase_date) values ($1,$2,$3,$4)', [assetId, count, cost, '2025-02-01'])
const snapshots = async (u: string) =>
  (await db.query<{ date: string; value: string }>('select date::text, value::text from public.net_worth_snapshots where user_id = $1 order by date', [u])).rows

// Equivalent in-memory assets for the TS valuation
const expectedAssets = [
  { asset_type: 'Stock', price: null, ticker: { current_price: 123.4567 }, fixed_income_subtype: null,
    stock_subtypes: [
      { transactions: [{ count: 10.5, cost_price: 50 }], rsu_grants: [] },
      { transactions: [{ count: 20, cost_price: 0, sold_at_vest: 7.25 }], rsu_grants: [] },
    ] },
  { asset_type: 'Crypto', price: null, ticker: { current_price: 64321.12345678 }, fixed_income_subtype: null,
    stock_subtypes: [{ transactions: [{ count: 0.12345678, cost_price: 30000 }], rsu_grants: [] }] },
  { asset_type: 'Cash', price: 2500.55, ticker: null, stock_subtypes: [] },
  { asset_type: '401k', price: 80000.1, ticker: null, stock_subtypes: [] },
  { asset_type: 'Fixed Income', fixed_income_subtype: 'Bond', price: null, ticker: null, stock_subtypes: [],
    fixed_income_lots: [{ count: 3, cost_price: 987.5333, purchase_date: '2025-02-01' }, { count: 2, cost_price: 990, purchase_date: '2025-02-01' }] },
  { asset_type: 'Fixed Income', fixed_income_subtype: 'CD', price: 5000, ticker: null, stock_subtypes: [] },
] as any[]

beforeAll(async () => {
  db = await bootstrappedDb()
  full = await createUser(db, 'full@example.com')
  noPrice = await createUser(db, 'noprice@example.com')
  empty = await createUser(db, 'empty@example.com')
  zero = await createUser(db, 'zero@example.com')
  existing = await createUser(db, 'existing@example.com')

  const seedFull = async (u: string) => {
    const aapl = await ticker(u, 'AAPL', 123.4567)
    const stock = await asset(u, 'Brokerage AAPL', 'Stock', { ticker: aapl })
    await lot(stock, 'Market', 10.5, 50)
    await lot(stock, 'RSU', 20, 0, 7.25)
    const btc = await ticker(u, 'BTC', 64321.12345678, 'crypto')
    const crypto = await asset(u, 'Coinbase BTC', 'Crypto', { ticker: btc })
    await lot(crypto, 'Market', 0.12345678, 30000)
    await asset(u, 'Checking', 'Cash', { price: 2500.55 })
    await asset(u, '401k', '401k', { price: 80000.1 })
    const bond = await asset(u, 'Bond', 'Fixed Income', { fi: 'Bond' })
    await bondLot(bond, 3, 987.5333)
    await bondLot(bond, 2, 990)
    await asset(u, 'CD', 'Fixed Income', { price: 5000, fi: 'CD' })
  }
  await seedFull(full)
  await seedFull(existing)

  // one ticker without a price: the whole user is skipped
  const nvda = await ticker(noPrice, 'NVDA', null)
  const s = await asset(noPrice, 'NVDA', 'Stock', { ticker: nvda })
  await lot(s, 'Market', 5, 100)
  await asset(noPrice, 'Cash', 'Cash', { price: 1000 })

  // a user whose only assets total zero
  await asset(zero, 'Empty cash', 'Cash', { price: 0 })

  await db.query('insert into public.net_worth_snapshots (user_id, date, value) values ($1,$2,$3)', [existing, D, 12345.67])
}, 60_000)

afterAll(async () => { await db.close() })

test('writes the same net worth as the TS valuation, and skips incomplete / empty users', async () => {
  const { rows } = await db.query<{ n: number }>('select public.record_net_worth_snapshots($1::date) as n', [D])
  // full is written; existing already had a row (not counted); noPrice, zero, empty skipped
  expect(rows[0].n).toBe(1)

  const expected = computeTotalNetWorth(expectedAssets)
  const per = expectedAssets.map(computeAssetValue)
  expect(per[0]).toBeCloseTo(Math.round(123.4567 * 23.25 * 100) / 100, 2) // RSU sold_at_vest netted out
  const got = await snapshots(full)
  expect(got).toHaveLength(1)
  expect(got[0].date).toBe(D)
  expect(Number(got[0].value)).toBeCloseTo(expected, 2)

  expect(await snapshots(noPrice)).toEqual([])
  expect(await snapshots(zero)).toEqual([])
  expect(await snapshots(empty)).toEqual([])
})

test('never overwrites an existing row for the date (the app live value wins)', async () => {
  const got = await snapshots(existing)
  expect(got).toEqual([{ date: D, value: '12345.67' }])
  const again = await db.query<{ n: number }>('select public.record_net_worth_snapshots($1::date) as n', [D])
  expect(again.rows[0].n).toBe(0)
})

test('fills a different date without touching earlier rows', async () => {
  const { rows } = await db.query<{ n: number }>("select public.record_net_worth_snapshots('2026-10-17'::date) as n")
  expect(rows[0].n).toBe(2) // full and existing
  expect((await snapshots(existing)).map(r => r.date)).toEqual([D, '2026-10-17'])
})

test('anon and authenticated cannot execute it', async () => {
  for (const role of ['anon', 'authenticated']) {
    await expect(db.transaction(async tx => {
      await tx.exec(`set local role ${role}`)
      await tx.query('select public.record_net_worth_snapshots()')
    }), role).rejects.toThrow()
  }
})

test('service_role can execute it', async () => {
  await db.transaction(async tx => {
    await tx.exec('set local role service_role')
    const r = await tx.query<{ n: number }>('select public.record_net_worth_snapshots($1::date) as n', [D])
    expect(r.rows[0].n).toBe(0)
  })
})
