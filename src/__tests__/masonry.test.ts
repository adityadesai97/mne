import { test, expect } from 'vitest'
import { packRows, columnsForWidth, resolveSpan } from '@/components/mne/Masonry'

const tops = (r: ReturnType<typeof packRows>) => r.placements.map((p) => p.top)
const cols = (r: ReturnType<typeof packRows>) => r.placements.map((p) => p.column)
/** Height each card ends up with (its own plus the stretch to its row). */
const heights = (r: ReturnType<typeof packRows>, items: { height: number }[]) => r.placements.map((p, i) => items[i].height + (p.stretch ?? 0))

test('single column stacks in order with gaps', () => {
  const { placements, height } = packRows([{ height: 100 }, { height: 50 }, { height: 20 }], 1, 10)
  expect(placements.map((p) => p.top)).toEqual([0, 110, 170])
  expect(height).toBe(190)
})

test('cards in a row share the row height and the next row starts below it', () => {
  const items = [{ height: 100 }, { height: 160 }, { height: 40 }, { height: 70 }, { height: 90 }]
  const r = packRows(items, 3, 20)
  expect(cols(r)).toEqual([0, 1, 2, 0, 1])
  expect(tops(r)).toEqual([0, 0, 0, 180, 180])
  expect(heights(r, items)).toEqual([160, 160, 160, 90, 90])
  expect(r.height).toBe(180 + 90)
})

test('the tallest card in a row is not stretched', () => {
  const r = packRows([{ height: 100 }, { height: 160 }], 2, 0)
  expect(r.placements[1].stretch).toBeUndefined()
  expect(r.placements[0].stretch).toBe(60)
})

test('a wide card shares its row with the cards that fit beside it', () => {
  const items = [{ height: 300, span: 2 as const }, { height: 120 }, { height: 200 }, { height: 80 }]
  const r = packRows(items, 3, 24)
  expect(r.placements[0]).toMatchObject({ column: 0, span: 2, top: 0 })
  expect(r.placements[1]).toMatchObject({ column: 2, span: 1, top: 0 })
  expect(heights(r, items).slice(0, 2)).toEqual([300, 300])
  expect(r.placements[2].top).toBe(324)
})

test('a full-width card gets a row to itself', () => {
  const r = packRows([{ height: 100 }, { height: 50, span: 'all' }, { height: 100, span: 'all' }], 3, 10)
  expect(r.placements[0]).toMatchObject({ column: 0, span: 3, top: 0 }) // alone in its row, so it widens to the edge
  expect(r.placements[1]).toMatchObject({ column: 0, span: 3, top: 110 })
  expect(r.placements[2]).toMatchObject({ column: 0, span: 3, top: 170 })
})

test('a later card that fits is pulled into the space left in a row; the skipped card keeps its turn', () => {
  // row 1: [2-wide][?] — the next card is 2-wide and does not fit, the 1-wide after it does
  const items = [{ height: 100, span: 2 as const }, { height: 100, span: 2 as const }, { height: 60 }]
  const r = packRows(items, 3, 0)
  expect(r.placements[2]).toMatchObject({ column: 2, top: 0 })
  expect(r.placements[1]).toMatchObject({ column: 0, top: 100 })
})

test('a row that cannot be filled widens its last card to the edge, the final row included', () => {
  // 2 columns: [1][all][all] -> nothing later fits beside the first card, so it widens
  const r = packRows([{ height: 50 }, { height: 50, span: 'all' }, { height: 50, span: 'all' }], 2, 0)
  expect(r.placements[0]).toMatchObject({ column: 0, span: 2, top: 0 })
  // a lone 1-wide card in the last row also fills it
  const last = packRows([{ height: 50, span: 'all' }, { height: 50 }], 2, 0)
  expect(last.placements[1]).toMatchObject({ column: 0, span: 2, top: 50 })
  // and so does a short last row of several cards: the final card takes the leftover
  const three = packRows([{ height: 50 }, { height: 50 }, { height: 50 }, { height: 50 }], 3, 0)
  expect(three.placements.map((p) => [p.column, p.span])).toEqual([[0, 1], [1, 1], [2, 1], [0, 3]])
})

test('zero-height cards are hidden and add no gap', () => {
  const { placements, height } = packRows([{ height: 10 }, { height: 0 }, { height: 10 }], 1, 24)
  expect(placements[1].hidden).toBe(true)
  expect(placements[2].top).toBe(34)
  expect(height).toBe(44)
  expect(packRows([], 3, 24).height).toBe(0)
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

test('sub-pixel height noise never changes which cards share a row or their order', () => {
  const base = [{ height: 400, span: 2 as const }, { height: 134 }, { height: 600, span: 'all' as const }, { height: 138 }, { height: 138 }, { height: 138 }]
  const ref = packRows(base, 3, 24)
  for (const noise of [0.01, -0.01, 0.4, -0.4]) {
    const r = packRows(base.map((it, i) => ({ ...it, height: it.height + (i % 2 ? noise : -noise) })), 3, 24)
    expect(cols(r)).toEqual(cols(ref))
    expect(r.placements.map((p) => p.span)).toEqual(ref.placements.map((p) => p.span))
  }
})
