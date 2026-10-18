/* eslint-disable react-refresh/only-export-components -- exports the pure packing helpers next to the components so tests can import them */
import {
  Children, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type ReactElement, type ReactNode,
} from 'react'
import '@/styles/masonry.css'

/**
 * Row-aligned card grid that works without knowing its children in advance.
 *
 * Cards are packed into rows (`packRows`): each row holds as many cards as fit
 * the column count, every card in a row is stretched to the row's tallest card,
 * and rows stack with a fixed gap. So the layout is always a grid: cards that
 * share a row share a top and a bottom, and rows line up across the page.
 * A child can span 2 columns or all of them via `<MasonryItem span="all">`.
 *
 * Column count comes from the container's own width (not the viewport), so it
 * accounts for the expanded/collapsed sidebar. One column is plain flow (cards
 * keep their natural height).
 *
 * DOM order = the order of the children = tab/screen-reader order. Only the
 * visual position changes (CSS transform). When a card doesn't fit what is
 * left of a row, a later card that does is pulled into the gap (so rows stay
 * full); a row that still can't be filled widens its last card to the edge,
 * so every row, the last included, spans the full width.
 * (The component keeps its historical name; it no longer does masonry packing.)
 */

export type MasonrySpan = number | 'all'
export interface PackItem { height: number; span?: MasonrySpan }
export interface Placement {
  /** First column the item occupies. */
  column: number
  /** Number of columns it occupies. */
  span: number
  top: number
  /** Zero-height items (a card that rendered nothing) take no space and no gap. */
  hidden: boolean
  /** Extra height (px) the card is stretched by to match the tallest card in its row. */
  stretch?: number
}

export function resolveSpan(span: MasonrySpan | undefined, columns: number): number {
  if (span === 'all') return columns
  if (span == null || !Number.isFinite(span)) return 1
  return Math.max(1, Math.min(columns, Math.floor(span)))
}

/** How many columns fit a container: as many as keep each at least `minColumnWidth`. */
export function columnsForWidth(width: number, minColumnWidth: number, gap: number, maxColumns: number): number {
  if (!(width > 0)) return 1
  return Math.max(1, Math.min(maxColumns, Math.floor((width + gap) / (minColumnWidth + gap))))
}

/** Resize notifications closer together than this (ms) count as one continuous size animation. */
const TRACKING_WINDOW_MS = 100
/** How many following cards are considered when filling the space left in a row. */
const LOOKAHEAD = 8

/**
 * Pure row packing. Cards go in order into rows of `columns` columns. A row
 * starts with the next unplaced card and is topped up first-fit with later
 * cards (within `LOOKAHEAD`) whose span fits what is left. Every card in a row
 * gets the row's height (`stretch` is the extra height over its own) and rows
 * are `gap` apart. If a row still has free columns, its last card widens to
 * fill them (the final row too, so no row is ever short). Zero-height cards
 * are hidden and take no space.
 *
 * The grouping depends only on the cards' spans and order, never on heights, so
 * feeding the returned spans back in gives the same rows (the caller relies on
 * this to re-measure widened cards).
 */
export function packRows(items: PackItem[], columns: number, gap = 0): { placements: Placement[]; height: number } {
  const cols = Math.max(1, Math.floor(columns) || 1)
  const placements: Placement[] = items.map(() => ({ column: 0, span: 1, top: 0, hidden: true }))
  const h = (i: number) => Math.max(0, items[i].height)
  const pending: number[] = []
  items.forEach((_, i) => { if (h(i) > 0) pending.push(i) })

  let y = 0
  let any = false
  while (pending.length) {
    const row: number[] = []
    let free = cols
    row.push(pending.shift()!)
    free -= resolveSpan(items[row[0]].span, cols)
    for (let k = 0; k < Math.min(pending.length, LOOKAHEAD) && free > 0;) {
      const idx = pending[k]
      const span = resolveSpan(items[idx].span, cols)
      if (span <= free) { row.push(idx); pending.splice(k, 1); free -= span } else k++
    }
    row.sort((a, b) => a - b)

    const rowHeight = Math.max(...row.map(h))
    let column = 0
    row.forEach((idx, n) => {
      let span = resolveSpan(items[idx].span, cols)
      if (n === row.length - 1) span += free
      const stretch = rowHeight - h(idx)
      placements[idx] = { column, span, top: y, hidden: false, ...(stretch > 0 ? { stretch } : {}) }
      column += span
    })
    y += rowHeight + gap
    any = true
  }
  return { placements, height: any ? y - gap : 0 }
}

interface MasonryItemProps { span?: MasonrySpan; children?: ReactNode }
/** Marks a Masonry child's column span. Renders its children unchanged. */
export function MasonryItem({ children }: MasonryItemProps) { return <>{children}</> }

interface MasonryProps {
  children: ReactNode
  gap?: number
  minColumnWidth?: number
  maxColumns?: number
  className?: string
  /** Called with the current column count on mount and whenever it changes. */
  onColumnsChange?: (columns: number) => void
  /** Called after every layout pass in a multi-column grid (cards have just been repositioned). */
  onPack?: () => void
}

