import { render, screen, fireEvent } from '@testing-library/react'
import { test, expect } from 'vitest'
import { LineChart, Sparkline, StackBreakdown, DivergingBars, capSegments, RsuVestChart } from '../components/mne/charts'
import type { RsuTimelineRow } from '../lib/charts'

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

const D = (iso: string) => new Date(iso).getTime()
const rsuRow = (o: Partial<RsuTimelineRow> = {}): RsuTimelineRow => ({
  label: 'NVDA · 11/23/2024', symbol: 'NVDA', vestedShares: 175, totalShares: 400, ended: false,
  grantMs: D('2024-11-23'), startMs: D('2024-11-23'), endMs: D('2028-11-23'), todayMs: D('2026-10-16'),
  cliffMs: D('2025-11-23'), hasCliff: true, frequency: 'quarterly', events: [],
  nextVest: { ms: D('2026-11-23'), shares: 25 }, endedMs: null, forfeitedShares: 0, ...o,
})

test('RsuVestChart summarises the bar in shares with the next vest, and shows a hatched next slice', () => {
  const { container } = render(<RsuVestChart rows={[rsuRow()]} />)
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain('175 of 400 shares vested (44%), next vest 25 shares on Nov 23, 2026')
  expect(container.querySelector('.mne-rsu-bar .n')).not.toBeNull()
  expect(screen.getByText('1-year cliff')).toBeTruthy()
})

test('RsuVestChart: ended grant shows forfeited region and Ended pill, no next slice', () => {
  const { container } = render(<RsuVestChart rows={[rsuRow({ ended: true, endedMs: D('2026-06-01'), nextVest: null, vestedShares: 90, totalShares: 120, forfeitedShares: 30 })]} />)
  expect(container.querySelector('.mne-rsu-bar .f')).not.toBeNull()
  expect(container.querySelector('.mne-rsu-bar .n')).toBeNull()
  expect(screen.getByText('Ended Jun 1')).toBeTruthy()
  expect(screen.getByText('30 shares forfeited')).toBeTruthy()
})

test('RsuVestChart: continuous and fully vested grants have no hatched slice', () => {
  const { container } = render(<RsuVestChart rows={[
    rsuRow({ frequency: 'continuous', hasCliff: false, nextVest: null }),
    rsuRow({ vestedShares: 400, nextVest: null }),
  ]} />)
  expect(container.querySelector('.mne-rsu-bar .n')).toBeNull()
  expect(screen.getByText('Fully vested')).toBeTruthy()
  expect(screen.getByText('Vests continuously')).toBeTruthy()
})

test('RsuVestChart hideValues drops the focusable tooltip targets', () => {
  const { container } = render(<RsuVestChart rows={[rsuRow()]} hideValues />)
  expect(container.querySelector('.mne-rsu-bar i[tabindex]')).toBeNull()
})
