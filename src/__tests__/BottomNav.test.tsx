import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import BottomNav from '../layouts/BottomNav'
import TopBar from '../layouts/TopBar'
import { useHasAssets } from '../hooks/useHasAssets'

vi.mock('../hooks/useHasAssets', () => ({
  useHasAssets: vi.fn(),
}))

const mockedUseHasAssets = vi.mocked(useHasAssets)

function renderWithRouter(element: React.ReactElement, initialEntry = '/') {
  const router = createMemoryRouter(
    [{ path: '*', element }],
    { initialEntries: [initialEntry] }
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  mockedUseHasAssets.mockReturnValue({ hasAssets: true })
})

test('renders four nav tabs plus the raised Ask action, with Settings moved out of the bar', () => {
  renderWithRouter(<BottomNav onAsk={() => {}} />)
  expect(screen.getByText('Home')).toBeInTheDocument()
  expect(screen.getByText('Portfolio')).toBeInTheDocument()
  expect(screen.getByText('Charts')).toBeInTheDocument()
  expect(screen.getByText('Watchlist')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ask mne' })).toBeInTheDocument()
  expect(screen.queryByText('Settings')).not.toBeInTheDocument()
})

test('the Ask action sits between the second and third tab and opens the command bar', async () => {
  const onAsk = vi.fn()
  renderWithRouter(<BottomNav onAsk={onAsk} />)
  const nav = screen.getByRole('navigation', { name: 'Main' })
  const order = Array.from(nav.children).map(el => el.textContent || el.getAttribute('aria-label'))
  expect(order).toEqual(['Home', 'Portfolio', 'Ask mne', 'Charts', 'Watchlist'])
  await userEvent.click(screen.getByRole('button', { name: 'Ask mne' }))
  expect(onAsk).toHaveBeenCalledTimes(1)
})

test('hides portfolio and charts tabs when no assets exist', () => {
  mockedUseHasAssets.mockReturnValue({ hasAssets: false })
  renderWithRouter(<BottomNav onAsk={() => {}} />)
  expect(screen.getByText('Home')).toBeInTheDocument()
  expect(screen.queryByText('Portfolio')).not.toBeInTheDocument()
  expect(screen.queryByText('Charts')).not.toBeInTheDocument()
  expect(screen.getByText('Watchlist')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ask mne' })).toBeInTheDocument()
})

test('the header pill opens the command bar and advertises the shortcut', async () => {
  const onAsk = vi.fn()
  renderWithRouter(<TopBar onAsk={onAsk} open={false} controlsId="cmdk-panel" />)
  const pill = screen.getByRole('button', { name: 'Ask or search' })
  expect(pill).toHaveAttribute('aria-expanded', 'false')
  expect(pill).toHaveAttribute('aria-controls', 'cmdk-panel')
  expect(pill).toHaveTextContent(/Ask or search/)
  expect(pill).toHaveTextContent(/⌘K|Ctrl K/)
  await userEvent.click(pill)
  expect(onAsk).toHaveBeenCalledTimes(1)
})

test('the phone header has one menu button that leads to Settings and the account options', async () => {
  const user = userEvent.setup()
  renderWithRouter(<TopBar onAsk={() => {}} open={false} controlsId="cmdk-panel" />)
  expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Account and settings' }))
  expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
})
