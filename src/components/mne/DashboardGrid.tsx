import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, EyeOff, GripVertical, LayoutGrid, Plus, RotateCcw } from 'lucide-react'
import { Masonry, MasonryItem } from './Masonry'
import { SegmentedControl } from './index'
import type { DashboardLayoutApi } from '@/hooks/useDashboardLayout'
import { findDropTarget, shownPosition, type CardSpan, type DropRect, type ResolvedCard } from '@/lib/dashboardLayout'
import '@/styles/dashboard.css'

/** A card that has just been swapped must not be swapped again until the other cards finish sliding (they animate for 180ms). */
const RETARGET_COOLDOWN_MS = 220
const EDGE_SCROLL_PX = 80
const EDGE_SCROLL_STEP = 18

export function DashboardEditButton({ dash }: { dash: DashboardLayoutApi }) {
  return (
    <button
      type="button"
      className={`mne-btn is-sm mne-dash-btn${dash.editing ? '' : ' is-quiet'}`}
      aria-pressed={dash.editing}
      onClick={() => dash.setEditing(!dash.editing)}
    >
      {dash.editing
        ? <Check size={16} strokeWidth={1.75} aria-hidden="true" />
        : <LayoutGrid size={16} strokeWidth={1.75} aria-hidden="true" />}
      <span>{dash.editing ? 'Done' : 'Edit layout'}</span>
    </button>
  )
}

interface DragState {
  id: string
  item: HTMLElement
  grabX: number
  grabY: number
  x: number
  y: number
  /** Current pointer-follow offset applied to the item on top of its packed position. */
  dx: number
  dy: number
  lastMoveAt: number
  awaitingPack: boolean
  raf: number
  scroller: HTMLElement | null
}

function findScroller(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n
  }
  return null
}

const spanKey = (s: CardSpan) => String(s) as '1' | '2' | 'all'

/**
 * A Masonry whose cards come from a user-editable layout (`useDashboardLayout`).
 * Outside edit mode it is just a Masonry of the visible cards. In edit mode each
 * card gets a bar with a drag handle (also arrow-key movable), a width control
 * and a hide button, and hidden cards sit in a tray to bring back. With one
 * column only hiding is offered. `nodes` maps card id to content; a missing or
 * null entry means the card has nothing to show and is skipped entirely.
 */
