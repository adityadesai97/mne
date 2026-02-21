import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
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

test('shows error for invalid Supabase URL', async () => {
  render(<Onboarding onComplete={() => {}} />)
  fireEvent.change(screen.getByLabelText('Supabase Project URL'), { target: { value: 'not-a-url' } })
  fireEvent.change(screen.getByLabelText('Supabase Anon Key'), { target: { value: 'eyJ...' } })
  fireEvent.change(screen.getByLabelText('Claude API Key'), { target: { value: 'sk-ant-...' } })
  fireEvent.change(screen.getByLabelText('Finnhub API Key'), { target: { value: 'key' } })
  fireEvent.click(screen.getByText('Continue'))
  expect(await screen.findByText(/Supabase URL must be a valid URL/)).toBeInTheDocument()
})
