import { beforeEach, expect, test, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  remote: null as unknown,
  upserts: [] as { row: Record<string, unknown>; opts: unknown }[],
  failNextUpsert: false,
  failLoad: false,
  user: { id: 'u1' } as { id: string } | null,
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: fake.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (fake.failLoad
            ? { data: null, error: { message: 'boom' } }
            : { data: fake.remote === null ? null : { dashboard_layouts: fake.remote }, error: null }),
        }),
      }),
      upsert: async (row: Record<string, unknown>, opts: unknown) => {
        if (fake.failNextUpsert) { fake.failNextUpsert = false; return { error: { message: 'nope' } } }
        fake.upserts.push({ row, opts })
        return { error: null }
      },
    }),
  }),
}))

import {
  DASHBOARD_LAYOUTS_CACHE_KEY, getCachedDashboardLayout, loadDashboardLayouts, resetDashboardLayoutsForTests, saveDashboardLayout,
} from '@/lib/db/dashboardLayouts'

beforeEach(() => {
  localStorage.clear()
  fake.remote = null
  fake.upserts = []
  fake.failNextUpsert = false
  fake.failLoad = false
  fake.user = { id: 'u1' }
  resetDashboardLayoutsForTests()
})

test('loading reads the account copy, sanitizes it and mirrors it locally', async () => {
  fake.remote = { home: [{ id: 'a', hidden: true }, { id: 'a' }, { id: 5 }], charts: 'junk', extra: 1 }
  expect(await loadDashboardLayouts()).toEqual({ home: [{ id: 'a', hidden: true }], charts: [] })
  expect(getCachedDashboardLayout('home')).toEqual([{ id: 'a', hidden: true }])
  expect(JSON.parse(localStorage.getItem(DASHBOARD_LAYOUTS_CACHE_KEY)!)).toEqual({ home: [{ id: 'a', hidden: true }], charts: [] })
})

test('no row yet, or a null column, loads as "no custom layout"', async () => {
  fake.remote = null
  expect(await loadDashboardLayouts()).toEqual({})
  resetDashboardLayoutsForTests()
  fake.remote = undefined
  expect(await loadDashboardLayouts()).toEqual({})
})

test('the account is read once per page load', async () => {
  fake.remote = { home: [{ id: 'a' }] }
  const [a, b] = await Promise.all([loadDashboardLayouts(), loadDashboardLayouts()])
  expect(a).toBe(b)
})

test('a failed load can be retried and does not poison later loads', async () => {
  fake.failLoad = true
  await expect(loadDashboardLayouts()).rejects.toBeTruthy()
  fake.failLoad = false
  fake.remote = { home: [{ id: 'z' }] }
  expect(await loadDashboardLayouts()).toEqual({ home: [{ id: 'z' }] })
})

test("saving one page never wipes the other page's stored layout", async () => {
  fake.remote = { charts: [{ id: 'c1', hidden: true }] }
  await saveDashboardLayout('home', [{ id: 'h1' }])
  expect(fake.upserts).toHaveLength(1)
  expect(fake.upserts[0].row).toEqual({
    user_id: 'u1',
    dashboard_layouts: { home: [{ id: 'h1' }], charts: [{ id: 'c1', hidden: true }] },
  })
  expect(fake.upserts[0].opts).toEqual({ onConflict: 'user_id' })

  await saveDashboardLayout('charts', [{ id: 'c1' }, { id: 'c2' }])
  expect(fake.upserts[1].row.dashboard_layouts).toEqual({ home: [{ id: 'h1' }], charts: [{ id: 'c1' }, { id: 'c2' }] })
})

test('a layout saved before the account copy arrived is not overwritten by it', async () => {
  fake.remote = { home: [{ id: 'old' }], charts: [{ id: 'c' }] }
  const saving = saveDashboardLayout('home', [{ id: 'new' }])
  await loadDashboardLayouts()
  await saving
  expect(getCachedDashboardLayout('home')).toEqual([{ id: 'new' }])
  expect(getCachedDashboardLayout('charts')).toEqual([{ id: 'c' }])
  expect(fake.upserts.at(-1)!.row.dashboard_layouts).toEqual({ home: [{ id: 'new' }], charts: [{ id: 'c' }] })
})

test('rapid saves are written in order, so the last edit is what the account ends up with', async () => {
  await Promise.all([
    saveDashboardLayout('home', [{ id: 'a' }]),
    saveDashboardLayout('home', [{ id: 'a' }, { id: 'b' }]),
    saveDashboardLayout('home', [{ id: 'b' }]),
  ])
  const last = fake.upserts.at(-1)!.row.dashboard_layouts as { home: unknown }
  expect(last.home).toEqual([{ id: 'b' }])
})

test('a failed save rejects, keeps the layout on this device, and the next save still goes through', async () => {
  fake.failNextUpsert = true
  await expect(saveDashboardLayout('home', [{ id: 'a' }])).rejects.toBeTruthy()
  expect(getCachedDashboardLayout('home')).toEqual([{ id: 'a' }])
  expect(JSON.parse(localStorage.getItem(DASHBOARD_LAYOUTS_CACHE_KEY)!).home).toEqual([{ id: 'a' }])
  await saveDashboardLayout('home', [{ id: 'a' }, { id: 'b' }])
  expect(fake.upserts.at(-1)!.row.dashboard_layouts).toMatchObject({ home: [{ id: 'a' }, { id: 'b' }] })
})

test('signed out: saving rejects without touching the database', async () => {
  fake.user = null
  await expect(saveDashboardLayout('home', [{ id: 'a' }])).rejects.toThrow(/authenticated/i)
  expect(fake.upserts).toHaveLength(0)
})

test('a corrupt local copy is ignored rather than crashing the page', () => {
  localStorage.setItem(DASHBOARD_LAYOUTS_CACHE_KEY, '{not json')
  resetDashboardLayoutsForTests()
  expect(getCachedDashboardLayout('home')).toBeUndefined()
  localStorage.setItem(DASHBOARD_LAYOUTS_CACHE_KEY, JSON.stringify({ home: [{ id: 'ok' }, { id: 1 }] }))
  resetDashboardLayoutsForTests()
  expect(getCachedDashboardLayout('home')).toEqual([{ id: 'ok' }])
})
