import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppLayout from '../layouts/AppLayout'

test('renders app layout', () => {
  render(
    <MemoryRouter>
      <AppLayout />
    </MemoryRouter>
  )
  // BottomNav should be present
  expect(screen.getByText('Home')).toBeInTheDocument()
})
