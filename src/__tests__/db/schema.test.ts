// @vitest-environment node
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { newSupabaseLikeDb, readBootstrap, readMigrations, bootstrappedDb } from './testDb'

test('the self-host bootstrap builds a working schema on an empty database', async () => {
  const db = await newSupabaseLikeDb()
  await db.exec(readBootstrap())
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from information_schema.tables where table_schema = 'public'")
  expect(rows[0].n).toBeGreaterThan(25)
}, 60_000)

test('the bootstrap can be run again without error (upgrade.sh re-runs it)', async () => {
  const db = await newSupabaseLikeDb()
  const sql = readBootstrap()
  await db.exec(sql)
  await db.exec(sql)
}, 60_000)

// 20260331000000 merges an admin_users table that was only ever created on the
// hosted project (outside this repo), so it cannot run from scratch. Every
// other migration must apply, in order, on top of the baseline.
const KNOWN_HOSTED_ONLY = new Set(['20260331000000_merge_admin_into_allowed_emails.sql'])

test('every migration applies in order on top of the baseline', async () => {
  const db = await newSupabaseLikeDb()
  const failures: string[] = []
  for (const { name, sql } of readMigrations()) {
    try {
      await db.exec(sql)
    } catch (e) {
      if (!KNOWN_HOSTED_ONLY.has(name)) failures.push(`${name}: ${(e as Error).message}`)
    }
  }
  expect(failures).toEqual([])
}, 90_000)

// The generated types describe the hosted database. Every table and column the
// app can name in a query must also exist in a database built from this repo's
// bootstrap, otherwise the next self-hosted project (or a rebuilt one) breaks at
// runtime. These two exist only on the hosted project today.
const HOSTED_ONLY_TABLES = new Set(['app_config'])
const HOSTED_ONLY_COLUMNS = new Set(['user_settings.gemini_api_key'])

function parseTypes(): Map<string, string[]> {
  const src = readFileSync(join(process.cwd(), 'src/lib/database.types.ts'), 'utf8')
  const tables = new Map<string, string[]>()
  let current: string | null = null
  let inRow = false
  for (const line of src.split('\n')) {
    const t = line.match(/^ {6}([a-z_]+): \{$/)
    if (t) { current = t[1]; tables.set(current, []); inRow = false; continue }
    if (/^ {8}Row: \{$/.test(line)) { inRow = true; continue }
    if (inRow && /^ {8}\}$/.test(line)) { inRow = false; continue }
    const c = inRow && line.match(/^ {10}([a-z_0-9]+)\??:/)
    if (c && current) tables.get(current)!.push(c[1])
    if (/^ {4}Views:/.test(line)) break
  }
  return tables
}

test('database.types.ts matches the schema the repo builds', async () => {
  const db = await bootstrappedDb()
  const { rows } = await db.query<{ table_name: string; column_name: string }>(
    "select table_name, column_name from information_schema.columns where table_schema = 'public'")
  const actual = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!actual.has(r.table_name)) actual.set(r.table_name, new Set())
    actual.get(r.table_name)!.add(r.column_name)
  }
  const missing: string[] = []
  const types = parseTypes()
  expect(types.size).toBeGreaterThan(25)
  for (const [table, columns] of types) {
    if (HOSTED_ONLY_TABLES.has(table)) continue
    if (!actual.has(table)) { missing.push(`table ${table}`); continue }
    for (const col of columns) {
      if (HOSTED_ONLY_COLUMNS.has(`${table}.${col}`)) continue
      if (!actual.get(table)!.has(col)) missing.push(`${table}.${col}`)
    }
  }
  expect(missing).toEqual([])
}, 60_000)