export function Masonry({ children, gap = 24, minColumnWidth = 300, maxColumns = 3, className, onColumnsChange, onPack }: MasonryProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onPackRef = useRef(onPack)
  onPackRef.current = onPack
  const onColumnsRef = useRef(onColumnsChange)
  onColumnsRef.current = onColumnsChange
  const [cols, setCols] = useState(1)
  const colsRef = useRef(1)
  const [ready, setReady] = useState(false)
  const lastResizeRef = useRef(-Infinity)
  const trackingTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(trackingTimerRef.current), [])

  const items = Children.toArray(children).map((child) => {
    if (isValidElement(child) && child.type === MasonryItem) {
      const el = child as ReactElement<MasonryItemProps>
      return { key: el.key ?? undefined, span: el.props.span, node: el.props.children }
    }
    return { key: isValidElement(child) ? child.key ?? undefined : undefined, span: undefined, node: child }
  })

  const pack = useCallback(() => {
    const el = ref.current
    const n = colsRef.current
    if (!el || n < 2) return
    const kids = Array.from(el.children) as HTMLElement[]
    const width = el.clientWidth
    const colW = (width - gap * (n - 1)) / n
    let spans = kids.map((k) => resolveSpan(k.dataset.span === 'all' ? 'all' : Number(k.dataset.span) || 1, n))
    const widthOf = (span: number) => span * colW + (span - 1) * gap
    let heights: number[] = []
    let result = packRows([], n, gap)
    // Write every width first, then read every height (one reflow). A card that a row widens reflows to its
    // new width, so measure again with the final widths; the row grouping depends only on spans, so the
    // second pass keeps the same rows and the loop settles after at most one more round.
    for (let pass = 0; pass < 3; pass++) {
      kids.forEach((k, i) => { k.style.width = `${widthOf(spans[i])}px`; k.style.height = '' })
      heights = kids.map((k) => k.getBoundingClientRect().height)
      result = packRows(kids.map((_, i) => ({ height: heights[i], span: spans[i] })), n, gap)
      const next = result.placements.map((p, i) => (p.hidden ? spans[i] : p.span))
      if (next.every((sp, i) => sp === spans[i])) break
      spans = next
    }
    const { placements, height } = result
    kids.forEach((k, i) => {
      const p = placements[i]
      if (!p.hidden) {
        k.style.width = `${widthOf(p.span)}px`
        k.style.height = p.stretch ? `${heights[i] + p.stretch}px` : ''
      }
      k.style.transform = p.hidden ? 'translate(0px, 0px)' : `translate(${p.column * (colW + gap)}px, ${p.top}px)`
    })
    el.style.height = `${height}px`
    onPackRef.current?.()
  }, [gap])

  const clearPacked = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = ''
    Array.from(el.children).forEach((k) => {
      const s = (k as HTMLElement).style
      s.width = ''
      s.height = ''
      s.transform = ''
    })
  }, [])

  // Column count from the container's width. Runs before first paint so there is no layout jump.
  const measureColumns = useCallback(() => {
    const el = ref.current
    if (!el) return
    const next = columnsForWidth(el.clientWidth, minColumnWidth, gap, maxColumns)
    if (next !== colsRef.current) {
      if (next < 2) clearPacked()
      colsRef.current = next
      setCols(next)
    } else {
      pack()
    }
  }, [minColumnWidth, gap, maxColumns, pack, clearPacked])

  useLayoutEffect(() => { measureColumns() }, [measureColumns])
  useEffect(() => { onColumnsRef.current?.(cols) }, [cols])

  // Re-pack whenever the children, the column count or any child's size changes.
  useLayoutEffect(() => {
    if (cols < 2) return
    pack()
    const el = ref.current
    if (!el) return
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      // A card that keeps resizing frame after frame (a disclosure animating open) re-targets every
      // item each frame; restarting the 180ms transition each time keeps them stuck at its slow start
      // and then releases them in a burst. While sizes stream in, follow the target directly. An
      // isolated resize (a card appearing, one reflow) still animates.
      const now = performance.now()
      const streaming = now - lastResizeRef.current < TRACKING_WINDOW_MS
      lastResizeRef.current = now
      if (streaming) {
        el.classList.add('is-tracking')
        window.clearTimeout(trackingTimerRef.current)
        trackingTimerRef.current = window.setTimeout(() => el.classList.remove('is-tracking'), TRACKING_WINDOW_MS)
      }
      pack()
    })
    Array.from(el.children).forEach((k) => ro.observe(k))
    return () => ro.disconnect()
  })

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === last) return
      last = el.clientWidth
      // The sidebar's 430ms width move streams a new width every frame; follow it directly instead of
      // restarting a 180ms transform transition each frame, which reads as a springy lag-and-catch-up.
      el.classList.add('is-tracking')
      window.clearTimeout(trackingTimerRef.current)
      trackingTimerRef.current = window.setTimeout(() => el.classList.remove('is-tracking'), TRACKING_WINDOW_MS)
      measureColumns()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [measureColumns])

  // Enable the reposition transition only after the first layout.
  useEffect(() => {
    if (cols < 2) { setReady(false); return }
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [cols])

  const cls = ['mne-masonry', cols > 1 && 'is-packed', cols > 1 && ready && 'is-ready', className].filter(Boolean).join(' ')
  return (
    <div ref={ref} className={cls} data-columns={cols} style={{ ['--mne-masonry-gap' as string]: `${gap}px` }}>
      {items.map((it, i) => (
        <div key={it.key ?? i} className="mne-masonry-item" data-span={it.span === 'all' ? 'all' : it.span ?? 1}>
          {it.node}
        </div>
      ))}
    </div>
  )
}
