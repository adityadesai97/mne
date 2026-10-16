import { render, screen, fireEvent, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandBar } from '../components/CommandBar'
import { runCommand } from '../lib/claude'
import { submitCommandFeedback } from '../lib/db/feedback'

// Mock claude module to avoid actual API calls
vi.mock('../lib/claude', () => ({
  runCommand: vi.fn(),
}))

vi.mock('../lib/db/feedback', () => ({
  submitCommandFeedback: vi.fn(),
}))

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

beforeEach(() => {
  setViewportWidth(1280)
})

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

test('streams the reply into the thinking bubble as tokens arrive, before the call resolves', async () => {
  let resolveRunCommand: (value: any) => void = () => {}
  vi.mocked(runCommand).mockImplementation((_messages, _attachment, streamCallbacks) => {
    return new Promise((resolve) => {
      resolveRunCommand = resolve
      streamCallbacks?.onStreamStart?.()
      streamCallbacks?.onTextDelta?.('Your net worth ')
      streamCallbacks?.onTextDelta?.('is $10,000.')
    })
  })

  const user = userEvent.setup()
  render(<CommandBar open={true} onClose={() => {}} />)
  const input = screen.getByPlaceholderText(/ask anything/i)
  await user.type(input, "what's my net worth?")
  await user.keyboard('{Enter}')

  // Visible while runCommand's promise is still pending — proves this came
  // from the streaming callback, not the resolved action.
  expect(await screen.findByText('Your net worth is $10,000.')).toBeInTheDocument()

  await act(async () => {
    resolveRunCommand({ type: 'text', message: 'Your net worth is $10,000.' })
  })
  expect(await screen.findByText('Your net worth is $10,000.')).toBeInTheDocument()
})

test('feedback form submits the agent response, query, and free-text feedback', async () => {
  vi.mocked(runCommand).mockResolvedValue({ type: 'text', message: 'Your net worth is $10,000.' })
  vi.mocked(submitCommandFeedback).mockResolvedValue(undefined)

  const user = userEvent.setup()
  render(<CommandBar open={true} onClose={() => {}} />)
  const input = screen.getByPlaceholderText(/ask anything/i)
  await user.type(input, "what's my net worth?")
  await user.keyboard('{Enter}')

  expect(await screen.findByText('Your net worth is $10,000.')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Give feedback on this response' }))
  const feedbackInput = screen.getByPlaceholderText(/what was wrong/i)
  fireEvent.change(feedbackInput, { target: { value: 'This number looks stale' } })
  await user.click(screen.getByRole('button', { name: 'Send' }))

  expect(await screen.findByText('Thanks for the feedback ✓')).toBeInTheDocument()
  expect(submitCommandFeedback).toHaveBeenCalledWith(
    expect.objectContaining({
      userQuery: "what's my net worth?",
      agentResponse: 'Your net worth is $10,000.',
      feedbackText: 'This number looks stale',
      attachment: null,
    }),
  )
})

test('wide screens dock the panel beside the page as a labelled complementary region', () => {
  render(<CommandBar open={true} onClose={() => {}} contextLabel="Home" />)
  const panel = screen.getByRole('complementary', { name: 'Ask mne' })
  expect(panel).toBe(screen.getByTestId('cmdk-panel'))
  expect(panel).toHaveAttribute('data-mode', 'dock')
  expect(screen.getByText('Viewing Home')).toBeInTheDocument()
  // Not modal: no backdrop, no Half/Full detents.
  expect(document.querySelector('.cmdk-backdrop')).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Sheet height' })).not.toBeInTheDocument()
})

test('Escape and the close button close the docked panel', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  render(<CommandBar open={true} onClose={onClose} />)
  await user.click(screen.getByPlaceholderText(/ask anything/i))
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})

