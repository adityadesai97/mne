import { render, screen } from '@testing-library/react'
import App from '../App'

test('shows onboarding when not configured', () => {
  // localStorage is empty in test environment, so onboarding shows
  render(<App />)
  expect(screen.getByText('Welcome to mne')).toBeInTheDocument()
})
