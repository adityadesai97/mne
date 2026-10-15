import { disconnectPlaidItem } from '../lib/db/plaid'

const state = vi.hoisted(() => ({
  linked: [] as any[],
  functionError: null as any,
  order: [] as string[],
  deleteFail: new Set<string>(),
}))

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'plaid_synced_positions') {
        return { select: () => ({ eq: () => ({ not: () => Promise.resolve({ data: state.linked, error: null }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
    functions: {
      invoke: () => {
        state.order.push('remove')
        return Promise.resolve({ data: state.functionError ? { error: 'boom' } : { ok: true }, error: null })
      },
    },
  }),
}))

vi.mock('../lib/db/assets', () => ({
  deleteAsset: vi.fn(async (id: string) => {
    state.order.push(`delete:${id}`)
    if (state.deleteFail.has(id)) throw new Error('nope')
  }),
}))

beforeEach(() => {
  state.linked = [
    { asset_id: 'a1', asset: { name: 'IGV Stock' } },
    { asset_id: 'a1', asset: { name: 'IGV Stock' } }, // two links to the same asset count once
    { asset_id: 'a2', asset: { name: 'Joint Checking' } },
  ]
  state.functionError = null
  state.order = []
  state.deleteFail = new Set()
})

test('unlink-only disconnects and never touches the assets', async () => {
  const res = await disconnectPlaidItem('item-1')
  expect(res).toEqual({ deleted: 0, failed: [] })
  expect(state.order).toEqual(['remove'])
})

test('delete mode removes each linked asset once, only after the disconnect succeeded', async () => {
  const res = await disconnectPlaidItem('item-1', { deleteAssets: true })
  expect(res).toEqual({ deleted: 2, failed: [] })
  expect(state.order).toEqual(['remove', 'delete:a1', 'delete:a2'])
})

test('a failed disconnect deletes nothing', async () => {
  state.functionError = true
  await expect(disconnectPlaidItem('item-1', { deleteAssets: true })).rejects.toThrow('boom')
  expect(state.order).toEqual(['remove'])
})

test('assets that fail to delete are reported, the rest still go', async () => {
  state.deleteFail = new Set(['a1'])
  const res = await disconnectPlaidItem('item-1', { deleteAssets: true })
  expect(res).toEqual({ deleted: 1, failed: ['IGV Stock'] })
})
