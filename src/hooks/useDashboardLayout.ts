import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultLayout, isDefaultLayout, moveCard, moveRelative, resolveLayout, setCardHidden, setCardSpan,
  toSavedLayout, type CardDef, type CardSpan, type DashboardPage, type ResolvedCard,
} from '@/lib/dashboardLayout'
import { getCachedDashboardLayout, loadDashboardLayouts, saveDashboardLayout } from '@/lib/db/dashboardLayouts'
import { showAppAlert } from '@/lib/appAlerts'

export interface DashboardLayoutApi {
  page: DashboardPage
  defs: readonly CardDef[]
  /** Every card in the user's order, hidden ones included. */
  cards: ResolvedCard[]
  editing: boolean
  setEditing: (v: boolean) => void
  /** Order, width and hidden state all match the defaults. */
  isDefault: boolean
  /** Live reorder while dragging: updates the view, saves on `endDrag`. */
  previewMove: (id: string, targetId: string) => void
  endDrag: () => void
  /** Keyboard reorder among the cards that are on screen. Returns the card's new position, or null if it couldn't move. */
  moveBy: (id: string, direction: -1 | 1, isShown: (c: ResolvedCard) => boolean) => ResolvedCard[] | null
  setHidden: (id: string, hidden: boolean) => void
  setSpan: (id: string, span: CardSpan) => void
  reset: () => void
}

/**
 * State for one page's customizable card grid. `defs` must be a stable
 * module-level array. The saved layout is rendered from the local copy
 * immediately, then replaced by the account's copy when it arrives (unless the
 * user has already started editing).
 */
export function useDashboardLayout(page: DashboardPage, defs: readonly CardDef[]): DashboardLayoutApi {
  const [cards, setCards] = useState<ResolvedCard[]>(() => resolveLayout(defs, getCachedDashboardLayout(page)))
  const [editing, setEditing] = useState(false)
  const cardsRef = useRef(cards)
  const touched = useRef(false)
  const warned = useRef(false)

  const commit = useCallback((next: ResolvedCard[], persist: boolean) => {
    touched.current = true
    cardsRef.current = next
    setCards(next)
    if (!persist) return
    saveDashboardLayout(page, toSavedLayout(next)).catch(() => {
      if (warned.current) return
      warned.current = true
      showAppAlert("Couldn't save your layout to your account. It's kept on this device.", { variant: 'error' })
    })
  }, [page])

  useEffect(() => {
    let cancelled = false
    loadDashboardLayouts()
      .then((layouts) => {
        if (cancelled || touched.current) return
        const next = resolveLayout(defs, layouts[page])
        cardsRef.current = next
        setCards(next)
      })
      .catch(() => { /* local copy stays */ })
    return () => { cancelled = true }
  }, [page, defs])

  return useMemo<DashboardLayoutApi>(() => ({
    page,
    defs,
    cards,
    editing,
    setEditing,
    isDefault: isDefaultLayout(defs, cards),
    previewMove: (id, targetId) => commit(moveCard(cardsRef.current, id, targetId), false),
    endDrag: () => commit(cardsRef.current, true),
    moveBy: (id, direction, isShown) => {
      const next = moveRelative(cardsRef.current, id, direction, isShown)
      if (next.every((c, i) => c.id === cardsRef.current[i].id)) return null
      commit(next, true)
      return next
    },
    setHidden: (id, hidden) => commit(setCardHidden(cardsRef.current, id, hidden), true),
    setSpan: (id, span) => commit(setCardSpan(cardsRef.current, defs, id, span), true),
    reset: () => commit(defaultLayout(defs), true),
  }), [page, defs, cards, editing, commit])
}
