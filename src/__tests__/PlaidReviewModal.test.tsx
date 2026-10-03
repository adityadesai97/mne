import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlaidReviewModal } from '../components/PlaidReviewModal'
import { listPendingPositions, markPendingPositionConfirmed, dismissPendingPosition, recordPlaidSyncLink } from '../lib/db/plaid'
import { executeTool, validateWriteToolInput } from '../lib/claude'
import { getAllAssets } from '../lib/db/assets'

vi.mock('../lib/db/plaid', () => ({
  listPendingPositions: vi.fn(),
  markPendingPositionConfirmed: vi.fn(),
  dismissPendingPosition: vi.fn(),
  recordPlaidSyncLink: vi.fn(),
}))

vi.mock('../lib/claude', () => ({
  executeTool: vi.fn(),
  validateWriteToolInput: vi.fn(() => null),
}))

vi.mock('../lib/db/assets', () => ({
  getAllAssets: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
  }),
}))

const fixtureAssets = [
  { id: 'asset-1', name: 'Existing Fidelity Stock', asset_type: 'Stock', ticker: { symbol: 'AAPL', kind: 'stock' }, location: { name: 'Fidelity' } },
]

const pendingCash = {
  id: 'pending-1',
  plaid_item_id: 'item-1',
  external_account_id: 'ext-account-1',
  external_security_id: null,
  detected_type: 'cash' as const,
  payload: { name: 'Chase Checking', price: 1200, location_name: 'Chase', asset_type: 'Cash' },
  matched_asset_id: null,
  created_at: '2026-09-01T00:00:00Z',
}

const pendingStockMatched = {
  id: 'pending-2',
  plaid_item_id: 'item-1',
  external_account_id: 'ext-account-2',
  external_security_id: 'ext-security-2',
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

const pendingCashMatched = {
  id: 'pending-3',
  plaid_item_id: 'item-1',
  external_account_id: 'ext-account-3',
  external_security_id: null,
  detected_type: 'cash' as const,
  payload: { name: 'Existing Fidelity Stock', price: 1500, location_name: 'Fidelity', asset_type: 'Cash' },
  matched_asset_id: 'asset-1',
  created_at: '2026-09-01T00:00:00Z',
}

beforeEach(() => {
  vi.mocked(listPendingPositions).mockReset()
  vi.mocked(markPendingPositionConfirmed).mockReset().mockResolvedValue(undefined)
  vi.mocked(dismissPendingPosition).mockReset().mockResolvedValue(undefined)
  vi.mocked(recordPlaidSyncLink).mockReset().mockResolvedValue(undefined)
  vi.mocked(executeTool).mockReset().mockResolvedValue(undefined)
  vi.mocked(validateWriteToolInput).mockReset().mockReturnValue(null)
  vi.mocked(getAllAssets).mockReset().mockResolvedValue(fixtureAssets as any)
})

test('renders nothing when closed', () => {
  render(<PlaidReviewModal open={false} onClose={() => {}} />)
  expect(screen.queryByText('Review synced positions')).not.toBeInTheDocument()
})

test('loads pending positions and labels new vs matched rows', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingCash, pendingStockMatched])
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  expect(await screen.findByText('New')).toBeInTheDocument()
  expect(await screen.findByText('Looks like "Existing Fidelity Stock"')).toBeInTheDocument()
})

test('a matched flat-balance row reconciles via update_asset_value, not a duplicate add_cash_asset insert', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingCashMatched])
  const user = userEvent.setup()
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
  expect(confirmButton).toBeEnabled() // flat-balance matches never require the duplicate-risk checkbox
  await user.click(confirmButton)

  await waitFor(() => {
    expect(executeTool).toHaveBeenCalledWith(
      'update_asset_value',
      { asset_name: 'Existing Fidelity Stock', _assetId: 'asset-1', _expectedAssetType: 'Cash', price: 1500 },
      'user-1',
    )
  })
  expect(executeTool).not.toHaveBeenCalledWith('add_cash_asset', expect.anything(), expect.anything())
})

test('a matched lot-based row cannot be confirmed until the duplicate-risk checkbox is checked', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingStockMatched])
  const user = userEvent.setup()
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
  expect(confirmButton).toBeDisabled()
  expect(executeTool).not.toHaveBeenCalled()

  const checkbox = screen.getByRole('checkbox')
  await user.click(checkbox)
  expect(confirmButton).toBeEnabled()

  await user.click(confirmButton)
  await waitFor(() => {
    expect(executeTool).toHaveBeenCalledWith('add_stock_transaction', expect.objectContaining({ symbol: 'AAPL' }), 'user-1')
  })
})

test('confirming a row calls executeTool with the tool matching its detected type, then marks it confirmed', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingCash])
  vi.mocked(executeTool).mockResolvedValue({ assetId: 'asset-99' })
  const user = userEvent.setup()
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
  await user.click(confirmButton)

  await waitFor(() => {
    expect(executeTool).toHaveBeenCalledWith('add_cash_asset', expect.objectContaining({ name: 'Chase Checking' }), 'user-1')
  })
  expect(markPendingPositionConfirmed).toHaveBeenCalledWith('pending-1')
})

