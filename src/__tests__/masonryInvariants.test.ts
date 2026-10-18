import { test, expect } from 'vitest'
import { columnsForWidth, packFill, packMasonry, resolveSpan, type MasonrySpan, type PackItem, type Placement } from '@/components/mne/Masonry'
import { mulberry32 } from './helpers/prng'

/**
 * Layout invariants that must hold for ANY cards, widths and column counts —
 * the situations a user creates by resizing the window or changing a card's
 * width. Randomized with fixed seeds, so a failure names the seed to replay.
 */

const SPANS: (MasonrySpan | undefined)[] = [undefined, 1, 2, 3, 'all']
const EPS = 1e-6

type Rect = { l: number; r: number; t: number; b: number }

function rectOf(p: Placement, item: PackItem): Rect {
  return { l: p.column, r: p.column + p.span, t: p.top, b: p.top + Math.max(0, item.height) + (p.stretch ?? 0) }
}
const overlap = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b - EPS && b.t < a.b - EPS

function randomItems(rnd: ReturnType<typeof mulberry32>, max = 9): PackItem[] {
  return Array.from({ length: rnd.int(0, max) }, () => ({
    height: rnd.chance(0.12) ? 0 : rnd.int(20, 420) + (rnd.chance(0.3) ? rnd.next() : 0),
    span: rnd.pick(SPANS),
  }))
}

function check(name: string, pack: typeof packMasonry, seeds: number) {
  test(`${name}: placements never overlap, stay inside the grid and honour spans`, () => {
    for (let seed = 1; seed <= seeds; seed++) {
      const rnd = mulberry32(seed)
      const cols = rnd.int(1, 4)
      const gap = rnd.pick([0, 8, 24, 32])
      const items = randomItems(rnd)
      const { placements, height } = pack(items, cols, gap)
      const tag = `seed ${seed} (cols ${cols}, gap ${gap})`

      expect(placements.length, tag).toBe(items.length)
      const visible: { p: Placement; item: PackItem; rect: Rect }[] = []
      placements.forEach((p, i) => {
        const item = items[i]
        expect(p.hidden, tag).toBe(!(item.height > 0))
        if (p.hidden) return
        expect(p.column, tag).toBeGreaterThanOrEqual(0)
        expect(p.span, tag).toBeGreaterThanOrEqual(1)
        expect(p.column + p.span, tag).toBeLessThanOrEqual(cols)
        expect(p.top, tag).toBeGreaterThanOrEqual(0)
        // A card never takes fewer columns than it asked for (clamped to the grid) — except packFill, which may only widen it.
        expect(p.span, tag).toBeGreaterThanOrEqual(resolveSpan(item.span, cols))
        visible.push({ p, item, rect: rectOf(p, item) })
      })
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          expect(overlap(visible[i].rect, visible[j].rect), `${tag}: items overlap ${JSON.stringify([visible[i].rect, visible[j].rect])}`).toBe(false)
        }
      }
      // The container is exactly as tall as its lowest card: no clipped cards, no phantom space.
      const lowest = visible.length ? Math.max(...visible.map((v) => v.rect.b)) : 0
      expect(Math.abs(height - lowest), `${tag}: height ${height} vs lowest ${lowest}`).toBeLessThan(1e-3)
    }
  })

  test(`${name}: zero-height cards take no space and do not move the others`, () => {
    for (let seed = 1; seed <= seeds; seed++) {
      const rnd = mulberry32(5000 + seed)
      const cols = rnd.int(1, 4)
      const items = randomItems(rnd).map((it) => ({ ...it, height: Math.max(it.height, 30) }))
      if (items.length === 0) continue
      const dropIndex = rnd.int(0, items.length - 1)
      const without = items.filter((_, i) => i !== dropIndex)
      const withZero = items.map((it, i) => (i === dropIndex ? { ...it, height: 0 } : it))
      const a = pack(without, cols, 24)
      const b = pack(withZero, cols, 24)
      const bVisible = b.placements.filter((_, i) => i !== dropIndex)
      expect(bVisible, `seed ${seed}`).toEqual(a.placements)
      expect(b.height, `seed ${seed}`).toBeCloseTo(a.height, 6)
    }
  })

  test(`${name}: packing is deterministic and does not mutate its input`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = mulberry32(9000 + seed)
      const items = randomItems(rnd)
      const snapshot = JSON.stringify(items)
      const first = pack(items, 3, 24)
      expect(JSON.stringify(items)).toBe(snapshot)
      expect(pack(items, 3, 24)).toEqual(first)
    }
  })

  test(`${name}: changing any one card's width keeps the layout valid`, () => {
    for (let seed = 1; seed <= seeds; seed++) {
      const rnd = mulberry32(7000 + seed)
      const cols = rnd.int(1, 4)
      const items = randomItems(rnd).map((it) => ({ ...it, height: Math.max(it.height, 30) }))
      if (items.length === 0) continue
      for (const span of [1, 2, 'all'] as MasonrySpan[]) {
        const changed = items.map((it, i) => (i === 0 ? { ...it, span } : it))
        const { placements } = pack(changed, cols, 24)
        const rects = placements.map((p, i) => rectOf(p, changed[i]))
        for (let i = 0; i < rects.length; i++) {
          expect(placements[i].column + placements[i].span, `seed ${seed} span ${span}`).toBeLessThanOrEqual(cols)
          for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j]), `seed ${seed} span ${span}`).toBe(false)
        }
      }
    }
  })

  test(`${name}: shrinking the grid column by column never overlaps or overflows`, () => {
    for (let seed = 1; seed <= seeds; seed++) {
      const rnd = mulberry32(3000 + seed)
      const items = randomItems(rnd).map((it) => ({ ...it, height: Math.max(it.height, 30) }))
      for (const cols of [4, 3, 2, 1]) {
        const { placements } = pack(items, cols, 24)
        const rects = placements.map((p, i) => rectOf(p, items[i]))
        placements.forEach((p) => expect(p.column + p.span, `seed ${seed} cols ${cols}`).toBeLessThanOrEqual(cols))
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j]), `seed ${seed} cols ${cols}`).toBe(false)
      }
    }
  })
}

