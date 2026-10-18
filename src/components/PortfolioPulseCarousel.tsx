import { useEffect, useMemo, useState } from 'react'
import {
  computeMovers,
  computeMoversForWindow,
  computeCandidateCards,
  buildSlotTeaser,
  isSlotSeenAndUnchanged,
  type PortfolioInsightSlot,
  type PortfolioChangeOverride,
} from '@/lib/portfolioExplanation'
import {
  computeEventCards,
  fetchUpcomingEarnings,
  filterEventsByLifecycle,
  loadSeenEventIds,
  markEventSeen,
  rankPulseItems,
  type PulseItem,
} from '@/lib/portfolioPulseEvents'
import { getAllThemes } from '@/lib/db/themes'
import { config } from '@/store/config'
import { getTickerPriceHistory, type TickerPricePoint } from '@/lib/db/tickerPriceHistory'
import { getPortfolioExplanation, type PortfolioExplanationRow } from '@/lib/db/portfolioExplanations'
import { openPortfolioExplanationInCommandBar, openCommandBarWithPrompt } from '@/lib/commandBarBridge'
import { isTickerAsset } from '@/lib/portfolio'
import { useHideValues } from '@/hooks/useHideValues'
import { buildCardModel, type PulseCardModel } from '@/components/pulse/model'
import { PulseCarouselA } from '@/components/pulse/PulseCarouselA'
import { PulseHeadlineD } from '@/components/pulse/PulseHeadlineD'

// Covers the longest fixed timeframe (yearly, 365d) plus the longest
// notable-move scan window (270d, see CUSTOM_WINDOW_DAYS in
// portfolioExplanation.ts), with a little slack.
const PRICE_HISTORY_LOOKBACK_DAYS = 372

function slotKey(slot: PortfolioInsightSlot): string {
  return `${slot.scope}:${slot.scopeKey}:${slot.timeframe}`
}

function resultForSlot(assets: any[], netWorth: number, priceHistory: Map<string, TickerPricePoint[]>, slot: PortfolioInsightSlot, portfolioChange?: PortfolioChangeOverride | null) {
  return slot.timeframe === 'daily'
    ? computeMovers(assets, netWorth, portfolioChange)
    : computeMoversForWindow(assets, netWorth, priceHistory, slot.windowDays, slot.timeframe)
}

/** The Home page's Portfolio Pulse card — whichever insights are currently
 *  relevant: a stock's, a sector's, or the whole portfolio's move, at whatever
 *  timeframe actually stands out (see computeCandidateCards), plus event cards
 *  (RSU vests, lots turning long-term, ...). Each is a deterministic one-liner
 *  (no LLM call) that opens a command bar session on click, which fetches or
 *  generates that one insight's explanation.
 *
 *  This component owns the data (price history, themes, earnings, previous
 *  explanations, seen tracking, ranking); the presentation is one of two
 *  layouts chosen in Settings → Appearance (`config.pulseView`): 'carousel'
 *  (PulseCarouselA) or 'headline' (PulseHeadlineD). Renders nothing when
 *  there's nothing to show. */
