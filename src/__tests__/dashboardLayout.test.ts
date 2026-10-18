import { test, expect } from 'vitest'
import {
  CARD_SPANS, defaultLayout, effectiveColumns, findDropTarget, isDefaultLayout, moveCard, moveRelative,
  resolveLayout, sanitizeLayout, sanitizeLayouts, setCardHidden, setCardSpan, shownPosition, toSavedLayout,
  type CardDef, type CardSpan, type ResolvedCard,
} from '@/lib/dashboardLayout'
import { mulberry32 } from './helpers/prng'

const DEFS: CardDef[] = [
  { id: 'a', label: 'A', span: 2 },
  { id: 'b', label: 'B', span: 1 },
  { id: 'c', label: 'C', span: 'all' },
  { id: 'd', label: 'D', span: 1 },
]
const ids = (cards: readonly { id: string }[]) => cards.map((c) => c.id)

test('no saved layout resolves to the defaults', () => {
  const cards = resolveLayout(DEFS, undefined)
  expect(ids(cards)).toEqual(['a', 'b', 'c', 'd'])
  expect(cards.map((c) => c.span)).toEqual([2, 1, 'all', 1])
  expect(cards.every((c) => !c.hidden && !c.spanCustom)).toBe(true)
  expect(isDefaultLayout(DEFS, cards)).toBe(true)
  expect(defaultLayout(DEFS)).toEqual(cards)
})

test('saved order, hidden flag and width override are applied', () => {
  const cards = resolveLayout(DEFS, [{ id: 'd' }, { id: 'a', span: 1 }, { id: 'c', hidden: true }, { id: 'b' }])
  expect(ids(cards)).toEqual(['d', 'a', 'c', 'b'])
  expect(cards[1]).toMatchObject({ span: 1, spanCustom: true })
  expect(cards[2].hidden).toBe(true)
  expect(isDefaultLayout(DEFS, cards)).toBe(false)
})

test('a card the saved layout has never seen lands right after its default predecessor', () => {
  // saved before "c" existed
  expect(ids(resolveLayout(DEFS, [{ id: 'd' }, { id: 'b' }, { id: 'a' }]))).toEqual(['d', 'b', 'c', 'a'])
  // a new first card goes first
  const withNewFirst: CardDef[] = [{ id: 'z', label: 'Z', span: 1 }, ...DEFS]
  expect(ids(resolveLayout(withNewFirst, [{ id: 'b' }, { id: 'a' }]))).toEqual(['z', 'b', 'c', 'd', 'a'])
})

test('a saved card that no longer exists is dropped, and an empty saved layout is the default', () => {
  expect(ids(resolveLayout(DEFS, [{ id: 'gone' }, { id: 'b' }]))).toEqual(ids(resolveLayout(DEFS, [{ id: 'b' }])))
  expect(ids(resolveLayout(DEFS, [{ id: 'gone' }]))).toEqual(['a', 'b', 'c', 'd'])
  expect(ids(resolveLayout(DEFS, []))).toEqual(['a', 'b', 'c', 'd'])
})

test('sanitizeLayout keeps only well-formed, unique entries', () => {
  expect(sanitizeLayout('nope')).toEqual([])
  expect(sanitizeLayout(null)).toEqual([])
  expect(sanitizeLayout([
    { id: 'a', hidden: true, span: 2 },
    { id: 'a', span: 1 },            // duplicate id
    { id: '', span: 1 },             // empty id
    { id: 7 },                       // non-string id
    { id: 'b', hidden: 'yes', span: 3 }, // bad flag + bad span: id kept, junk ignored
    null, 4, 'x',
    { id: 'c', span: 'all' },
  ])).toEqual([{ id: 'a', hidden: true, span: 2 }, { id: 'b' }, { id: 'c', span: 'all' }])
  expect(sanitizeLayout(Array.from({ length: 500 }, (_, i) => ({ id: `c${i}` }))).length).toBeLessThanOrEqual(64)
})

test('sanitizeLayouts only reads the known pages', () => {
  expect(sanitizeLayouts({ home: [{ id: 'a' }], charts: 'x', other: [{ id: 'q' }] })).toEqual({ home: [{ id: 'a' }], charts: [] })
  expect(sanitizeLayouts([])).toEqual({})
  expect(sanitizeLayouts(undefined)).toEqual({})
})

test('toSavedLayout stores only deviations from the defaults', () => {
  const cards = resolveLayout(DEFS, [{ id: 'b', hidden: true }, { id: 'a', span: 2 /* same as default */ }])
  expect(toSavedLayout(cards)).toEqual([{ id: 'b', hidden: true }, { id: 'c' }, { id: 'd' }, { id: 'a' }])
})

test('moveCard puts the card in the target slot, in both directions, and is a no-op for bad ids', () => {
  const cards = defaultLayout(DEFS)
  expect(ids(moveCard(cards, 'a', 'c'))).toEqual(['b', 'c', 'a', 'd'])
  expect(ids(moveCard(cards, 'd', 'a'))).toEqual(['d', 'a', 'b', 'c'])
  expect(ids(moveCard(cards, 'a', 'a'))).toEqual(ids(cards))
  expect(ids(moveCard(cards, 'a', 'nope'))).toEqual(ids(cards))
  expect(ids(moveCard(cards, 'nope', 'a'))).toEqual(ids(cards))
  // input untouched
  expect(ids(cards)).toEqual(['a', 'b', 'c', 'd'])
})