test('confirming records a plaid_synced_positions link before marking confirmed, so a later sync can find it', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingCash])
  vi.mocked(executeTool).mockResolvedValue({ assetId: 'asset-99' })
  const user = userEvent.setup()
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
  await user.click(confirmButton)

  await waitFor(() => {
    expect(recordPlaidSyncLink).toHaveBeenCalledWith(pendingCash, { assetId: 'asset-99', transactionId: undefined, fixedIncomeLotId: undefined })
  })
  expect(markPendingPositionConfirmed).toHaveBeenCalledWith('pending-1')
})

test('confirming a matched stock row records the link with the created transaction id, not just the asset id', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingStockMatched])
  vi.mocked(executeTool).mockResolvedValue({ assetId: 'asset-1', transactionId: 'txn-7' })
  const user = userEvent.setup()
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
  await user.click(screen.getByRole('checkbox'))
  await user.click(confirmButton)

  await waitFor(() => {
    expect(recordPlaidSyncLink).toHaveBeenCalledWith(pendingStockMatched, { assetId: 'asset-1', transactionId: 'txn-7', fixedIncomeLotId: undefined })
  })
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

// ─── Manual match for an unmatched row ─────────────────────────────────────

test('no manual-match dropdown is offered when nothing compatible exists', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingCash])
  // fixtureAssets only has a Stock asset -- never compatible with a 'cash' row.
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  await screen.findByText('New')
  expect(screen.queryByLabelText(/link to an existing position/i)).not.toBeInTheDocument()
})

test('an unmatched row offers a manual match to a compatible existing asset, and only that one', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingCash])
  vi.mocked(getAllAssets).mockResolvedValue([
    ...fixtureAssets,
    { id: 'asset-2', name: 'My Joint Checking', asset_type: 'Cash', location: { name: 'Chase' } },
    { id: 'asset-3', name: 'My 401k', asset_type: '401k', location: { name: 'Fidelity' } },
  ] as any)
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  const select = await screen.findByLabelText(/link to an existing position/i)
  expect(screen.getByRole('option', { name: 'My Joint Checking (Chase)' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /My 401k/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /Existing Fidelity Stock/ })).not.toBeInTheDocument()
  expect(select).toHaveValue('')
})

test('picking a manual match reconciles via update_asset_value with the chosen asset id, same as an automatic match', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([pendingCash])
  vi.mocked(getAllAssets).mockResolvedValue([
    ...fixtureAssets,
    { id: 'asset-2', name: 'My Joint Checking', asset_type: 'Cash', location: { name: 'Chase' } },
  ] as any)
  const user = userEvent.setup()
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  const select = await screen.findByLabelText(/link to an existing position/i)
  await user.selectOptions(select, 'asset-2')
  expect(await screen.findByText('Linked to "My Joint Checking"')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Confirm' }))

  await waitFor(() => {
    expect(executeTool).toHaveBeenCalledWith(
      'update_asset_value',
      { asset_name: 'My Joint Checking', _assetId: 'asset-2', _expectedAssetType: 'Cash', price: 1200 },
      'user-1',
    )
  })
  expect(executeTool).not.toHaveBeenCalledWith('add_cash_asset', expect.anything(), expect.anything())
})

test('a manually-matched lot-based row still requires the duplicate-risk checkbox, and passes _matchedAssetId/_plaidLots through', async () => {
  vi.mocked(listPendingPositions).mockResolvedValue([
    {
      id: 'pending-5',
      plaid_item_id: 'item-1',
      external_account_id: 'ext-account-5',
      external_security_id: 'ext-security-5',
      detected_type: 'stock' as const,
      payload: { symbol: 'MSFT', count: 4, cost_price: 300, purchase_date: '2026-01-01', subtype: 'Market', location_name: 'Schwab' },
      matched_asset_id: null,
      created_at: '2026-09-01T00:00:00Z',
    },
  ])
  vi.mocked(getAllAssets).mockResolvedValue([
    { id: 'asset-msft', name: 'MSFT Stock', asset_type: 'Stock', ticker: { symbol: 'MSFT', kind: 'stock' }, location: { name: 'Fidelity' } },
  ] as any)
  vi.mocked(executeTool).mockResolvedValue({ assetId: 'asset-msft', transactionId: 'txn-9', transactionIds: ['txn-9'] })
  const user = userEvent.setup()
  render(<PlaidReviewModal open={true} onClose={() => {}} />)

  const select = await screen.findByLabelText(/link to an existing position/i)
  await user.selectOptions(select, 'asset-msft')

  const confirmButton = screen.getByRole('button', { name: 'Confirm' })
  expect(confirmButton).toBeDisabled() // manual lot-based matches need the same acknowledgment as automatic ones
  await user.click(screen.getByRole('checkbox'))
  expect(confirmButton).toBeEnabled()
  await user.click(confirmButton)

  await waitFor(() => {
    expect(executeTool).toHaveBeenCalledWith(
      'add_stock_transaction',
      expect.objectContaining({
        symbol: 'MSFT',
        _matchedAssetId: 'asset-msft',
        _plaidLots: [{ count: 4, cost_price: 300, purchase_date: '2026-01-01' }],
      }),
      'user-1',
    )
  })
  expect(recordPlaidSyncLink).toHaveBeenCalledWith(expect.objectContaining({ id: 'pending-5' }), {
    assetId: 'asset-msft',
    transactionId: 'txn-9',
    fixedIncomeLotId: undefined,
  })
})
