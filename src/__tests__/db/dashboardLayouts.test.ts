// @vitest-environment node
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asUser, bootstrappedDb, createUser, newSupabaseLikeDb } from './testDb'

let db: PGlite
let alice: string
let bob: string

beforeAll(async () => {
  db = await bootstrappedDb()
  alice = await createUser(db, 'alice@example.com')
  bob = await createUser(db, 'bob@example.com')
}, 60_000)

afterAll(async () => { await db.close() })

test('dashboard_layouts is a nullable jsonb column, null until the user customizes', async () => {
  const { rows } = await db.query<{ data_type: string; is_nullable: string }>(
    "select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'user_settings' and column_name = 'dashboard_layouts'")
  expect(rows).toEqual([{ data_type: 'jsonb', is_nullable: 'YES' }])
  await asUser(db, alice, q => q('insert into public.user_settings (user_id) values (auth.uid())'))
  const { rows: r } = await asUser(db, alice, q => q('select dashboard_layouts from public.user_settings'))
  expect(r).toEqual([{ dashboard_layouts: null }])
})

test('the app\'s upsert (insert … on conflict user_id) stores and replaces the layout', async () => {
  const save = (layouts: unknown) => asUser(db, alice, q => q(
    `insert into public.user_settings (user_id, dashboard_layouts) values (auth.uid(), $1::jsonb)
     on conflict (user_id) do update set dashboard_layouts = excluded.dashboard_layouts`, [JSON.stringify(layouts)]))
  await save({ home: [{ id: 'pulse', hidden: true }], charts: [{ id: 'pnl', span: 'all' }] })
  await save({ home: [{ id: 'pulse' }, { id: 'allocation', span: 1 }] })
  const { rows } = await asUser(db, alice, q => q('select dashboard_layouts from public.user_settings'))
  expect(rows).toEqual([{ dashboard_layouts: { home: [{ id: 'pulse' }, { id: 'allocation', span: 1 }] } }])
})

test('another user cannot read or change someone else\'s layout', async () => {
  await asUser(db, bob, q => q(`insert into public.user_settings (user_id, dashboard_layouts) values (auth.uid(), '{"home":[{"id":"x"}]}')`))
  const bobSees = await asUser(db, bob, q => q('select dashboard_layouts from public.user_settings'))
  expect(bobSees.rows).toEqual([{ dashboard_layouts: { home: [{ id: 'x' }] } }])
  await asUser(db, bob, q => q(`update public.user_settings set dashboard_layouts = '{}' where user_id = $1`, [alice]))
  const aliceStill = await asUser(db, alice, q => q('select dashboard_layouts from public.user_settings'))
  expect(aliceStill.rows[0].dashboard_layouts).toMatchObject({ home: expect.any(Array) })
})

test('the migration adds the column to a database that predates it, and is safe to run twice', async () => {
  const old = await newSupabaseLikeDb()
  await old.exec('create schema if not exists public; create table public.user_settings (id uuid primary key default gen_random_uuid(), user_id uuid not null);')
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261019000000_add_dashboard_layouts.sql'), 'utf8')
  await old.exec(sql)
  await old.exec(sql)
  const { rows } = await old.query("select column_name from information_schema.columns where table_name = 'user_settings' and column_name = 'dashboard_layouts'")
  expect(rows).toHaveLength(1)
  await old.close()
})