test('phones get a modal bottom sheet; the grabber toggles its height and there is no Half/Full control', async () => {
  setViewportWidth(390)
  const user = userEvent.setup()
  render(<CommandBar open={true} onClose={() => {}} />)

  const sheet = screen.getByRole('dialog', { name: 'Ask mne' })
  expect(sheet).toHaveAttribute('aria-modal', 'true')
  expect(sheet).toHaveAttribute('data-mode', 'sheet')
  expect(sheet).toHaveAttribute('data-detent', 'half')

  expect(screen.queryByRole('button', { name: 'Full' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Expand to full height' }))
  expect(sheet).toHaveAttribute('data-detent', 'full')
  await user.click(screen.getByRole('button', { name: 'Collapse to half height' }))
  expect(sheet).toHaveAttribute('data-detent', 'half')
})

test('the conversation is cleared shortly after the panel closes, and a quick reopen keeps it', async () => {
  vi.mocked(runCommand).mockResolvedValue({ type: 'text', message: 'Your net worth is $10,000.' })
  const user = userEvent.setup()
  const { rerender } = render(<CommandBar open={true} onClose={() => {}} />)
  await user.type(screen.getByPlaceholderText(/ask anything/i), 'net worth?')
  await user.keyboard('{Enter}')
  expect(await screen.findByText('Your net worth is $10,000.')).toBeInTheDocument()

  // Closed and reopened straight away: the thread is still there.
  rerender(<CommandBar open={false} onClose={() => {}} />)
  rerender(<CommandBar open={true} onClose={() => {}} />)
  expect(screen.getByText('Your net worth is $10,000.')).toBeInTheDocument()

  // Closed for good: cleared once the panel has slid away.
  rerender(<CommandBar open={false} onClose={() => {}} />)
  await act(async () => { await new Promise(r => setTimeout(r, 600)) })
  rerender(<CommandBar open={true} onClose={() => {}} />)
  expect(screen.queryByText('Your net worth is $10,000.')).not.toBeInTheDocument()
  expect(screen.getByPlaceholderText(/ask anything/i)).toBeInTheDocument()
})

test('a pending write pins Confirm and Cancel above the composer and runs only on Confirm', async () => {
  const execute = vi.fn().mockResolvedValue(undefined)
  vi.mocked(runCommand).mockResolvedValue({
    type: 'write_confirm',
    confirmationMessage: 'Add 10 AAPL shares?',
    previewSections: [{ title: 'Stock Purchases', columns: ['Symbol', 'Shares'], rows: [['AAPL', '10']] }],
    execute,
  })
  const user = userEvent.setup()
  render(<CommandBar open={true} onClose={() => {}} />)
  await user.type(screen.getByPlaceholderText(/ask anything/i), 'mock: add 10 AAPL')
  await user.keyboard('{Enter}')

  expect(await screen.findByText('Add 10 AAPL shares?')).toBeInTheDocument()
  // The preview table lives in the thread, the action bar in the pinned slot.
  expect(document.querySelector('.cmdk-thread')).toContainElement(screen.getByText('AAPL'))
  const pin = document.querySelector('.cmdk-pin') as HTMLElement
  expect(within(pin).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  expect(execute).not.toHaveBeenCalled()

  await user.click(within(pin).getByRole('button', { name: 'Confirm' }))
  expect(execute).toHaveBeenCalledTimes(1)
  expect(await screen.findByText('Saved ✓')).toBeInTheDocument()
  expect(pin).toBeEmptyDOMElement()
})

test('Cancel dismisses a pending write without closing the panel or running it', async () => {
  const execute = vi.fn()
  const onClose = vi.fn()
  vi.mocked(runCommand).mockResolvedValue({
    type: 'write_confirm',
    confirmationMessage: 'Add 10 AAPL shares?',
    previewSections: [{ title: 'Stock Purchases', columns: ['Symbol'], rows: [['AAPL']] }],
    execute,
  })
  const user = userEvent.setup()
  render(<CommandBar open={true} onClose={onClose} />)
  await user.type(screen.getByPlaceholderText(/ask anything/i), 'add AAPL')
  await user.keyboard('{Enter}')
  await screen.findByText('Add 10 AAPL shares?')

  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText(/Nothing was changed/)).toBeInTheDocument()
  expect(execute).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

test('a prefilled question (chip / Pulse card) is sent as soon as the panel opens', async () => {
  vi.mocked(runCommand).mockResolvedValue({ type: 'text', message: 'It rose.' })
  const onPrefillHandled = vi.fn()
  render(<CommandBar open={true} onClose={() => {}} prefillQuery="Explain my allocation" onPrefillHandled={onPrefillHandled} />)
  expect(await screen.findByText('It rose.')).toBeInTheDocument()
  expect(screen.getByText('Explain my allocation')).toBeInTheDocument()
  expect(onPrefillHandled).toHaveBeenCalled()
})
