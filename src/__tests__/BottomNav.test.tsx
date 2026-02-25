import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import BottomNav from '../layouts/BottomNav'
import { useHasAssets } from '../hooks/useHasAssets'

vi.mock('../hooks/useHasAssets', () => ({
  useHasAssets: vi.fn(),
}))

const mockedUseHasAssets = vi.mocked(useHasAssets)

function renderWithRouter(initialEntry = '/') {
  const router = createMemoryRouter(
    [{ path: '*', element: <BottomNav /> }],
    { initialEntries: [initialEntry] }
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  mockedUseHasAssets.mockReturnValue({ hasAssets: true })
})

test('renders all nav tabs when assets exist', () => {
  renderWithRouter()
  expect(screen.getByText('Home')).toBeInTheDocument()
  expect(screen.getByText('Portfolio')).toBeInTheDocument()
  expect(screen.getByText('Charts')).toBeInTheDocument()
  expect(screen.getByText('Watchlist')).toBeInTheDocument()
  expect(screen.getByText('Settings')).toBeInTheDocument()
})

test('hides portfolio and charts tabs when no assets exist', () => {
  mockedUseHasAssets.mockReturnValue({ hasAssets: false })
  renderWithRouter()
  expect(screen.getByText('Home')).toBeInTheDocument()
  expect(screen.queryByText('Portfolio')).not.toBeInTheDocument()
  expect(screen.queryByText('Charts')).not.toBeInTheDocument()
  expect(screen.getByText('Watchlist')).toBeInTheDocument()
  expect(screen.getByText('Settings')).toBeInTheDocument()
})
