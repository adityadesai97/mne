import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DashboardEditButton, DashboardGrid } from '@/components/mne/DashboardGrid'
import { useDashboardLayout } from '@/hooks/useDashboardLayout'
import type { CardDef, LayoutEntry } from '@/lib/dashboardLayout'

const store = vi.hoisted(() => ({
  cached: undefined as LayoutEntry[] | undefined,
  remote: {} as Record<string, LayoutEntry[]>,
  save: vi.fn(async (_page: string, _layout: LayoutEntry[]) => {}),
}))
vi.mock('@/lib/db/dashboardLayouts', () => ({
  getCachedDashboardLayout: () => store.cached,
  loadDashboardLayouts: () => Promise.resolve({ ...(store.cached ? { home: store.cached } : {}), ...store.remote }),
  saveDashboardLayout: (page: string, layout: LayoutEntry[]) => store.save(page, layout),
}))
vi.mock('@/lib/appAlerts', () => ({ showAppAlert: vi.fn() }))

// ── a fake layout engine: jsdom has none, so give elements the sizes the app would measure ─────────────────

let containerWidth = 1152
const GAP = 24
const EDIT_BAR = 48 // the per-card edit bar + its gap, added above a card in edit mode

class FakeResizeObserver {
  static all = new Set<FakeResizeObserver>()
  active = true
  constructor(private cb: () => void) { FakeResizeObserver.all.add(this) }
  observe() {}
  unobserve() {}
  disconnect() { this.active = false; FakeResizeObserver.all.delete(this) }
  fire() { if (this.active) this.cb() }
}
const fireResize = () => act(() => { [...FakeResizeObserver.all].forEach((o) => o.fire()) })

const num = (s: string) => parseFloat(s) || 0
function rectOf(el: HTMLElement) {
  const t = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform)
  const f = /^([-\d.]+)px ([-\d.]+)px$/.exec(el.style.translate || '')
  const inner = el.querySelector<HTMLElement>('[data-h]')
  // The packer clears the height before measuring and sets the row's height afterwards: honour both.
  const natural = (inner ? num(inner.dataset.h!) : 0) + (el.querySelector('.mne-dash-frame') ? EDIT_BAR : 0)
  const height = el.style.height ? num(el.style.height) : natural
  const left = (t ? num(t[1]) : 0) + (f ? num(f[1]) : 0)
  const top = (t ? num(t[2]) : 0) + (f ? num(f[2]) : 0)
  const width = num(el.style.width)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

beforeEach(() => {
  containerWidth = 1152
  store.cached = undefined
  store.remote = {}
  store.save.mockClear()
  FakeResizeObserver.all.clear()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) { return this.classList.contains('mne-masonry') ? containerWidth : 0 },
  })
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains('mne-masonry-item')) return rectOf(this)
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  }
  if (typeof window.PointerEvent === 'undefined') {
    // jsdom has no PointerEvent: a MouseEvent carries the same coordinates.
    vi.stubGlobal('PointerEvent', class extends MouseEvent {})
  }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────

const DEFS: readonly CardDef[] = [
  { id: 'hero', label: 'Hero', span: 2 },
  { id: 'alloc', label: 'Allocation', span: 1 },
  { id: 'pulse', label: 'Pulse', span: 'all' },
  { id: 'movers', label: 'Movers', span: 1 },
  { id: 'pnl', label: 'P&L', span: 1 },
]
const card = (id: string, h: number) => <section className="mne-card" data-h={h} data-testid={`card-${id}`}>{id}</section>
const NODES: Record<string, ReactNode> = {
  hero: card('hero', 300), alloc: card('alloc', 200), pulse: card('pulse', 120), movers: card('movers', 180), pnl: card('pnl', 100),
}

function Host({ nodes = NODES }: { nodes?: Record<string, ReactNode> }) {
  const dash = useDashboardLayout('home', DEFS)
  return (<><DashboardEditButton dash={dash} /><DashboardGrid dash={dash} nodes={nodes} /></>)
}

/** Render and let the async layout load settle, as the app would after its first paint. */
async function mount(ui: ReactNode) {
  let result!: ReturnType<typeof render>
  await act(async () => { result = render(ui) })
  return result
}

const grid = () => document.querySelector<HTMLElement>('.mne-masonry')!
const items = () => Array.from(grid().querySelectorAll<HTMLElement>(':scope > .mne-masonry-item'))
const order = () => items().map((el) => (el.querySelector('[data-testid]') as HTMLElement).dataset.testid!.replace('card-', ''))
const lastSave = () => store.save.mock.calls.at(-1)?.[1]

