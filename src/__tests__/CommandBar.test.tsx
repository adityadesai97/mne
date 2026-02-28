import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandBar } from '../components/CommandBar'

// Mock claude module to avoid actual API calls
vi.mock('../lib/claude', () => ({
  runCommand: vi.fn(),
}))

test('CommandBar is not visible when closed', () => {
  render(<CommandBar open={false} onClose={() => {}} />)
  expect(screen.queryByPlaceholderText(/ask anything/i)).not.toBeInTheDocument()
})

test('Shift+Enter inserts a newline instead of submitting', async () => {
  const user = userEvent.setup()
  render(<CommandBar open={true} onClose={() => {}} />)
  const input = screen.getByPlaceholderText(/ask anything/i)
  await user.type(input, 'hello')
  await user.keyboard('{Shift>}{Enter}{/Shift}')
  await user.type(input, 'world')
  expect((input as HTMLTextAreaElement).value).toBe('hello\nworld')
})
