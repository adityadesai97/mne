import { render, screen, fireEvent, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandBar } from '../components/CommandBar'
import { runCommand } from '../lib/claude'
import { submitCommandFeedback } from '../lib/db/feedback'
import { listConversations, getConversation, deleteConversation, groupConversationsByDay } from '../lib/db/conversations'

// Mock claude module to avoid actual API calls
vi.mock('../lib/claude', () => ({
  runCommand: vi.fn(),
}))

vi.mock('../lib/db/conversations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/conversations')>()),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
  saveConversation: vi.fn().mockResolvedValue('saved-id'),
  incrementConversationUsage: vi.fn(),
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

const NOW = new Date().toISOString()
const SAVED = [
  { id: 'c1', title: 'Weekly movers', created_at: NOW, updated_at: NOW },
  { id: 'c2', title: 'NVDA tax lots', created_at: '2020-01-02T12:00:00Z', updated_at: '2020-01-02T12:00:00Z' },
]

test('History lists saved conversations, resumes one, and deletes another', async () => {
  vi.mocked(listConversations).mockResolvedValue(SAVED)
  vi.mocked(getConversation).mockResolvedValue({
    ...SAVED[0],
    origin: 'command_bar',
    messages: [{ role: 'user', content: 'Weekly movers' }, { role: 'assistant', content: 'NVDA led the week.' }],
  })
  vi.mocked(deleteConversation).mockResolvedValue(undefined)
  const user = userEvent.setup()
  render(<CommandBar open={true} onClose={() => {}} />)

  await user.click(screen.getByRole('button', { name: 'Conversation history' }))
  expect(await screen.findByRole('button', { name: 'Open conversation: Weekly movers' })).toBeInTheDocument()
  expect(screen.getByText('Today')).toBeInTheDocument()
  expect(screen.getByText('Earlier')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Delete conversation: NVDA tax lots' }))
  expect(deleteConversation).toHaveBeenCalledWith('c2')
  expect(screen.queryByRole('button', { name: 'Open conversation: NVDA tax lots' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Open conversation: Weekly movers' }))
  expect(getConversation).toHaveBeenCalledWith('c1')
  expect(await screen.findByText('NVDA led the week.')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Conversation history' })).not.toBeInTheDocument()
})

test('docked History replaces the thread, and New conversation clears it', async () => {
  vi.mocked(listConversations).mockResolvedValue([])
  vi.mocked(runCommand).mockResolvedValue({ type: 'text', message: 'Hello there.' })
  setViewportWidth(1280)
  const user = userEvent.setup()
  render(<CommandBar open={true} onClose={() => {}} />)
  await user.type(screen.getByPlaceholderText(/ask anything/i), 'hi')
  await user.keyboard('{Enter}')
  expect(await screen.findByText('Hello there.')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Conversation history' }))
  expect(await screen.findByText('No saved conversations yet.')).toBeInTheDocument()
  expect(screen.getByText('Hello there.')).not.toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Back to conversation' }))
  expect(screen.getByText('Hello there.')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Conversation history' }))
  await user.click(screen.getByRole('button', { name: /New conversation/ }))
  expect(screen.queryByText('Hello there.')).not.toBeInTheDocument()
  expect(screen.getByPlaceholderText(/ask anything/i)).toBeInTheDocument()
})

test('groupConversationsByDay buckets by local day and drops empty groups', () => {
  const now = new Date(2026, 9, 16, 12)
  const at = (d: Date) => ({ id: String(d.getTime()), title: 't', created_at: d.toISOString(), updated_at: d.toISOString() })
  const groups = groupConversationsByDay([
    at(new Date(2026, 9, 16, 1)), at(new Date(2026, 9, 15, 23)), at(new Date(2026, 9, 12)), at(new Date(2026, 8, 1)),
  ], now)
  expect(groups.map(g => [g.label, g.items.length])).toEqual([['Today', 1], ['Yesterday', 1], ['Earlier this week', 1], ['Earlier', 1]])
  expect(groupConversationsByDay([], now)).toEqual([])
})
