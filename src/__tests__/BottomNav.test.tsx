import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import BottomNav from '../layouts/BottomNav'

function renderWithRouter(initialEntry = '/') {
  const router = createMemoryRouter(
    [{ path: '*', element: <BottomNav /> }],
    { initialEntries: [initialEntry] }
  )
  return render(<RouterProvider router={router} />)
}

test('renders all nav tabs', () => {
  renderWithRouter()
  expect(screen.getByText('Home')).toBeInTheDocument()
  expect(screen.getByText('Portfolio')).toBeInTheDocument()
  expect(screen.getByText('Charts')).toBeInTheDocument()
  expect(screen.getByText('Watchlist')).toBeInTheDocument()
  expect(screen.getByText('Settings')).toBeInTheDocument()
})