async function edit() {
  fireEvent.click(screen.getByRole('button', { name: /edit layout/i }))
  await screen.findByRole('region', { name: /layout editor/i })
}

/** Every card sits inside the grid and no two overlap — the property a bad resize breaks. */
function expectSoundLayout(label = '') {
  const container = containerWidth
  const rects = items().map(rectOf)
  rects.forEach((r, i) => {
    expect(r.left, `${label} card ${i} left`).toBeGreaterThanOrEqual(-0.5)
    expect(r.right, `${label} card ${i} right edge ${r.right} vs container ${container}`).toBeLessThanOrEqual(container + 0.5)
    expect(r.height, `${label} card ${i} height`).toBeGreaterThan(0)
  })
  // A real grid: cards that share a top share a bottom too (a row has one height).
  if (grid().dataset.columns !== '1') {
    const byTop = new Map<number, number[]>()
    rects.forEach((r) => byTop.set(Math.round(r.top), [...(byTop.get(Math.round(r.top)) ?? []), r.bottom]))
    for (const [top, bottoms] of byTop) for (const b of bottoms) expect(b, `${label} row at ${top}: cards end at different heights ${bottoms}`).toBeCloseTo(bottoms[0], 0)
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j]
      const overlap = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
      expect(overlap, `${label} cards ${i} and ${j} overlap`).toBe(false)
    }
  }
}

// ── sizing ─────────────────────────────────────────────────────────────────────────────────────────────────

test('three columns: each card gets the width of its span, nothing overlaps', async () => {
  await mount(<Host />)
  expect(grid().dataset.columns).toBe('3')
  const colW = (1152 - 2 * GAP) / 3
  expect(items().map((el) => Math.round(rectOf(el).width))).toEqual([
    Math.round(2 * colW + GAP), // hero: 2 columns
    Math.round(colW),           // alloc: 1
    1152,                       // pulse: all
    Math.round(colW),           // movers
    Math.round(2 * colW + GAP), // pnl: alone in the last row beside movers, so it widens to close the row
  ])
  expectSoundLayout()
})

test('resizing the window 3 → 2 → 1 columns re-clamps every card and never overlaps or overflows', async () => {
  await mount(<Host />)
  expectSoundLayout('3 cols')

  containerWidth = 700
  fireResize()
  expect(grid().dataset.columns).toBe('2')
  const colW2 = (700 - GAP) / 2
  expect(Math.round(rectOf(items()[0]).width)).toBe(700) // a 2-wide card fills a 2-column grid
  expect(Math.round(rectOf(items()[1]).width)).toBe(Math.round(colW2))
  expectSoundLayout('2 cols')

  containerWidth = 380
  fireResize()
  expect(grid().dataset.columns).toBe('1')
  expect(grid().classList.contains('is-packed')).toBe(false) // plain flow: no inline sizes left behind
  items().forEach((el) => { expect(el.style.width).toBe(''); expect(el.style.transform).toBe('') })

  containerWidth = 1200
  fireResize()
  expect(grid().dataset.columns).toBe('3')
  expectSoundLayout('back to 3 cols')
})

test('sweeping the container width finds no overlapping or overflowing layout at any size', async () => {
  await mount(<Host />)
  for (let w = 1400; w >= 320; w -= 37) {
    containerWidth = w
    fireResize()
    expectSoundLayout(`width ${w}`)
  }
  for (let w = 320; w <= 1400; w += 53) {
    containerWidth = w
    fireResize()
    expectSoundLayout(`width ${w}`)
  }
})

test('changing a card to another width resizes it, the rows reflow around it, and setting it back restores the original layout', async () => {
  await mount(<Host />)
  const widths = () => Object.fromEntries(order().map((id, i) => [id, Math.round(rectOf(items()[i]).width)]))
  const before = widths()
  fireEvent.click(screen.getByRole('button', { name: /edit layout/i }))
  const allocWidth = within(screen.getByRole('group', { name: 'Width of Allocation' }))
  const colW = (1152 - 2 * GAP) / 3

  fireEvent.click(allocWidth.getByRole('button', { name: 'Full' }))
  expect(widths().alloc).toBe(1152)
  // Hero no longer has Allocation beside it, so the next card that fits (Movers) moves up into the gap
  const top = (id: string) => rectOf(items()[order().indexOf(id)]).top
  expect(top('movers')).toBe(top('hero'))
  expect(widths().hero).toBe(before.hero)
  expectSoundLayout('alloc full')
  expect(lastSave()).toEqual(expect.arrayContaining([{ id: 'alloc', span: 'all' }]))

  fireEvent.click(allocWidth.getByRole('button', { name: '2' }))
  expect(widths().alloc).toBe(Math.round(2 * colW + GAP))
  expectSoundLayout('alloc 2 cols')

  fireEvent.click(allocWidth.getByRole('button', { name: '1' }))
  expect(widths()).toEqual(before)
  expect(lastSave()!.find((e) => e.id === 'alloc')).toEqual({ id: 'alloc' }) // back to the default width: nothing stored
  expectSoundLayout('alloc back to 1')
})