check('packMasonry', packMasonry, 250)
check('packFill', packFill, 120)

test('packMasonry keeps cards in reading order within a single column, whatever their widths', () => {
  const items: PackItem[] = [{ height: 50, span: 'all' }, { height: 60, span: 2 }, { height: 70 }, { height: 80, span: 3 }]
  const { placements } = packMasonry(items, 1, 10)
  expect(placements.map((p) => p.top)).toEqual([0, 60, 130, 210])
  expect(placements.every((p) => p.column === 0 && p.span === 1)).toBe(true)
})

test('a card set to full width spans every column at every grid size', () => {
  for (const cols of [1, 2, 3, 4]) {
    const { placements } = packMasonry([{ height: 100 }, { height: 100, span: 'all' }, { height: 100 }], cols, 24)
    expect(placements[1]).toMatchObject({ column: 0, span: cols })
  }
})

test('packFill never leaves more empty space than plain packing', () => {
  const waste = (res: ReturnType<typeof packMasonry>, items: PackItem[], cols: number) =>
    cols * res.height - res.placements.reduce((sum, p, i) => sum + (p.hidden ? 0 : p.span * (items[i].height + (p.stretch ?? 0))), 0)
  for (let seed = 1; seed <= 150; seed++) {
    const rnd = mulberry32(11000 + seed)
    const cols = rnd.int(2, 3)
    const items = randomItems(rnd, 7).map((it) => ({ ...it, height: Math.max(it.height, 40) }))
    // gap 0 so empty space is plain geometry
    expect(waste(packFill(items, cols, 0), items, cols), `seed ${seed}`).toBeLessThanOrEqual(waste(packMasonry(items, cols, 0), items, cols) + 1e-6)
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
        // Each column is at least min wide.
        if (n > 1) expect((w - 24 * (n - 1)) / n).toBeGreaterThanOrEqual(min - 1e-9)
        prev = n
      }
    }
  }
  expect(columnsForWidth(NaN, 300, 24, 3)).toBe(1)
  expect(columnsForWidth(-50, 300, 24, 3)).toBe(1)
})