test('moveRelative skips cards that are not on screen', () => {
  const cards = setCardHidden(defaultLayout(DEFS), 'b', true)
  const shown = (c: ResolvedCard) => !c.hidden
  expect(ids(moveRelative(cards, 'a', 1, shown))).toEqual(['b', 'c', 'a', 'd'])
  expect(ids(moveRelative(cards, 'c', -1, shown))).toEqual(['c', 'a', 'b', 'd'])
  // at an edge: nothing to swap with
  expect(ids(moveRelative(cards, 'a', -1, shown))).toEqual(ids(cards))
  expect(ids(moveRelative(cards, 'd', 1, shown))).toEqual(ids(cards))
})

test('setCardSpan marks a custom width only when it differs from the default', () => {
  const cards = defaultLayout(DEFS)
  const wide = setCardSpan(cards, DEFS, 'b', 2)
  expect(wide.find((c) => c.id === 'b')).toMatchObject({ span: 2, spanCustom: true })
  const back = setCardSpan(wide, DEFS, 'b', 1)
  expect(back.find((c) => c.id === 'b')).toMatchObject({ span: 1, spanCustom: false })
  expect(isDefaultLayout(DEFS, back)).toBe(true)
  expect(setCardSpan(cards, DEFS, 'nope', 2)).toEqual(cards)
  expect(setCardSpan(cards, DEFS, 'b', 5 as unknown as CardSpan)).toEqual(cards)
})

test('a card never takes more columns than the grid has, and narrow grids clamp wide spans', () => {
  for (const cols of [1, 2, 3, 4]) {
    for (const span of CARD_SPANS) {
      const n = effectiveColumns(span, cols)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(cols)
    }
  }
  expect(effectiveColumns(2, 1)).toBe(1)
  expect(effectiveColumns('all', 3)).toBe(3)
  expect(effectiveColumns(2, 3)).toBe(2)
  expect(effectiveColumns(1, 0)).toBe(1)
})

test('shownPosition counts only shown cards', () => {
  const cards = setCardHidden(defaultLayout(DEFS), 'a', true)
  expect(shownPosition(cards, 'c', (c) => !c.hidden)).toEqual({ index: 2, total: 3 })
})

test('findDropTarget picks the other card under the pointer and ignores its own slot', () => {
  const rects = [
    { id: 'a', left: 0, top: 0, right: 100, bottom: 100 },
    { id: 'b', left: 120, top: 0, right: 220, bottom: 100 },
    { id: 'c', left: 0, top: 120, right: 220, bottom: 200 },
  ]
  expect(findDropTarget(rects, 'a', 150, 50)).toBe('b')
  expect(findDropTarget(rects, 'a', 50, 150)).toBe('c')
  expect(findDropTarget(rects, 'a', 50, 50)).toBeNull() // over its own slot
  expect(findDropTarget(rects, 'a', 110, 50)).toBeNull() // in the gap
  expect(findDropTarget(rects, 'a', 500, 500)).toBeNull() // outside everything
  expect(findDropTarget(rects, 'zzz', 50, 50)).toBe('a') // dragged card not in the list: plain hit test
})

// ── randomized: whatever sequence of edits happens, the layout stays well-formed ──────────────────────────

test('random edit sequences always keep every card exactly once and survive a save/load round trip', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const rnd = mulberry32(seed)
    const n = rnd.int(1, 9)
    const defs: CardDef[] = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `C${i}`, span: rnd.pick(CARD_SPANS) }))
    let cards = defaultLayout(defs)
    for (let step = 0; step < 25; step++) {
      const id = rnd.pick(defs).id
      switch (rnd.int(0, 4)) {
        case 0: cards = moveCard(cards, id, rnd.pick(defs).id); break
        case 1: cards = setCardHidden(cards, id, rnd.chance(0.5)); break
        case 2: cards = setCardSpan(cards, defs, id, rnd.pick(CARD_SPANS)); break
        case 3: cards = moveRelative(cards, id, rnd.chance(0.5) ? -1 : 1, (c) => !c.hidden); break
        default: cards = resolveLayout(defs, toSavedLayout(cards)); break
      }
      const label = `seed ${seed} step ${step}`
      expect(ids(cards).slice().sort(), label).toEqual(defs.map((d) => d.id).sort())
      for (const c of cards) {
        expect(CARD_SPANS, label).toContain(c.span)
        expect(c.spanCustom, label).toBe(c.span !== defs.find((d) => d.id === c.id)!.span)
      }
    }
    // save → JSON (what the database stores) → sanitize → resolve gives back the same layout
    const stored = JSON.parse(JSON.stringify(toSavedLayout(cards)))
    expect(resolveLayout(defs, sanitizeLayout(stored)), `seed ${seed}`).toEqual(cards)
  }
})

test('a layout saved against an older set of cards still resolves to a complete, valid one', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rnd = mulberry32(1000 + seed)
    const all = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, span: rnd.pick(CARD_SPANS) }))
    const oldDefs = all.filter(() => rnd.chance(0.7))
    const newDefs = all.filter(() => rnd.chance(0.7))
    let old = defaultLayout(oldDefs)
    for (let i = 0; i < 6 && oldDefs.length > 1; i++) old = moveCard(old, rnd.pick(oldDefs).id, rnd.pick(oldDefs).id)
    const resolved = resolveLayout(newDefs, toSavedLayout(old))
    expect(ids(resolved).slice().sort(), `seed ${seed}`).toEqual(newDefs.map((d) => d.id).sort())
  }
})
