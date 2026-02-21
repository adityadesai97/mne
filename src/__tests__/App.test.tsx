import { render, screen } from '@testing-library/react'
import App from '../App'

test('shows onboarding when not configured', () => {
  render(<App />)
  expect(screen.getByText('Welcome to mne')).toBeInTheDocument()
})
