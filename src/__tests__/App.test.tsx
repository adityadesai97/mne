import { render, screen } from '@testing-library/react'
import App from '../App'

test('renders app with heading', () => {
  render(<App />)
  expect(screen.getByText('mne')).toBeInTheDocument()
  expect(screen.getByText('Net Worth')).toBeInTheDocument()
})
