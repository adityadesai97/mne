import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, ArrowRight } from 'lucide-react'
import {
  computeMovers,
  computeMoversForWindow,
  computeCandidateSlots,
  buildSlotTeaser,
  type PortfolioInsightSlot,
} from '@/lib/portfolioExplanation'
import { getTickerPriceHistory, type TickerPricePoint } from '@/lib/db/tickerPriceHistory'
import { getPortfolioExplanation, type PortfolioExplanationRow } from '@/lib/db/portfolioExplanations'
import { openPortfolioExplanationInCommandBar } from '@/lib/commandBarBridge'
import { revealUp } from '@/lib/motionPresets'
import { CardEyebrow } from '@/components/CardEyebrow'

const AUTOPLAY_MS = 6500
// Covers the longest fixed timeframe (yearly, 365d) plus the longest
// notable-move scan window (270d, see CUSTOM_WINDOW_DAYS in
// portfolioExplanation.ts), with a little slack.
const PRICE_HISTORY_LOOKBACK_DAYS = 372

function slotKey(slot: PortfolioInsightSlot): string {
  return `${slot.scope}:${slot.scopeKey}:${slot.timeframe}`
}

function resultForSlot(assets: any[], netWorth: number, priceHistory: Map<string, TickerPricePoint[]>, slot: PortfolioInsightSlot) {
  return slot.timeframe === 'daily'
    ? computeMovers(assets, netWorth)
    : computeMoversForWindow(assets, netWorth, priceHistory, slot.windowDays, slot.timeframe)
}

/** The Home page's Portfolio Pulse card — an auto-scrolling carousel of
 *  whichever insights are currently relevant: a stock's, a sector's, or the
 *  whole portfolio's move, at whatever timeframe (daily/weekly/monthly/
 *  yearly, or a "notable move" over some other window) actually stands out
 *  right now (see computeCandidateSlots). Each card is a one-line,
 *  deterministic teaser (buildSlotTeaser: no LLM call) that opens a command
 *  bar session on click, which fetches/generates that one slot's actual
 *  explanation — see CommandBar.tsx's handling of `startExplanationRequest`.
 *  Renders nothing when there's nothing to show. */
export function PortfolioPulseCarousel({ assets, netWorth }: { assets: any[]; netWorth: number }) {
  const [priceHistory, setPriceHistory] = useState<Map<string, TickerPricePoint[]> | null>(null)
  const [previousBySlot, setPreviousBySlot] = useState<Map<string, PortfolioExplanationRow | null>>(new Map())
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const tickerIds = useMemo(
    () => [...new Set(assets.filter((a: any) => a.asset_type === 'Stock' && a.ticker?.id).map((a: any) => a.ticker.id as string))],
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

  const slots = useMemo(() => {
    if (!priceHistory || assets.length === 0) return []
    return computeCandidateSlots(assets, netWorth, priceHistory)
  }, [assets, netWorth, priceHistory])
  const slotsKey = slots.map(slotKey).join('|')

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

  const cards = useMemo(() => {
    if (!priceHistory) return []
    const built: { slot: PortfolioInsightSlot; teaser: string }[] = []
    for (const slot of slots) {
      const result = resultForSlot(assets, netWorth, priceHistory, slot)
      const previous = previousBySlot.get(slotKey(slot)) ?? null
      const teaser = buildSlotTeaser(slot, result, previous)
      if (teaser) built.push({ slot, teaser })
    }
    return built
  }, [slots, assets, netWorth, priceHistory, previousBySlot])
  const cardsKey = cards.map(c => slotKey(c.slot)).join('|')

  // New content (a different set of relevant insights) always starts back
  // at the first card rather than leaving `index` pointing past the end or
  // mid-way through a story the user hasn't seen yet.
  useEffect(() => { setIndex(0) }, [cardsKey])

  useEffect(() => {
    if (cards.length <= 1 || paused) return
    const id = setInterval(() => setIndex(i => (i + 1) % cards.length), AUTOPLAY_MS)
    return () => clearInterval(id)
  }, [cards.length, paused])

  if (cards.length === 0) return null

  const current = cards[index % cards.length]

  return (
    <motion.div
      {...revealUp(0.02)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onClick={() => openPortfolioExplanationInCommandBar(current.slot)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPortfolioExplanationInCommandBar(current.slot) }
      }}
      title="Ask about this in the command bar"
      className="md:col-span-6 bg-card shadow-card rounded-2xl p-5 cursor-pointer"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <CardEyebrow icon={Sparkles}>Portfolio Pulse</CardEyebrow>
        {cards.length > 1 && (
          <div className="flex items-center gap-1 shrink-0" role="tablist" aria-label="Portfolio Pulse insights">
            {cards.map((c, i) => (
              <button
                key={slotKey(c.slot)}
                type="button"
                role="tab"
                aria-selected={i === index % cards.length}
                aria-label={`Show insight ${i + 1} of ${cards.length}`}
                onClick={(e) => { e.stopPropagation(); setIndex(i) }}
                className={`h-1.5 rounded-full transition-all ${i === index % cards.length ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`}
              />
            ))}
          </div>
        )}
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={slotKey(current.slot)}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
          className="text-sm text-foreground leading-relaxed inline-flex items-center gap-1.5 flex-wrap"
        >
          <span>{current.teaser}</span>
          <ArrowRight size={14} className="text-muted-foreground shrink-0" aria-hidden="true" />
        </motion.p>
      </AnimatePresence>
    </motion.div>
  )
}
