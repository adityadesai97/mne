import { getSupabaseClient } from '../supabase'
import type { Json } from '../database.types'
import { sanitizeLayouts, type DashboardLayouts, type DashboardPage, type LayoutEntry } from '../dashboardLayout'

/**
 * Home / Charts card layouts, stored as one JSON object on `user_settings`
 * (`dashboard_layouts`) so the arrangement follows the user across devices.
 * A localStorage copy renders the saved layout on the first frame and keeps the
 * layout on this device if the database column isn't there yet.
 *
 * Both pages share one column, so every write sends the merged whole object;
 * writes are chained so a slow save can't land after a newer one.
 */

export const DASHBOARD_LAYOUTS_CACHE_KEY = 'mne_dashboard_layouts'

let current: DashboardLayouts = readCache()
let loaded: Promise<DashboardLayouts> | null = null
let writeChain: Promise<void> = Promise.resolve()
/** Pages saved during this page load: a late-arriving remote copy must not overwrite them. */
const dirty = new Set<DashboardPage>()

function readCache(): DashboardLayouts {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUTS_CACHE_KEY)
    return raw ? sanitizeLayouts(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

function writeCache(layouts: DashboardLayouts) {
  try {
    localStorage.setItem(DASHBOARD_LAYOUTS_CACHE_KEY, JSON.stringify(layouts))
  } catch {
    // private mode / quota: the database copy still works
  }
}

/** The layout known right now (local copy), for the first render. */
export function getCachedDashboardLayout(page: DashboardPage): LayoutEntry[] | undefined {
  return current[page]
}

/** Load once per page load; later calls reuse the first result. A failed load is retried on the next call. */
export function loadDashboardLayouts(): Promise<DashboardLayouts> {
  if (!loaded) {
    loaded = (async () => {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const { data, error } = await getSupabaseClient()
        .from('user_settings')
        .select('dashboard_layouts')
        .eq('user_id', user.id)
        .maybeSingle()
      if (error) throw error
      const remote = sanitizeLayouts(data?.dashboard_layouts)
      // The database wins per page; a page it has no entry for keeps the local copy.
      const remoteClean = { ...remote }
      for (const page of dirty) delete remoteClean[page]
      current = { ...current, ...remoteClean }
      writeCache(current)
      return current
    })().catch((e) => { loaded = null; throw e })
  }
  return loaded
}

/**
 * Save one page's layout. Resolves once the database has it; rejects if it
 * couldn't be saved (the layout still stays on this device).
 */
export function saveDashboardLayout(page: DashboardPage, layout: LayoutEntry[]): Promise<void> {
  dirty.add(page)
  current = { ...current, [page]: layout }
  writeCache(current)
  const run = async () => {
    // Make sure the other page's stored layout is in `current` before writing the whole object.
    await loadDashboardLayouts().catch(() => {})
    const { data: { user } } = await getSupabaseClient().auth.getUser()
    if (!user) throw new Error('Not authenticated')
    const merged = current // latest of both pages: chained runs always send the newest state
    const { error } = await getSupabaseClient()
      .from('user_settings')
      .upsert({ user_id: user.id, dashboard_layouts: merged as unknown as Json }, { onConflict: 'user_id' })
    if (error) throw error
  }
  const result = writeChain.then(run)
  writeChain = result.catch(() => {})
  return result
}

/** Test helper: forget in-memory state so each test starts from the local copy. */
export function resetDashboardLayoutsForTests() {
  current = readCache()
  loaded = null
  writeChain = Promise.resolve()
  dirty.clear()
}
