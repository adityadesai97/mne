import { render, screen, fireEvent } from '@testing-library/react'
import { test, expect } from 'vitest'
import { LineChart, Sparkline, StackBreakdown, DivergingBars, capSegments } from '../components/mne/charts'

test('LineChart shows a tooltip with value, label and signed change on hover', () => {
  const { container } = render(<LineChart values={[100, 110, 120]} labels={['a', 'b', 'c']} ariaLabel="demo" />)
  const plot = container.querySelector('.mne-plot')!
  fireEvent.pointerMove(plot, { clientX: 0 })
  expect(plot.className).toContain('is-hover')
  expect(container.querySelector('.mne-tip')!.textContent).toContain('$100')
})

test('Sparkline colours by direction', () => {
  const { container } = render(<Sparkline values={[3, 2, 1]} ariaLabel="down" />)
  expect(container.querySelector('path')!.getAttribute('stroke')).toContain('loss')
})

test('StackBreakdown labels every segment with share and amount', () => {
  render(<StackBreakdown label="x" segments={[{ name: 'Stocks', value: 75 }, { name: 'Cash', value: 25 }]} />)
  expect(screen.getByText('Stocks')).toBeTruthy()
  expect(screen.getByText('75%')).toBeTruthy()
})

test('DivergingBars pairs colour with arrow and sign', () => {
  render(<DivergingBars rows={[{ name: 'A', value: -50 }, { name: 'B', value: 100 }]} />)
  expect(screen.getByText('▼ −$50')).toBeTruthy()
  expect(screen.getByText('▲ +$100')).toBeTruthy()
})

test('capSegments folds the tail into Other', () => {
  const out = capSegments(Array.from({ length: 7 }, (_, i) => ({ name: `n${i}`, value: i + 1 })))
  expect(out).toHaveLength(5)
  expect(out[4].name).toBe('Other')
})
