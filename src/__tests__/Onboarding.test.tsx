import { render, screen, fireEvent } from '@testing-library/react'
import Onboarding from '../pages/Onboarding'

test('shows all key fields', () => {
  render(<Onboarding onComplete={() => {}} />)
  expect(screen.getByText('Supabase Project URL')).toBeInTheDocument()
  expect(screen.getByText('Supabase Anon Key')).toBeInTheDocument()
  expect(screen.getByText('Claude API Key')).toBeInTheDocument()
  expect(screen.getByText('Finnhub API Key')).toBeInTheDocument()
})

test('shows error when fields are empty', async () => {
  render(<Onboarding onComplete={() => {}} />)
  fireEvent.click(screen.getByText('Continue'))
  expect(await screen.findByText('All fields are required')).toBeInTheDocument()
})
