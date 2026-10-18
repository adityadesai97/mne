/**
 * Pure model for the customizable Home / Charts card grids: which cards exist,
 * their order, which are hidden and how many columns each spans.
 *
 * A page declares its cards (`CardDef`, in default order). A user's saved
 * layout (`LayoutEntry[]`) is only a set of deviations from that default and
 * is always reconciled against the current cards (`resolveLayout`), so a card
 * added or removed by a later app version never breaks a saved layout.
 */

export type CardSpan = 1 | 2 | 'all'
export const CARD_SPANS: readonly CardSpan[] = [1, 2, 'all']

export interface CardDef {
  id: string
  label: string
  /** Default width in columns. */
  span: CardSpan
}

/** What is saved: `hidden` only when true, `span` only when it differs from the card's default. */
export interface LayoutEntry {
  id: string
  hidden?: boolean
  span?: CardSpan
}

export interface ResolvedCard extends CardDef {
  hidden: boolean
  /** True when the user changed this card's width from its default. */
  spanCustom: boolean
}

export type DashboardPage = 'home' | 'charts'
export type DashboardLayouts = Partial<Record<DashboardPage, LayoutEntry[]>>

const MAX_ENTRIES = 64

export function isCardSpan(v: unknown): v is CardSpan {
  return v === 1 || v === 2 || v === 'all'
}

/** Anything read from the database or localStorage is untrusted: keep only well-formed, unique entries. */
export function sanitizeLayout(raw: unknown): LayoutEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: LayoutEntry[] = []
  for (const item of raw) {
    if (out.length >= MAX_ENTRIES) break
    if (!item || typeof item !== 'object') continue
    const { id, hidden, span } = item as Record<string, unknown>
    if (typeof id !== 'string' || id === '' || id.length > 64 || seen.has(id)) continue
    seen.add(id)
    const entry: LayoutEntry = { id }
    if (hidden === true) entry.hidden = true
    if (isCardSpan(span)) entry.span = span
    out.push(entry)
  }
  return out
}

export function sanitizeLayouts(raw: unknown): DashboardLayouts {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const src = raw as Record<string, unknown>
  const out: DashboardLayouts = {}
  if ('home' in src) out.home = sanitizeLayout(src.home)
  if ('charts' in src) out.charts = sanitizeLayout(src.charts)
  return out
}

/**
 * Reconcile a saved layout with the page's current cards. Saved order wins;
 * unknown ids are dropped; a card the saved layout has never seen is placed
 * right after the card that precedes it in the default order (or first).
 */
export function resolveLayout(defs: readonly CardDef[], saved: readonly LayoutEntry[] | undefined): ResolvedCard[] {
  const byId = new Map(defs.map((d) => [d.id, d]))
  const entries = new Map<string, LayoutEntry>()
  const order: string[] = []
  for (const e of sanitizeLayout(saved ?? [])) {
    if (!byId.has(e.id)) continue
    entries.set(e.id, e)
    order.push(e.id)
  }
  defs.forEach((d, i) => {
    if (entries.has(d.id)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const idx = order.indexOf(defs[j].id)
      if (idx >= 0) { at = idx + 1; break }
    }
    order.splice(at, 0, d.id)
  })
  return order.map((id) => {
    const d = byId.get(id)!
    const e = entries.get(id)
    const span = e?.span ?? d.span
    return { ...d, span, hidden: e?.hidden === true, spanCustom: span !== d.span }
  })
}

/** The minimal form to store: everything that matches the defaults is left out of each entry. */
export function toSavedLayout(cards: readonly ResolvedCard[]): LayoutEntry[] {
  return cards.map((c) => {
    const e: LayoutEntry = { id: c.id }
    if (c.hidden) e.hidden = true
    if (c.spanCustom) e.span = c.span
    return e
  })
}

/** True when nothing differs from the defaults: same order, no hidden card, no custom width. */
export function isDefaultLayout(defs: readonly CardDef[], cards: readonly ResolvedCard[]): boolean {
  return cards.length === defs.length
    && cards.every((c, i) => c.id === defs[i].id && !c.hidden && !c.spanCustom)
}

/**
 * True when the arrangement (order and widths) is untouched; hiding cards does
 * not count. Charts only uses its gap-filling packer in this case, because that
 * packer reorders and widens cards, which would override a user's choices.
 */
export function isDefaultArrangement(defs: readonly CardDef[], cards: readonly ResolvedCard[]): boolean {
  return cards.length === defs.length && cards.every((c, i) => c.id === defs[i].id && !c.spanCustom)
}

export function defaultLayout(defs: readonly CardDef[]): ResolvedCard[] {
  return resolveLayout(defs, [])
}

/** Move `id` to the slot currently held by `targetId` (what a drop onto that card means). */
export function moveCard(cards: readonly ResolvedCard[], id: string, targetId: string): ResolvedCard[] {
  const from = cards.findIndex((c) => c.id === id)
  const to = cards.findIndex((c) => c.id === targetId)
  if (from < 0 || to < 0 || from === to) return cards.slice()
  const next = cards.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Keyboard move: swap `id` with the nearest card in `direction` that is
 * actually shown (hidden and empty cards are skipped, otherwise the key would
 * appear to do nothing). `isShown` says which cards are on screen.
 */
export function moveRelative(
  cards: readonly ResolvedCard[],
  id: string,
  direction: -1 | 1,
  isShown: (card: ResolvedCard) => boolean,
): ResolvedCard[] {
  const from = cards.findIndex((c) => c.id === id)
  if (from < 0) return cards.slice()
  for (let i = from + direction; i >= 0 && i < cards.length; i += direction) {
    if (isShown(cards[i])) return moveCard(cards, id, cards[i].id)
  }
  return cards.slice()
}

export function setCardHidden(cards: readonly ResolvedCard[], id: string, hidden: boolean): ResolvedCard[] {
  return cards.map((c) => (c.id === id ? { ...c, hidden } : c))
}

export function setCardSpan(cards: readonly ResolvedCard[], defs: readonly CardDef[], id: string, span: CardSpan): ResolvedCard[] {
  const def = defs.find((d) => d.id === id)
  if (!def || !isCardSpan(span)) return cards.slice()
  return cards.map((c) => (c.id === id ? { ...c, span, spanCustom: span !== def.span } : c))
}

/** How many columns a card really occupies at a given column count (wider than the grid clamps). */
export function effectiveColumns(span: CardSpan, columns: number): number {
  const cols = Math.max(1, Math.floor(columns) || 1)
  if (span === 'all') return cols
  return Math.max(1, Math.min(cols, span))
}

/** Position (1-based) of a card among those shown, for screen-reader announcements. */
export function shownPosition(cards: readonly ResolvedCard[], id: string, isShown: (card: ResolvedCard) => boolean): { index: number; total: number } {
  const shown = cards.filter(isShown)
  return { index: shown.findIndex((c) => c.id === id) + 1, total: shown.length }
}

export interface DropRect { id: string; left: number; top: number; right: number; bottom: number }

/**
 * Which card a dragged card should take the place of: the other card under the
 * pointer. Over the dragged card's own slot, a gap, or nothing: no move, which
 * is what stops a card flip-flopping as neighbours slide under a stationary pointer.
 */
export function findDropTarget(rects: readonly DropRect[], draggedId: string, x: number, y: number): string | null {
  const own = rects.find((r) => r.id === draggedId)
  if (own && x >= own.left && x <= own.right && y >= own.top && y <= own.bottom) return null
  for (const r of rects) {
    if (r.id === draggedId) continue
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return r.id
  }
  return null
}
