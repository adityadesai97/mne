import { test, expect } from 'vitest'
import { columnsForWidth, packRows, resolveSpan, type MasonrySpan, type PackItem, type Placement } from '@/components/mne/Masonry'
import { mulberry32 } from './helpers/prng'

/**
 * Layout invariants that must hold for ANY cards, widths and column counts —
 * the situations a user creates by resizing the window or changing a card's
 * width. Randomized with fixed seeds, so a failure names the seed to replay.
 */

const SPANS: (MasonrySpan | undefined)[] = [undefined, 1, 2, 3, 'all']
const E = 1e-6

type Rect = { l: number; r: number; t: number; b: number }
const rectOf = (p: Placement, item: PackItem): Rect => ({ l: p.column, r: p.column + p.span, t: p.top, b: p.top + Math.max(0, item.height) + (p.stretch ?? 0) })
const overlap = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b - E && b.t < a.b - E

function randomItems(rnd: ReturnType<typeof mulberry32>, max = 10): PackItem[] {
  return Array.from({ length: rnd.int(0, max) }, () => ({
    height: rnd.chance(0.12) ? 0 : rnd.int(20, 420) + (rnd.chance(0.3) ? rnd.next() : 0),
    span: rnd.pick(SPANS),
  }))
}

/** Rows of visible cards, grouped by top, in top order. */
function rowsOf(items: PackItem[], placements: Placement[]) {
  const rows = new Map<number, { p: Placement; i: number }[]>()
  placements.forEach((p, i) => { if (!p.hidden) rows.set(p.top, [...(rows.get(p.top) ?? []), { p, i }]) })
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([top, cells]) => ({ top, cells, items }))
}

test('placements never overlap, stay inside the grid and cover at least the width asked for', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = mulberry32(seed)
    const cols = rnd.int(1, 4)
    const gap = rnd.pick([0, 8, 24, 32])
    const items = randomItems(rnd)
    const { placements, height } = packRows(items, cols, gap)
    const tag = `seed ${seed} (cols ${cols}, gap ${gap})`

    expect(placements.length, tag).toBe(items.length)
    const visible: { p: Placement; rect: Rect }[] = []
    placements.forEach((p, i) => {
      expect(p.hidden, tag).toBe(!(items[i].height > 0))
      if (p.hidden) return
      expect(p.column, tag).toBeGreaterThanOrEqual(0)
      expect(p.column + p.span, tag).toBeLessThanOrEqual(cols)
      expect(p.span, tag).toBeGreaterThanOrEqual(resolveSpan(items[i].span, cols)) // only ever widened
      expect(p.top, tag).toBeGreaterThanOrEqual(0)
      visible.push({ p, rect: rectOf(p, items[i]) })
    })
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        expect(overlap(visible[i].rect, visible[j].rect), `${tag}: ${JSON.stringify([visible[i].rect, visible[j].rect])}`).toBe(false)
      }
    }
    const lowest = visible.length ? Math.max(...visible.map((v) => v.rect.b)) : 0
    expect(Math.abs(height - lowest), `${tag}: height ${height} vs lowest ${lowest}`).toBeLessThan(1e-3)
  }
})

test('it is a real grid: cards in a row share one top and one bottom, and rows are exactly `gap` apart', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = mulberry32(2000 + seed)
    const cols = rnd.int(2, 4)
    const gap = rnd.pick([0, 8, 24])
    const items = randomItems(rnd)
    const { placements } = packRows(items, cols, gap)
    const rows = rowsOf(items, placements)
    let expectedTop = 0
    rows.forEach((row, n) => {
      const tag = `seed ${seed} row ${n}`
      expect(row.top, tag).toBeCloseTo(expectedTop, 6)
      const bottoms = row.cells.map(({ p, i }) => rectOf(p, items[i]).b)
      for (const b of bottoms) expect(b, tag).toBeCloseTo(bottoms[0], 6)
      // the row is as tall as its tallest card, which is not stretched
      expect(Math.max(...row.cells.map(({ i }) => items[i].height)) + row.top, tag).toBeCloseTo(bottoms[0], 6)
      expectedTop = bottoms[0] + gap
    })
  }
})

test('every row, the last included, spans the full width with no gaps between cards', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = mulberry32(4000 + seed)
    const cols = rnd.int(2, 4)
    const items = randomItems(rnd)
    const rows = rowsOf(items, packRows(items, cols, 24).placements)
    rows.forEach((row, n) => {
      const used = row.cells.reduce((sum, { p }) => sum + p.span, 0)
      expect(used, `seed ${seed} row ${n}`).toBe(cols)
      // cells in a row sit side by side with no gaps between columns
      let next = 0
      row.cells.sort((a, b) => a.p.column - b.p.column).forEach(({ p }) => { expect(p.column, `seed ${seed}`).toBe(next); next += p.span })
    })
  }
})

