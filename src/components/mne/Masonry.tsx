import {
  Children, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type ReactElement, type ReactNode,
} from 'react'
import '@/styles/masonry.css'

/**
 * Packed card layout that works without knowing its children in advance.
 *
 * Cards keep their natural height (no stretching to equal heights). Each child
 * is wrapped in a `.mne-masonry-item`, measured with a ResizeObserver, and
 * placed in the shortest column (`packMasonry`). A child can span 2 columns or
 * all of them via `<MasonryItem span="all">`; before a wide item is placed,
 * later single-column items are pulled forward to fill the gap that wide item
 * would otherwise leave above it.
 *
 * Column count comes from the container's own width (not the viewport), so it
 * accounts for the expanded/collapsed sidebar. One column is plain flow.
 *
 * DOM order = the order of the children = tab/screen-reader order. Only the
 * visual position changes (CSS transform), and only the reading order across
 * columns can differ from the DOM order (a card pulled forward to fill a gap).
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

/** Slack above which a hole is worth filling by pulling a later card forward. */
const EPS = 1
/** How many following items are considered when filling a hole. */
const LOOKAHEAD = 8

/**
 * Pure packing. Items go in order into the column whose bottom is highest up
 * (ties: leftmost). A multi-column item sits where the tallest column it
 * covers is shortest. Before placing a multi-column item, later 1-column items
 * (within `LOOKAHEAD`) are pulled into the columns it covers while that
 * reduces the empty space left under the shorter columns.
 * Returns one placement per input item (same indexes) and the total height.
 */
export function packMasonry(items: PackItem[], columns: number, gap = 0): { placements: Placement[]; height: number } {
  const cols = Math.max(1, Math.floor(columns) || 1)
  const tops = new Array<number>(cols).fill(0) // next free y per column
  const placements: Placement[] = items.map(() => ({ column: 0, span: 1, top: 0, hidden: true }))
  const done = new Array<boolean>(items.length).fill(false)
  let any = false

  const h = (i: number) => Math.max(0, items[i].height)
  const place = (i: number, column: number, span: number, top: number) => {
    placements[i] = { column, span, top, hidden: false }
    for (let c = column; c < column + span; c++) tops[c] = top + h(i) + gap
    done[i] = true
    any = true
  }
  const bestStart = (span: number) => {
    let start = 0
    let y = Infinity
    for (let s = 0; s + span <= cols; s++) {
      let m = 0
      for (let c = s; c < s + span; c++) m = Math.max(m, tops[c])
      if (m < y - 1e-9) { y = m; start = s }
    }
    return { start, y }
  }

  for (let i = 0; i < items.length; i++) {
    if (done[i]) continue
    if (h(i) <= 0) { done[i] = true; continue }
    const span = resolveSpan(items[i].span, cols)

    if (span > 1) {
      // Fill the gap that placing this wide item would leave above it.
      for (;;) {
        const { start, y } = bestStart(span)
        let waste = 0
        for (let c = start; c < start + span; c++) waste += y - tops[c]
        if (waste <= EPS) break
        let lowest = start
        for (let c = start; c < start + span; c++) if (tops[c] < tops[lowest]) lowest = c
        let pick = -1
        let pickWaste = waste - EPS
        for (let j = i + 1; j < Math.min(items.length, i + 1 + LOOKAHEAD); j++) {
          if (done[j] || h(j) <= 0 || resolveSpan(items[j].span, cols) !== 1) continue
          const newTop = tops[lowest] + h(j) + gap
          const newY = Math.max(y, newTop)
          let w = 0
          for (let c = start; c < start + span; c++) w += newY - (c === lowest ? newTop : tops[c])
          if (w < pickWaste) { pickWaste = w; pick = j }
        }
        if (pick < 0) break
        place(pick, lowest, 1, tops[lowest])
      }
    }

    const { start, y } = bestStart(span)
    place(i, start, span, y)
  }

  const height = any ? Math.max(...tops) - gap : 0
  return { placements, height: Math.max(0, height) }
}

interface MasonryItemProps { span?: MasonrySpan; children?: ReactNode }
/** Marks a Masonry child's column span. Renders its children unchanged. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MasonryItem({ children }: MasonryItemProps) { return <>{children}</> }

interface MasonryProps {
  children: ReactNode
  gap?: number
  minColumnWidth?: number
  maxColumns?: number
  className?: string
}

export function Masonry({ children, gap = 24, minColumnWidth = 300, maxColumns = 3, className }: MasonryProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(1)
  const colsRef = useRef(1)
  const [ready, setReady] = useState(false)

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
    const spans = kids.map((k) => resolveSpan(k.dataset.span === 'all' ? 'all' : Number(k.dataset.span) || 1, n))
    // Write every width first, then read every height (one reflow).
    kids.forEach((k, i) => { k.style.width = `${spans[i] * colW + (spans[i] - 1) * gap}px` })
    const heights = kids.map((k) => k.getBoundingClientRect().height)
    const { placements, height } = packMasonry(
      kids.map((_, i) => ({ height: heights[i], span: spans[i] })), n, gap,
    )
    kids.forEach((k, i) => {
      const p = placements[i]
      k.style.transform = p.hidden ? 'translate(0px, 0px)' : `translate(${p.column * (colW + gap)}px, ${p.top}px)`
    })
    el.style.height = `${height}px`
  }, [gap])

  const clearPacked = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = ''
    Array.from(el.children).forEach((k) => {
      const s = (k as HTMLElement).style
      s.width = ''
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

  // Re-pack whenever the children, the column count or any child's size changes.
  useLayoutEffect(() => {
    if (cols < 2) return
    pack()
    const el = ref.current
    if (!el) return
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => pack())
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
    <div ref={ref} className={cls} style={{ ['--mne-masonry-gap' as string]: `${gap}px` }}>
      {items.map((it, i) => (
        <div key={it.key ?? i} className="mne-masonry-item" data-span={it.span === 'all' ? 'all' : it.span ?? 1}>
          {it.node}
        </div>
      ))}
    </div>
  )
}
