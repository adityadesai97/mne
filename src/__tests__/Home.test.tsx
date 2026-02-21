// src/__tests__/Home.test.tsx
import { render, screen } from '@testing-library/react'
import { NetWorthCard } from '../components/NetWorthCard'

test('displays net worth with gain', () => {
  render(<NetWorthCard value={100000} gainLoss={5000} gainLossPercent={5.26} />)
  expect(screen.getByText('Net Worth')).toBeInTheDocument()
  expect(screen.getByText(/100,000/)).toBeInTheDocument()
  expect(screen.getByText(/\+\$5,000/)).toBeInTheDocument()
})

test('displays net worth with loss', () => {
  render(<NetWorthCard value={90000} gainLoss={-10000} gainLossPercent={-10} />)
  expect(screen.getByText(/-\$10,000/)).toBeInTheDocument()
})
