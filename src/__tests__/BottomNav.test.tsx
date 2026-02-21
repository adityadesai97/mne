import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNav from '../layouts/BottomNav'

test('renders all nav tabs', () => {
  render(<MemoryRouter><BottomNav /></MemoryRouter>)
  expect(screen.getByText('Home')).toBeInTheDocument()
  expect(screen.getByText('Portfolio')).toBeInTheDocument()
  expect(screen.getByText('Tax')).toBeInTheDocument()
  expect(screen.getByText('Watchlist')).toBeInTheDocument()
  expect(screen.getByText('Settings')).toBeInTheDocument()
})
