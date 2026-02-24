import { render, screen } from '@testing-library/react'
import { CommandBar } from '../components/CommandBar'

// Mock claude module to avoid actual API calls
vi.mock('../lib/claude', () => ({
  runCommand: vi.fn(),
}))

test('CommandBar is not visible when closed', () => {
  render(<CommandBar open={false} onClose={() => {}} />)
  expect(screen.queryByPlaceholderText(/ask anything/i)).not.toBeInTheDocument()
})
