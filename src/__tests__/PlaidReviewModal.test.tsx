import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlaidReviewModal } from '../components/PlaidReviewModal'
import { listPendingPositions, markPendingPositionConfirmed, dismissPendingPosition } from '../lib/db/plaid'
import { executeTool, validateWriteToolInput } from '../lib/claude'

vi.mock('../lib/db/plaid', () => ({
  listPendingPositions: vi.fn(),
  markPendingPositionConfirmed: vi.fn(),
  dismissPendingPosition: vi.fn(),
}))

vi.mock('../lib/claude', () => ({
  executeTool: vi.fn(),
  validateWriteToolInput: vi.fn(() => null),
}))

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [{ id: 'asset-1', name: 'Existing Fidelity Stock' }] }),
      }),
    }),
  }),
}))

const pendingCash = {
  id: 'pending-1',
  plaid_item_id: 'item-1',
  detected_type: 'cash' as const,
  payload: { name: 'Chase Checking', price: 1200, location_name: 'Chase', asset_type: 'Cash' },
  matched_asset_id: null,
  created_at: '2026-09-01T00:00:00Z',
}

const pendingStockMatched = {
  id: 'pending-2',
  plaid_item_id: 'item-1',
  detected_type: 'stock' as const,
  payload: {
    symbol: 'AAPL',
    count: 10,
    cost_price: 150,
    purchase_date: '2026-01-01',
    subtype: 'Market',
    location_name: 'Fidelity',
  },
  matched_asset_id: 'asset-1',
  created_at: '2026-09-01T00:00:00Z',
}

beforeEach(() => {
  vi.mocked(listPendingPositions).mockReset()
  vi.mocked(markPendingPositionConfirmed).mockReset().mockResolvedValue(undefined)
  vi.mocked(dismissPendingPosition).mockReset().mockResolvedValue(undefined)
  vi.mocked(executeTool).mockReset().mockResolvedValue(undefined)
  vi.mocked(validateWriteToolInput).mockReset().mockReturnValue(null)
})

test('renders nothing when closed', () => {
  render(<PlaidReviewModal open={false} onClose={() => {}} />)
  expect(screen.queryByText('Review synced positions')).not.toBeInTheDocument()
})

test('loads pending positions and labels new vs matched rows', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingCash, pendingStockMatched])
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  expect(await screen.findByText('New')).toBeInTheDocument()
  expect(await screen.findByText('Will update "Existing Fidelity Stock"')).toBeInTheDocument()
})

test('confirming a row calls executeTool with the tool matching its detected type, then marks it confirmed', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingCash])
  const user = userEvent.setup()
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
  await user.click(confirmButton)

  await waitFor(() => {
    expect(executeTool).toHaveBeenCalledWith('add_cash_asset', expect.objectContaining({ name: 'Chase Checking' }), 'user-1')
  })
  expect(markPendingPositionConfirmed).toHaveBeenCalledWith('pending-1')
})

test('a validation error is shown and executeTool is not called', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingCash])
  vi.mocked(validateWriteToolInput).mockReturnValue('Value is required')
  const user = userEvent.setup()
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
  await user.click(confirmButton)

  expect(await screen.findByText('Value is required')).toBeInTheDocument()
  expect(executeTool).not.toHaveBeenCalled()
})

test('skipping a row dismisses it without writing anything', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingCash])
  const user = userEvent.setup()
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  const skipButton = await screen.findByRole('button', { name: 'Skip' })
  await user.click(skipButton)

  await waitFor(() => expect(dismissPendingPosition).toHaveBeenCalledWith('pending-1'))
  expect(executeTool).not.toHaveBeenCalled()
})

test('shows an empty state once nothing is left to review', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([])
  render(<PlaidReviewModal open={true} onClose={() => {}} />)
  expect(await screen.findByText('Nothing left to review.')).toBeInTheDocument()
})