test('feeding the resulting widths back in changes nothing (the component re-measures widened cards)', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = mulberry32(6000 + seed)
    const cols = rnd.int(1, 4)
    const items = randomItems(rnd)
    const first = packRows(items, cols, 24)
    const widened = items.map((it, i) => (first.placements[i].hidden ? it : { ...it, span: first.placements[i].span }))
    const second = packRows(widened, cols, 24)
    expect(second.placements.map((p) => [p.hidden, p.column, p.span, p.top]), `seed ${seed}`).toEqual(first.placements.map((p) => [p.hidden, p.column, p.span, p.top]))
  }
})

test('grouping depends only on spans and order, never on heights', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = mulberry32(8000 + seed)
    const cols = rnd.int(1, 4)
    const items = randomItems(rnd).map((it) => ({ ...it, height: Math.max(it.height, 30) }))
    const reheighted = items.map((it) => ({ ...it, height: rnd.int(10, 500) }))
    const a = packRows(items, cols, 24).placements.map((p) => [p.column, p.span])
    const b = packRows(reheighted, cols, 24).placements.map((p) => [p.column, p.span])
    expect(b, `seed ${seed}`).toEqual(a)
  }
})

test('zero-height cards take no space and do not move the others', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = mulberry32(5000 + seed)
    const cols = rnd.int(1, 4)
    const items = randomItems(rnd).map((it) => ({ ...it, height: Math.max(it.height, 30) }))
    if (items.length === 0) continue
    const drop = rnd.int(0, items.length - 1)
    const without = items.filter((_, i) => i !== drop)
    const withZero = items.map((it, i) => (i === drop ? { ...it, height: 0 } : it))
    const a = packRows(without, cols, 24)
    const b = packRows(withZero, cols, 24)
    expect(b.placements.filter((_, i) => i !== drop), `seed ${seed}`).toEqual(a.placements)
    expect(b.height, `seed ${seed}`).toBeCloseTo(a.height, 6)
  }
})

test('packing is deterministic and does not mutate its input', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = mulberry32(9000 + seed)
    const items = randomItems(rnd)
    const snapshot = JSON.stringify(items)
    const first = packRows(items, 3, 24)
    expect(JSON.stringify(items)).toBe(snapshot)
    expect(packRows(items, 3, 24)).toEqual(first)
  }
})

test('changing any one card to any width keeps the grid valid', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = mulberry32(7000 + seed)
    const cols = rnd.int(1, 4)
    const items = randomItems(rnd).map((it) => ({ ...it, height: Math.max(it.height, 30) }))
    if (items.length === 0) continue
    for (const span of [1, 2, 'all'] as MasonrySpan[]) {
      const changed = items.map((it, i) => (i === 0 ? { ...it, span } : it))
      const { placements } = packRows(changed, cols, 24)
      const rects = placements.map((p, i) => rectOf(p, changed[i]))
      for (let i = 0; i < rects.length; i++) {
        expect(placements[i].column + placements[i].span, `seed ${seed} span ${span}`).toBeLessThanOrEqual(cols)
        for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j]), `seed ${seed} span ${span}`).toBe(false)
      }
    }
  }
})

test('shrinking the grid column by column stays valid at every size', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = mulberry32(3000 + seed)
    const items = randomItems(rnd).map((it) => ({ ...it, height: Math.max(it.height, 30) }))
    for (const cols of [4, 3, 2, 1]) {
      const { placements } = packRows(items, cols, 24)
      const rects = placements.map((p, i) => rectOf(p, items[i]))
      placements.forEach((p) => expect(p.column + p.span, `seed ${seed} cols ${cols}`).toBeLessThanOrEqual(cols))
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j]), `seed ${seed} cols ${cols}`).toBe(false)
    }
  }
})

test('with equal one-column cards the order is plain row-major', () => {
  for (const cols of [1, 2, 3, 4]) {
    const items = Array.from({ length: 9 }, () => ({ height: 100 }))
    const { placements } = packRows(items, cols, 24)
    placements.forEach((p, i) => { expect(p.column).toBe(i % cols); expect(p.top).toBe(Math.floor(i / cols) * 124) })
  }
})

test('a card set to full width spans every column at every grid size', () => {
  for (const cols of [1, 2, 3, 4]) {
    const { placements } = packRows([{ height: 100 }, { height: 100, span: 'all' }, { height: 100 }], cols, 24)
    expect(placements[1]).toMatchObject({ column: 0, span: cols })
  }
})

test('column count is monotonic in container width and always inside [1, max]', () => {
  for (const max of [1, 2, 3, 4]) {
    for (const min of [240, 300, 360]) {
      let prev = 1
      for (let w = 0; w <= 2400; w += 7) {
        const n = columnsForWidth(w, min, 24, max)
        expect(n).toBeGreaterThanOrEqual(1)
        expect(n).toBeLessThanOrEqual(max)
        expect(n, `width ${w}`).toBeGreaterThanOrEqual(prev)
        if (n > 1) expect((w - 24 * (n - 1)) / n).toBeGreaterThanOrEqual(min - 1e-9)
        prev = n
      }
    }
  }
  expect(columnsForWidth(NaN, 300, 24, 3)).toBe(1)
  expect(columnsForWidth(-50, 300, 24, 3)).toBe(1)
})
