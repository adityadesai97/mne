import { render, screen } from '@testing-library/react'
import Onboarding from '../pages/Onboarding'

// Default: Supabase not ready -> requires env vars
vi.mock('../lib/supabase', () => ({
  isSupabaseReady: () => false,
  getSupabaseClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithOAuth: () => Promise.resolve({ data: {}, error: null }),
    },
  }),
}))

beforeEach(() => localStorage.clear())

test('shows env setup instructions when Supabase is not configured', () => {
  render(<Onboarding onComplete={() => {}} />)
  expect(screen.getByText('Supabase not configured')).toBeInTheDocument()
  expect(screen.getByText(/VITE_SUPABASE_URL=/)).toBeInTheDocument()
  expect(screen.getByText(/VITE_SUPABASE_ANON_KEY=/)).toBeInTheDocument()
})