export function PortfolioPulseCarousel({ assets, netWorth, dailyChange }: { assets: any[]; netWorth: number; dailyChange?: PortfolioChangeOverride | null }) {
  const [priceHistory, setPriceHistory] = useState<Map<string, TickerPricePoint[]> | null>(null)
  const [previousBySlot, setPreviousBySlot] = useState<Map<string, PortfolioExplanationRow | null>>(new Map())
  const [themes, setThemes] = useState<{ name: string; theme_targets?: { target_percentage: number | string }[] | null }[]>([])
  const [earnings, setEarnings] = useState<Map<string, string>>(new Map())
  const [seenEventIds, setSeenEventIds] = useState<Set<string>>(() => loadSeenEventIds())
  // Price-move cards opened this session read as "Seen" straight away (their
  // stored-explanation check only refreshes on the next load).
  const [openedKeys, setOpenedKeys] = useState<Set<string>>(new Set())
  const [hideValues] = useHideValues()

  const tickerIds = useMemo(
    () => [...new Set(assets.filter((a: any) => isTickerAsset(a) && a.ticker?.id).map((a: any) => a.ticker.id as string))],
    [assets],
  )
  const tickerIdsKey = tickerIds.join(',')

  // One batched price-history fetch covers every timeframe/window
  // computeCandidateSlots checks — refetches only when the actual set of
  // held tickers changes, not on every render.
  useEffect(() => {
    if (tickerIds.length === 0) { setPriceHistory(new Map()); return }
    let cancelled = false
    const sinceDate = new Date(Date.now() - PRICE_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    getTickerPriceHistory(tickerIds, sinceDate)
      .then(history => { if (!cancelled) setPriceHistory(history) })
      .catch(e => { console.error('Failed to load ticker price history', e); if (!cancelled) setPriceHistory(new Map()) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerIdsKey])

  // Theme targets (for the allocation-drift card) and upcoming earnings dates
  // (for the earnings card) — both best-effort, both only refetched when the
  // set of held tickers changes. A failure just means those cards don't show.
  useEffect(() => {
    let cancelled = false
    getAllThemes()
      .then(rows => { if (!cancelled) setThemes((rows ?? []) as any) })
      .catch(e => console.error('Failed to load themes for Portfolio Pulse', e))
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!config.hasFinnhubKey || tickerIds.length === 0) { setEarnings(new Map()); return }
    let cancelled = false
    fetchUpcomingEarnings(assets)
      .then(found => { if (!cancelled) setEarnings(found) })
      .catch(() => undefined)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerIdsKey])

  const moveCards = useMemo(() => {
    if (!priceHistory || assets.length === 0) return []
    return computeCandidateCards(assets, netWorth, priceHistory, dailyChange)
  }, [assets, netWorth, priceHistory, dailyChange])
  const slots = useMemo(() => moveCards.map(c => c.slot), [moveCards])
  const slotsKey = slots.map(slotKey).join('|')

  const eventCards = useMemo(
    () => (assets.length === 0 ? [] : filterEventsByLifecycle(computeEventCards(assets, netWorth, themes, earnings))),
    [assets, netWorth, themes, earnings],
  )

  // One cheap DB read per currently-relevant slot (typically a handful),
  // purely so buildSlotTeaser can tell "you already saw this" from
  // "something new happened since" per slot — no LLM involved.
  useEffect(() => {
    if (slots.length === 0) { setPreviousBySlot(new Map()); return }
    let cancelled = false
    Promise.all(slots.map(async (slot) => {
      try {
        const row = await getPortfolioExplanation(slot.scope, slot.scopeKey, slot.timeframe)
        return [slotKey(slot), row] as const
      } catch (e) {
        console.error('Failed to load previous explanation for slot', slotKey(slot), e)
        return [slotKey(slot), null] as const
      }
    })).then((entries) => { if (!cancelled) setPreviousBySlot(new Map(entries)) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsKey])

  // Price-move cards and event cards compete for the same few spots, ranked
  // by how much of net worth each puts at stake; anything already opened
  // (and unchanged) is demoted behind fresh cards — see rankPulseItems.
  const { items, results } = useMemo(() => {
    const results = new Map<string, ReturnType<typeof resultForSlot>>()
    if (!priceHistory) return { items: [] as PulseItem[], results }
    const items: PulseItem[] = []
    for (const card of moveCards) {
      const result = resultForSlot(assets, netWorth, priceHistory, card.slot, dailyChange)
      const previous = previousBySlot.get(slotKey(card.slot)) ?? null
      const teaser = buildSlotTeaser(card.slot, result, previous)
      if (!teaser) continue
      results.set(slotKey(card.slot), result)
      items.push({
        type: 'move',
        key: slotKey(card.slot),
        slot: card.slot,
        teaser,
        tag: card.tag,
        score: card.score,
        seen: isSlotSeenAndUnchanged(card.slot, result, previous),
      })
    }
    for (const event of eventCards) {
      items.push({ type: 'event', key: event.id, event, seen: seenEventIds.has(event.id) })
    }
    return { items: rankPulseItems(items), results }
  }, [moveCards, eventCards, assets, netWorth, priceHistory, previousBySlot, seenEventIds, dailyChange])

  const cards = useMemo<PulseCardModel[]>(() => {
    if (!priceHistory) return []
    return items.map(item => {
      const model = buildCardModel(item, { assets, priceHistory, result: results.get(item.key) })
      return openedKeys.has(model.key) ? { ...model, seen: true } : model
    })
  }, [items, results, assets, priceHistory, openedKeys])

  function openCard(card: PulseCardModel) {
    const item = card.item
    if (item.type === 'move') {
      setOpenedKeys(prev => new Set(prev).add(item.key))
      openPortfolioExplanationInCommandBar(item.slot)
    } else {
      setSeenEventIds(markEventSeen(item.event.id))
      openCommandBarWithPrompt(item.event.question)
    }
  }

  if (cards.length === 0) return null

  return config.pulseView === 'headline'
    ? <PulseHeadlineD cards={cards} onOpen={openCard} hidden={hideValues} />
    : <PulseCarouselA cards={cards} onOpen={openCard} hidden={hideValues} />
}
