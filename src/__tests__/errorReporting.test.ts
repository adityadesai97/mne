import { beforeEach, expect, test, vi } from 'vitest'

const insert = vi.fn().mockResolvedValue({ error: null })
vi.mock('../lib/supabase', () => ({
  isSupabaseReady: () => true,
  getSupabaseClient: () => ({ from: (t: string) => ({ insert: (row: unknown) => insert(t, row) }) }),
}))

import { reportError, _resetErrorReporting } from '../lib/errorReporting'

beforeEach(() => { insert.mockClear(); _resetErrorReporting() })

test('reports to client_errors with message and stack', async () => {
  await reportError('test', new Error('boom'))
  expect(insert).toHaveBeenCalledTimes(1)
  expect(insert.mock.calls[0][0]).toBe('client_errors')
  expect(insert.mock.calls[0][1]).toMatchObject({ source: 'test', message: 'boom' })
})

test('dedupes identical errors and caps the session', async () => {
  await reportError('test', new Error('same'))
  await reportError('test', new Error('same'))
  expect(insert).toHaveBeenCalledTimes(1)
  for (let i = 0; i < 40; i++) await reportError('test', new Error(`e${i}`))
  expect(insert.mock.calls.length).toBeLessThanOrEqual(20)
})

test('scrubs dollar amounts and never throws', async () => {
  await reportError('test', new Error('Lost $12,345.67 somewhere'))
  expect(insert.mock.calls[0][1].message).toBe('Lost $# somewhere')
  insert.mockRejectedValueOnce(new Error('network'))
  await expect(reportError('test', new Error('x2'))).resolves.toBeUndefined()
})
