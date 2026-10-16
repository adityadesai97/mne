import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// A real Postgres (PGlite, in-process WASM, no Docker) standing in for the
// Supabase database, so migrations and row-level security can be tried before
// they reach real data. Supabase provides the auth schema, the three roles and
// default grants itself; this recreates just enough of them.

const ROOT = process.cwd()
export const BOOTSTRAP_PATH = join(ROOT, 'supabase/sql/self_host_bootstrap.sql')
export const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations')

const SUPABASE_STUBS = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`

// pgcrypto is only used for gen_random_uuid(), which is built into Postgres 13+.
const stripExtensions = (sql: string) => sql.replace(/create extension if not exists pgcrypto;/gi, '')

export async function newSupabaseLikeDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUBS)
  return db
}

export function readBootstrap(): string {
  return stripExtensions(readFileSync(BOOTSTRAP_PATH, 'utf8'))
}

export function readMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(name => ({ name, sql: stripExtensions(readFileSync(join(MIGRATIONS_DIR, name), 'utf8')) }))
}

export async function bootstrappedDb(): Promise<PGlite> {
  const db = await newSupabaseLikeDb()
  await db.exec(readBootstrap())
  return db
}

export async function createUser(db: PGlite, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email])
  return rows[0].id
}

/** Runs `fn` the way PostgREST would for a signed-in user: role `authenticated` with that user's id in the JWT claims. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.exec('set local role authenticated')
    if (userId) {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated' })])
    }
    return fn((sql, params) => tx.query(sql, params as any[]) as Promise<{ rows: any[] }>)
  })
}
