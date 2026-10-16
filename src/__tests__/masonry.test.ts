import { test, expect } from 'vitest'
import { packMasonry, columnsForWidth, resolveSpan } from '@/components/mne/Masonry'

test('single column stacks in order with gaps', () => {
  const { placements, height } = packMasonry([{ height: 100 }, { height: 50 }, { height: 20 }], 1, 10)
  expect(placements.map(p => p.top)).toEqual([0, 110, 170])
  expect(height).toBe(190)
})

test('shortest column first, ties go left', () => {
  const { placements, height } = packMasonry(
    [{ height: 100 }, { height: 40 }, { height: 40 }, { height: 40 }], 2, 0)
  expect(placements.map(p => p.column)).toEqual([0, 1, 1, 1])
  expect(placements.map(p => p.top)).toEqual([0, 0, 40, 80])
  expect(height).toBe(120)
})

test('zero-height items are hidden and add no gap', () => {
  const { placements, height } = packMasonry([{ height: 10 }, { height: 0 }, { height: 10 }], 1, 24)
  expect(placements[1].hidden).toBe(true)
  expect(placements[2].top).toBe(34)
  expect(height).toBe(44)
  expect(packMasonry([], 3, 24).height).toBe(0)
})

test('span all starts below every column', () => {
  const { placements } = packMasonry([{ height: 100 }, { height: 30 }, { height: 50, span: 'all' }], 2, 0)
  expect(placements[2]).toMatchObject({ column: 0, span: 2, top: 100 })
})

test('a wide item pulls later small items forward to fill the hole above it', () => {
  const items = [{ height: 200 }, { height: 80 }, { height: 60, span: 'all' as const }, { height: 100 }, { height: 100 }]
  const { placements } = packMasonry(items, 2, 0)
  // item 3 (100) fits under item 1 (80+100=180 <= 200) instead of leaving a hole
  expect(placements[3]).toMatchObject({ column: 1, top: 80 })
  expect(placements[2].top).toBe(200)
  // pulling item 4 as well would push the wide item down, so it goes after
  expect(placements[4].top).toBeGreaterThanOrEqual(260)
})

test('two-of-three span picks the lowest pair', () => {
  const { placements } = packMasonry([{ height: 50 }, { height: 50 }, { height: 50 }, { height: 30, span: 2 }], 3, 0)
  expect(placements[3]).toMatchObject({ column: 0, span: 2, top: 50 })
})

test('span is clamped to the column count', () => {
  expect(resolveSpan(3, 2)).toBe(2)
  expect(resolveSpan('all', 3)).toBe(3)
  expect(resolveSpan(undefined, 3)).toBe(1)
})

test('column count follows container width', () => {
  expect(columnsForWidth(0, 300, 24, 3)).toBe(1)
  expect(columnsForWidth(342, 300, 24, 3)).toBe(1)
  expect(columnsForWidth(912, 300, 24, 3)).toBe(2)
  expect(columnsForWidth(1152, 300, 24, 3)).toBe(3)
  expect(columnsForWidth(3000, 300, 24, 3)).toBe(3)
})
