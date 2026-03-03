import { render, screen } from '@testing-library/react'
import App from '../App'

vi.mock('../lib/supabase', () => ({
  isSupabaseReady: () => false,
  onAuthFailure: () => () => {},
  getSupabaseClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    },
  }),
}))

beforeEach(() => localStorage.clear())

test('shows onboarding when not configured', () => {
  render(<App />)
  expect(screen.getByText('Supabase not configured')).toBeInTheDocument()
})