test('a wider card on a narrow grid never exceeds the grid', async () => {
  containerWidth = 700 // 2 columns
  await mount(<Host />)
  fireEvent.click(screen.getByRole('button', { name: /edit layout/i }))
  // at 2 columns the choices are 1 or Full
  const w = within(screen.getByRole('group', { name: 'Width of Allocation' }))
  expect(w.queryByRole('button', { name: '2' })).toBeNull()
  fireEvent.click(w.getByRole('button', { name: 'Full' }))
  expectSoundLayout()
  // a card that was set to 2 columns shows Full pressed on a 2-column grid
  expect(within(screen.getByRole('group', { name: 'Width of Hero' })).getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true')
})

// ── hide / show ────────────────────────────────────────────────────────────────────────────────────────────

test('hiding removes the card, the rest close up, and it can be brought back to the same place', async () => {
  await mount(<Host />)
  await edit()
  fireEvent.click(screen.getByRole('button', { name: 'Hide Allocation' }))
  expect(order()).toEqual(['hero', 'pulse', 'movers', 'pnl'])
  expectSoundLayout()
  expect(lastSave()).toEqual([{ id: 'hero' }, { id: 'alloc', hidden: true }, { id: 'pulse' }, { id: 'movers' }, { id: 'pnl' }])

  fireEvent.click(screen.getByRole('button', { name: 'Show Allocation' }))
  expect(order()).toEqual(['hero', 'alloc', 'pulse', 'movers', 'pnl'])
  expectSoundLayout()
  expect(screen.queryByRole('group', { name: 'Hidden cards' })).toBeNull()
})

test('hidden cards stay hidden after leaving edit mode, and the toolbar is gone', async () => {
  await mount(<Host />)
  await edit()
  fireEvent.click(screen.getByRole('button', { name: 'Hide Pulse' }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(order()).toEqual(['hero', 'alloc', 'movers', 'pnl'])
  expect(screen.queryByRole('region', { name: /layout editor/i })).toBeNull()
  expect(document.querySelector('.mne-dash-frame')).toBeNull() // view mode renders the card itself, no edit chrome
  expectSoundLayout()
})

test('hiding every card shows a hint instead of an empty page, and Edit layout still brings them back', async () => {
  await mount(<Host />)
  await edit()
  for (const c of DEFS) fireEvent.click(screen.getByRole('button', { name: `Hide ${c.label}` }))
  expect(order()).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.getByText(/every card is hidden/i)).toBeInTheDocument()
  await edit()
  fireEvent.click(screen.getByRole('button', { name: 'Show Hero' }))
  expect(order()).toEqual(['hero'])
})

test('cards with nothing to show are skipped entirely, even when hidden or in the tray', async () => {
  const nodes = { ...NODES, movers: null, pnl: undefined }
  await mount(<Host nodes={nodes} />)
  expect(order()).toEqual(['hero', 'alloc', 'pulse'])
  await edit()
  expect(screen.queryByRole('button', { name: 'Hide Movers' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Show Movers' })).toBeNull()
  expectSoundLayout()
})

test('on a one-column screen only hide / show is offered — no drag handle, no width control', async () => {
  containerWidth = 380
  await mount(<Host />)
  expect(grid().dataset.columns).toBe('1')
  await edit()
  expect(screen.queryByRole('button', { name: /^Move / })).toBeNull()
  expect(screen.queryByRole('group', { name: /^Width of / })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Hide Movers' }))
  expect(order()).toEqual(['hero', 'alloc', 'pulse', 'pnl'])
  fireEvent.click(screen.getByRole('button', { name: 'Show Movers' }))
  expect(order()).toContain('movers')
  // growing the window makes the other controls appear without leaving edit mode
  containerWidth = 1152
  fireResize()
  expect(screen.getByRole('button', { name: 'Move Hero' })).toBeInTheDocument()
  expectSoundLayout()
})

test('entering and leaving edit mode keeps the layout sound at every width', async () => {
  await mount(<Host />)
  for (const w of [1152, 900, 700, 500, 380]) {
    containerWidth = w
    fireResize()
    await edit()
    expectSoundLayout(`edit @${w}`)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expectSoundLayout(`view @${w}`)
  }
})

// ── reordering ─────────────────────────────────────────────────────────────────────────────────────────────

test('arrow keys move a card, keep focus on its handle and announce the new position', async () => {
  await mount(<Host />)
  await edit()
  const handle = screen.getByRole('button', { name: 'Move Hero' })
  handle.focus()
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(order()).toEqual(['alloc', 'hero', 'pulse', 'movers', 'pnl'])
  await waitFor(() => expect(screen.getByRole('button', { name: 'Move Hero' })).toHaveFocus())
  expect(screen.getByRole('status')).toHaveTextContent('Hero moved to position 2 of 5')
  expect(lastSave()!.map((e) => e.id)).toEqual(['alloc', 'hero', 'pulse', 'movers', 'pnl'])
  expectSoundLayout()

  fireEvent.keyDown(screen.getByRole('button', { name: 'Move Hero' }), { key: 'ArrowUp' })
  expect(order()).toEqual(['hero', 'alloc', 'pulse', 'movers', 'pnl'])
  // at the start there is nothing to swap with: no change, no extra save
  const saves = store.save.mock.calls.length
  fireEvent.keyDown(screen.getByRole('button', { name: 'Move Hero' }), { key: 'ArrowLeft' })
  expect(order()).toEqual(['hero', 'alloc', 'pulse', 'movers', 'pnl'])
  expect(store.save.mock.calls.length).toBe(saves)
})

test('keyboard moves skip hidden cards', async () => {
  await mount(<Host />)
  await edit()
  fireEvent.click(screen.getByRole('button', { name: 'Hide Allocation' }))
  fireEvent.keyDown(screen.getByRole('button', { name: 'Move Hero' }), { key: 'ArrowDown' })
  expect(order()).toEqual(['pulse', 'hero', 'movers', 'pnl'])
  expect(lastSave()!.map((e) => e.id)).toEqual(['alloc', 'pulse', 'hero', 'movers', 'pnl'])
})

function pointer(type: string, x: number, y: number, target: Element | Window = window) {
  fireEvent(target, new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }))
}

test('dragging a card onto another reorders live, follows the pointer, and saves once on drop', async () => {
  await mount(<Host />)
  await edit()
  const heroItem = items()[0]
  const startRect = rectOf(heroItem)
  const handle = screen.getByRole('button', { name: 'Move Hero' })

  pointer('pointerdown', startRect.left + 20, startRect.top + 20, handle)
  expect(heroItem.classList.contains('is-dragging')).toBe(true)

  // pull the card over the Movers card (lower right)
  const target = rectOf(items()[order().indexOf('movers')])
  const px = target.left + target.width / 2
  const py = target.top + target.height / 2
  await act(async () => { pointer('pointermove', px, py) })

  expect(order().indexOf('hero')).toBe(3) // took Movers' slot
  expect(order()).toEqual(['alloc', 'pulse', 'movers', 'hero', 'pnl'])
  // while dragging the card is carried by `translate`, so it tracks the pointer rather than snapping into its slot
  const carried = rectOf(items()[order().indexOf('hero')])
  expect(carried.left + 20).toBeCloseTo(px, 0)
  expect(carried.top + 20).toBeCloseTo(py, 0)
  expect(store.save).not.toHaveBeenCalled() // nothing saved mid-drag

  // the pointer is still over the card's own (new) slot, so more moves there change nothing
  await act(async () => { pointer('pointermove', px + 1, py + 1) })
  await act(async () => { pointer('pointermove', px + 2, py) })
  expect(order()).toEqual(['alloc', 'pulse', 'movers', 'hero', 'pnl'])

  await act(async () => { pointer('pointerup', px, py) })
  const dropped = items()[order().indexOf('hero')]
  expect(dropped.classList.contains('is-dragging')).toBe(false)
  expect(dropped.style.translate).toBe('') // settles into its slot
  expect(store.save).toHaveBeenCalledTimes(1)
  expect(lastSave()!.map((e) => e.id)).toEqual(['alloc', 'pulse', 'movers', 'hero', 'pnl'])
  expectSoundLayout()
})

test('dropping a card where it started changes and saves the same order (no accidental reshuffle)', async () => {
  await mount(<Host />)
  await edit()
  const r = rectOf(items()[1])
  const handle = screen.getByRole('button', { name: 'Move Allocation' })
  pointer('pointerdown', r.left + 10, r.top + 10, handle)
  await act(async () => { pointer('pointermove', r.left + 40, r.top + 30) })
  await act(async () => { pointer('pointerup', r.left + 40, r.top + 30) })
  expect(order()).toEqual(['hero', 'alloc', 'pulse', 'movers', 'pnl'])
  expect(lastSave()!.map((e) => e.id)).toEqual(['hero', 'alloc', 'pulse', 'movers', 'pnl'])
})

test('a cancelled drag (pointercancel) also releases the card', async () => {
  await mount(<Host />)
  await edit()
  const r = rectOf(items()[1])
  pointer('pointerdown', r.left + 10, r.top + 10, screen.getByRole('button', { name: 'Move Allocation' }))
  await act(async () => { pointer('pointermove', r.left + 50, r.top + 50) })
  await act(async () => { pointer('pointercancel', r.left + 50, r.top + 50) })
  expect(items()[1].classList.contains('is-dragging')).toBe(false)
  expect(items()[1].style.translate).toBe('')
})

test('unmounting mid-drag leaves no window listeners behind', async () => {
  const add = vi.spyOn(window, 'addEventListener')
  const remove = vi.spyOn(window, 'removeEventListener')
  const { unmount } = await mount(<Host />)
  await edit()
  const r = rectOf(items()[1])
  pointer('pointerdown', r.left + 10, r.top + 10, screen.getByRole('button', { name: 'Move Allocation' }))
  const added = add.mock.calls.filter(([t]) => ['pointermove', 'pointerup', 'pointercancel', 'scroll'].includes(t as string)).map(([t]) => t)
  unmount()
  const removed = remove.mock.calls.filter(([t]) => ['pointermove', 'pointerup', 'pointercancel', 'scroll'].includes(t as string)).map(([t]) => t)
  for (const t of new Set(added)) expect(removed).toContain(t)
})

test('every arrangement reached by dragging keeps all cards on screen without overlap', async () => {
  await mount(<Host />)
  await edit()
  const ids = ['hero', 'alloc', 'pulse', 'movers', 'pnl']
  let seed = 7
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let step = 0; step < 15; step++) {
    const id = ids[Math.floor(rand() * ids.length)]
    const from = rectOf(items()[order().indexOf(id)])
    const others = items().filter((_, i) => order()[i] !== id)
    const to = rectOf(others[Math.floor(rand() * others.length)])
    pointer('pointerdown', from.left + 5, from.top + 5, screen.getByRole('button', { name: `Move ${DEFS.find((d) => d.id === id)!.label}` }))
    await act(async () => { pointer('pointermove', to.left + to.width / 2, to.top + to.height / 2) })
    await act(async () => { pointer('pointerup', to.left + to.width / 2, to.top + to.height / 2) })
    expect([...order()].sort()).toEqual([...ids].sort())
    expectSoundLayout(`step ${step}`)
    // wait out the swap cooldown so the next drag's first move is allowed (real time, ~220ms)
    await new Promise((r) => setTimeout(r, 5))
  }
})

// ── which packer runs ──────────────────────────────────────────────────────────────────────────────────────

test('cards of different natural heights end up one height per row, at every width and after every edit', async () => {
  await mount(<Host />)
  const rowsAreEven = (label: string) => {
    expectSoundLayout(label)
    const rects = items().map(rectOf)
    const tops = new Set(rects.map((r) => Math.round(r.top)))
    // 5 cards of 300/200/120/180/100 px cannot all be in distinct rows in 3 columns
    if (grid().dataset.columns === '3') expect(tops.size, label).toBeLessThan(rects.length)
  }
  rowsAreEven('view')
  for (const w of [1152, 900, 700, 500]) { containerWidth = w; fireResize(); rowsAreEven(`view @${w}`) }
  containerWidth = 1152
  fireResize()
  await edit()
  rowsAreEven('edit')
  fireEvent.click(screen.getByRole('button', { name: 'Hide Allocation' }))
  rowsAreEven('hid a card')
  fireEvent.keyDown(screen.getByRole('button', { name: 'Move Hero' }), { key: 'ArrowDown' })
  rowsAreEven('moved a card')
  fireEvent.click(within(screen.getByRole('group', { name: 'Width of Movers' })).getByRole('button', { name: 'Full' }))
  rowsAreEven('resized a card')
})

test('the tallest card in a row sets the row height and shorter neighbours stretch to it', async () => {
  await mount(<Host />)
  // hero (300) shares a row with alloc (200): alloc is stretched to the hero's height
  const [hero, alloc] = [items()[order().indexOf('hero')], items()[order().indexOf('alloc')]]
  expect(rectOf(hero).height).toBe(300)
  expect(rectOf(alloc).height).toBe(300)
  expect(rectOf(hero).top).toBe(rectOf(alloc).top)
})

test('a card that cannot share its row widens to fill it, wherever the row is', async () => {
  containerWidth = 700 // 2 columns
  const widthOf = (id: string) => rectOf(items()[order().indexOf(id)]).width
  // a 1-wide card followed only by a full-width card has no partner: it fills its row
  const a = await mount(<Host nodes={{ alloc: NODES.alloc, pulse: NODES.pulse }} />)
  expect(widthOf('alloc')).toBe(700)
  expectSoundLayout('hole')
  a.unmount()
  // so does a 1-wide card alone in the final row
  await mount(<Host nodes={{ pulse: NODES.pulse, pnl: NODES.pnl }} />)
  expect(widthOf('pulse')).toBe(700)
  expect(widthOf('pnl')).toBe(700)
  expectSoundLayout('last row')
})

test('Reset layout restores order, widths and hidden cards, and is disabled when nothing differs', async () => {
  await mount(<Host />)
  await edit()
  const reset = screen.getByRole('button', { name: 'Reset layout' })
  expect(reset).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Hide Movers' }))
  fireEvent.click(within(screen.getByRole('group', { name: 'Width of Allocation' })).getByRole('button', { name: 'Full' }))
  fireEvent.keyDown(screen.getByRole('button', { name: 'Move Hero' }), { key: 'ArrowRight' })
  expect(reset).not.toBeDisabled()
  fireEvent.click(reset)
  expect(order()).toEqual(['hero', 'alloc', 'pulse', 'movers', 'pnl'])
  expect(lastSave()).toEqual(DEFS.map((d) => ({ id: d.id })))
  expect(reset).toBeDisabled()
  expectSoundLayout()
})

// ── saved layouts ──────────────────────────────────────────────────────────────────────────────────────────

test('the locally cached layout is used on the very first render', async () => {
  store.cached = [{ id: 'pnl' }, { id: 'hero', span: 1 }, { id: 'alloc', hidden: true }]
  await mount(<Host />)
  expect(order()).toEqual(['pnl', 'hero', 'pulse', 'movers'])
  expect(Math.round(rectOf(items()[1]).width)).toBe(Math.round((1152 - 2 * GAP) / 3)) // hero narrowed to 1 column
  expectSoundLayout()
})

test("the account's layout replaces the cached one when it arrives", async () => {
  store.cached = [{ id: 'pnl' }]
  store.remote = { home: [{ id: 'movers' }, { id: 'hero' }, { id: 'alloc' }, { id: 'pulse' }, { id: 'pnl' }] }
  await mount(<Host />)
  await waitFor(() => expect(order()).toEqual(['movers', 'hero', 'alloc', 'pulse', 'pnl']))
  expectSoundLayout()
})

test("the account's layout never overwrites an edit made before it arrived", async () => {
  let resolve!: (v: Record<string, LayoutEntry[]>) => void
  const pending = new Promise<Record<string, LayoutEntry[]>>((r) => { resolve = r })
  const mod = await import('@/lib/db/dashboardLayouts')
  const spy = vi.spyOn(mod, 'loadDashboardLayouts').mockReturnValue(pending as never)
  await mount(<Host />)
  await edit()
  fireEvent.click(screen.getByRole('button', { name: 'Hide Hero' }))
  await act(async () => { resolve({ home: [{ id: 'pnl' }] }); await pending })
  expect(order()).not.toContain('hero')
  expect(order()[0]).toBe('alloc')
  spy.mockRestore()
})

test('a card added in a later version appears in the user\'s saved order', async () => {
  store.cached = [{ id: 'movers' }, { id: 'hero' }] // saved before alloc / pulse / pnl existed
  await mount(<Host />)
  expect([...order()].sort()).toEqual(['alloc', 'hero', 'movers', 'pnl', 'pulse'])
  expectSoundLayout()
})