export function DashboardGrid({ dash, nodes, fill = false }: { dash: DashboardLayoutApi; nodes: Record<string, ReactNode>; fill?: boolean }) {
  const { cards, editing } = dash
  const available = cards.filter((c) => nodes[c.id] != null && nodes[c.id] !== false)
  const shown = available.filter((c) => !c.hidden)
  const hiddenCards = available.filter((c) => c.hidden)

  const [columns, setColumns] = useState(1)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const refocus = useRef<string | null>(null)
  const latest = useRef({ dash, shown })
  latest.current = { dash, shown }

  const canDrag = editing && columns > 1
  // The gap-filling packer reorders and widens cards, so it only runs on an untouched arrangement and never while editing.
  const useFill = fill && !editing && dash.isDefaultArrangement

  const isShown = useCallback((c: ResolvedCard) => latest.current.shown.some((s) => s.id === c.id), [])

  // Keyboard moves re-parent the card's DOM node, which drops focus; put it back on the same handle.
  useLayoutEffect(() => {
    const id = refocus.current
    if (!id) return
    refocus.current = null
    Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-dash-handle]') ?? []).find((h) => h.dataset.dashHandle === id)?.focus()
  }, [cards])

  /** Slot rectangles of every card on screen; the dragged card's is its packed slot, not where the pointer carries it. */
  const slotRects = useCallback((): DropRect[] => {
    const root = gridRef.current
    if (!root) return []
    const d = drag.current
    return Array.from(root.querySelectorAll<HTMLElement>('[data-dash-card]')).map((frame) => {
      const id = frame.dataset.dashCard!
      const r = (frame.closest('.mne-masonry-item') as HTMLElement).getBoundingClientRect()
      const ox = d && d.id === id ? d.dx : 0
      const oy = d && d.id === id ? d.dy : 0
      return { id, left: r.left - ox, top: r.top - oy, right: r.right - ox, bottom: r.bottom - oy }
    })
  }, [])

  /** Carry the dragged card under the pointer, wherever its slot currently is. */
  const place = useCallback(() => {
    const d = drag.current
    if (!d) return
    const r = d.item.getBoundingClientRect()
    const slotLeft = r.left - d.dx
    const slotTop = r.top - d.dy
    d.dx = d.x - d.grabX - slotLeft
    d.dy = d.y - d.grabY - slotTop
    d.item.style.translate = `${d.dx}px ${d.dy}px`
  }, [])

  const apply = useCallback(() => {
    const d = drag.current
    if (!d) return
    place()
    if (d.awaitingPack || performance.now() - d.lastMoveAt < RETARGET_COOLDOWN_MS) return
    const target = findDropTarget(slotRects(), d.id, d.x, d.y)
    if (!target) return
    d.lastMoveAt = performance.now()
    d.awaitingPack = true
    window.setTimeout(() => { if (drag.current === d) d.awaitingPack = false }, RETARGET_COOLDOWN_MS)
    latest.current.dash.previewMove(d.id, target)
  }, [place, slotRects])

  // After a re-pack the dragged card's slot has moved: keep it glued to the pointer.
  const onPack = useCallback(() => {
    const d = drag.current
    if (!d) return
    d.awaitingPack = false
    place()
  }, [place])

  const stopDrag = useCallback(() => {
    const d = drag.current
    if (!d) return
    drag.current = null
    cancelAnimationFrame(d.raf)
    window.removeEventListener('pointermove', onMoveRef.current)
    window.removeEventListener('pointerup', onUpRef.current)
    window.removeEventListener('pointercancel', onUpRef.current)
    window.removeEventListener('scroll', onScrollRef.current, true)
    d.item.classList.remove('is-dragging')
    d.item.classList.add('is-settling')
    d.item.style.translate = ''
    window.setTimeout(() => d.item.classList.remove('is-settling'), 260)
    setDraggingId(null)
    const { dash: api, shown: list } = latest.current
    api.endDrag()
    const pos = shownPosition(api.cards, d.id, (c) => list.some((s) => s.id === c.id))
    const label = api.cards.find((c) => c.id === d.id)?.label ?? 'Card'
    setAnnouncement(`${label} placed at position ${pos.index} of ${pos.total}`)
  }, [])

  const onMoveRef = useRef<(e: PointerEvent) => void>(() => {})
  const onUpRef = useRef<() => void>(() => {})
  const onScrollRef = useRef<() => void>(() => {})
  onMoveRef.current = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    d.x = e.clientX
    d.y = e.clientY
    apply()
  }
  onUpRef.current = stopDrag
  onScrollRef.current = apply

  useEffect(() => () => {
    const d = drag.current
    if (!d) return
    cancelAnimationFrame(d.raf)
    window.removeEventListener('pointermove', onMoveRef.current)
    window.removeEventListener('pointerup', onUpRef.current)
    window.removeEventListener('pointercancel', onUpRef.current)
    window.removeEventListener('scroll', onScrollRef.current, true)
    drag.current = null
  }, [])

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (!canDrag || e.button !== 0 || drag.current) return
    const item = e.currentTarget.closest('.mne-masonry-item') as HTMLElement | null
    if (!item) return
    e.preventDefault()
    const r = item.getBoundingClientRect()
    const state: DragState = {
      id, item, grabX: e.clientX - r.left, grabY: e.clientY - r.top, x: e.clientX, y: e.clientY,
      dx: 0, dy: 0, lastMoveAt: -Infinity, awaitingPack: false, raf: 0, scroller: findScroller(item),
    }
    drag.current = state
    item.classList.add('is-dragging')
    setDraggingId(id)
    window.addEventListener('pointermove', onMoveRef.current)
    window.addEventListener('pointerup', onUpRef.current)
    window.addEventListener('pointercancel', onUpRef.current)
    window.addEventListener('scroll', onScrollRef.current, true)
    // Scroll the page while the pointer rests near its top or bottom edge.
    const tick = () => {
      const d = drag.current
      if (!d) return
      const top = d.scroller ? d.scroller.getBoundingClientRect().top : 0
      const bottom = d.scroller ? d.scroller.getBoundingClientRect().bottom : window.innerHeight
      let step = 0
      if (d.y < top + EDGE_SCROLL_PX) step = -EDGE_SCROLL_STEP
      else if (d.y > bottom - EDGE_SCROLL_PX) step = EDGE_SCROLL_STEP
      if (step) (d.scroller ?? window).scrollBy({ top: step })
      d.raf = requestAnimationFrame(tick)
    }
    state.raf = requestAnimationFrame(tick)
  }

  const keyMove = (e: React.KeyboardEvent, c: ResolvedCard) => {
    const direction = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0
    if (!direction) return
    e.preventDefault()
    const next = dash.moveBy(c.id, direction, isShown)
    if (!next) return
    refocus.current = c.id
    const pos = shownPosition(next, c.id, isShown)
    setAnnouncement(`${c.label} moved to position ${pos.index} of ${pos.total}`)
  }

  const widthOptions = columns >= 3
    ? [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: 'all', label: 'Full' }] as const
    : [{ value: '1', label: '1' }, { value: 'all', label: 'Full' }] as const

  const pressedWidth = (span: CardSpan): string => (columns < 3 && span === 2 ? 'all' : spanKey(span))

  return (
    <div ref={gridRef} data-dashboard={dash.page} data-editing={editing ? 'true' : undefined}>
      {editing && (
        <div className="mne-dash-toolbar" role="region" aria-label="Layout editor">
          <p className="mne-help">
            {columns > 1
              ? 'Drag a card by its handle (or focus the handle and use the arrow keys) to rearrange. Set a card to 1 column, 2 columns or full width, or hide it.'
              : 'Hide the cards you don’t need.'}
          </p>
          <button type="button" className="mne-btn is-sm is-ghost mne-dash-btn" onClick={dash.reset} disabled={dash.isDefault}>
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>Reset layout</span>
          </button>
          {hiddenCards.length > 0 && (
            <div className="mne-dash-tray" role="group" aria-label="Hidden cards">
              <span>Hidden</span>
              {hiddenCards.map((c) => (
                <button key={c.id} type="button" className="mne-btn is-sm is-ghost mne-dash-btn" aria-label={`Show ${c.label}`} onClick={() => dash.setHidden(c.id, false)}>
                  <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!editing && shown.length === 0 && (
        <section className="mne-card mne-dash-empty">
          <p className="mne-muted">Every card is hidden. Choose Edit layout to bring them back.</p>
        </section>
      )}

      <Masonry fill={useFill} onColumnsChange={setColumns} onPack={onPack}>
        {shown.map((c) => (
          <MasonryItem key={c.id} span={c.span}>
            {editing ? (
              <div className="mne-dash-frame" data-dash-card={c.id} data-dragging={draggingId === c.id ? 'true' : undefined}>
                <div className="mne-dash-bar">
                  {canDrag && (
                    <button
                      type="button"
                      className="pf-iconbtn mne-dash-handle"
                      data-dash-handle={c.id}
                      aria-label={`Move ${c.label}`}
                      title="Drag to move (or use the arrow keys)"
                      onPointerDown={(e) => startDrag(e, c.id)}
                      onKeyDown={(e) => keyMove(e, c)}
                    >
                      <GripVertical size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  )}
                  <span className="mne-dash-label">{c.label}</span>
                  {canDrag && (
                    <SegmentedControl
                      label={`Width of ${c.label}`}
                      value={pressedWidth(c.span)}
                      options={widthOptions}
                      onChange={(v) => dash.setSpan(c.id, v === 'all' ? 'all' : (Number(v) as CardSpan))}
                    />
                  )}
                  <button type="button" className="pf-iconbtn" aria-label={`Hide ${c.label}`} title="Hide" onClick={() => dash.setHidden(c.id, true)}>
                    <EyeOff size={16} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
                <div className="mne-dash-content" inert>{nodes[c.id]}</div>
              </div>
            ) : nodes[c.id]}
          </MasonryItem>
        ))}
      </Masonry>

      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    </div>
  )
}
