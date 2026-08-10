import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandBar } from '../components/CommandBar'
import { runCommand } from '../lib/claude'

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

test('renders a markdown table in the assistant reply with aligned, colored cells', async () => {
  vi.mocked(runCommand).mockResolvedValue({
    type: 'text',
    message: [
      'Here are your positions:',
      '',
      '| Symbol | Value |',
      '|---|---:|',
      '| AAPL | +$500 |',
      '| MSFT | -$100 |',
    ].join('\n'),
  })

  const user = userEvent.setup()
  render(<CommandBar open={true} onClose={() => {}} />)
  const input = screen.getByPlaceholderText(/ask anything/i)
  await user.type(input, 'show my positions')
  await user.keyboard('{Enter}')

  expect(await screen.findByText('AAPL')).toBeInTheDocument()
  expect(screen.getByText('+$500')).toHaveClass('text-gain')
  expect(screen.getByText('-$100')).toHaveClass('text-loss')

  const headerCell = screen.getByText('Value').closest('th')
  expect(headerCell).toHaveClass('text-right')

  expect(document.querySelector('table')).toBeInTheDocument()
})

test('full screen toggle button expands and restores the panel', async () => {
  const user = userEvent.setup()
  render(<CommandBar open={true} onClose={() => {}} />)

  const panel = screen.getByTestId('cmdk-panel')
  expect(panel).toHaveAttribute('data-fullscreen', 'false')

  const expandButton = screen.getByRole('button', { name: 'Full screen' })
  await user.click(expandButton)

  expect(panel).toHaveAttribute('data-fullscreen', 'true')
  expect(panel.className).toMatch(/\bh-full\b/)
  expect(panel.className).toMatch(/\bmax-w-none\b/)

  const collapseButton = screen.getByRole('button', { name: 'Exit full screen' })
  await user.click(collapseButton)

  expect(panel).toHaveAttribute('data-fullscreen', 'false')
  expect(panel.className).toMatch(/\bmax-w-lg\b/)
})

test('closing the panel resets full screen for the next open', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<CommandBar open={true} onClose={() => {}} />)

  await user.click(screen.getByRole('button', { name: 'Full screen' }))
  expect(screen.getByTestId('cmdk-panel')).toHaveAttribute('data-fullscreen', 'true')

  rerender(<CommandBar open={false} onClose={() => {}} />)
  rerender(<CommandBar open={true} onClose={() => {}} />)

  expect(screen.getByTestId('cmdk-panel')).toHaveAttribute('data-fullscreen', 'false')
})
