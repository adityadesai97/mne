import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import AccountMenu from '../components/AccountMenu'

const signOut = vi.fn(() => Promise.resolve({ error: null }))
const signInWithOAuth = vi.fn((_args?: unknown) => Promise.resolve({ data: {}, error: null }))

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { email: 'me@example.com', user_metadata: { full_name: 'Me Example' } } }, error: null }),
      signOut: () => signOut(),
      signInWithOAuth: (args: unknown) => signInWithOAuth(args),
    },
  }),
}))

test('menu shows the signed-in account and offers switch and sign out', async () => {
  const user = userEvent.setup()
  render(<AccountMenu variant="top" />)
  expect(screen.queryByRole('menu')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Account' }))
  expect(await screen.findByText('me@example.com')).toBeTruthy()
  expect(screen.getByText('Me Example')).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: /Sign out/ })).toBeTruthy()
})

test('switching accounts asks Google to show the account chooser', async () => {
  const user = userEvent.setup()
  render(<AccountMenu variant="top" />)
  await user.click(screen.getByRole('button', { name: 'Account' }))
  await user.click(await screen.findByRole('menuitem', { name: /Switch Google account/ }))
  await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled())
  expect(signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
    provider: 'google',
    options: expect.objectContaining({ queryParams: { prompt: 'select_account' } }),
  }))
})

test('Escape closes the menu', async () => {
  const user = userEvent.setup()
  render(<AccountMenu variant="top" />)
  await user.click(screen.getByRole('button', { name: 'Account' }))
  await screen.findByRole('menu')
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()
})
