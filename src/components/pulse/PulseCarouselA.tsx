// Portfolio Pulse, "Carousel" layout: one insight at a time as a large card,
// with prev/next arrows, pips, a count and a progress ring that is both the
// autoplay timer and its pause/play button. Autoplay is off under reduced
// motion and pauses while the pointer or focus is inside.
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, Sparkles } from 'lucide-react'
import { Chip } from '@/components/mne'
import { CardEyebrow } from '@/components/CardEyebrow'
import type { PulseCardModel } from './model'
import { MaskedText, PulseFigure, PulseVisualView, SeenMark, useReducedMotion } from './parts'

/** Matches the ring's CSS animation duration in pulse.css. */
export const PULSE_AUTOPLAY_MS = 3200

export function PulseCarouselA({ cards, onOpen, hidden }: {
  cards: PulseCardModel[]
  onOpen: (card: PulseCardModel) => void
  hidden: boolean
}) {
  const reduced = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [userPlaying, setUserPlaying] = useState<boolean | null>(null)
  const [hold, setHold] = useState(false)
  const [entered, setEntered] = useState(false)
  const playing = (userPlaying ?? !reduced) && !reduced && cards.length > 1

  const cardsKey = cards.map(c => c.key).join('|')
  // A different set of insights starts back at the first card.
  useEffect(() => { setIndex(0); setEntered(false) }, [cardsKey])

  const safe = Math.min(index, cards.length - 1)
  const card = cards[safe]
  if (!card) return null
  const unseen = cards.filter(c => !c.seen).length

  function go(i: number) {
    setIndex((i + cards.length) % cards.length)
    setEntered(!reduced)
  }

  return (
    <section
      className="mne-card pulse-a"
      aria-roledescription="carousel"
      aria-label="Portfolio Pulse"
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
    >
      <div className="pulse-head">
        <CardEyebrow icon={Sparkles}>Portfolio Pulse</CardEyebrow>
        {unseen > 0 && <span className="pulse-newcount">{unseen} new</span>}
      </div>

      <div
        key={card.key}
        className={`pulse-a-card${card.seen ? ' is-seen' : ''}${entered ? ' is-enter' : ''}`}
        role="group"
        aria-roledescription="slide"
        aria-label={`${safe + 1} of ${cards.length}`}
        aria-live={playing && !hold ? 'off' : 'polite'}
        data-testid="pulse-card"
      >
        <div className="pulse-a-main">
          <div className="pulse-chips">
            {card.tag && <Chip variant={card.tagVariant}>{card.tag}</Chip>}
            {card.timeframe && <Chip variant="outline">{card.timeframe}</Chip>}
            <SeenMark seen={card.seen} />
          </div>
          <button type="button" className="pulse-a-hit" title="Ask about this in the command bar" onClick={() => onOpen(card)}>
            <MaskedText text={card.text} hidden={hidden} />
          </button>
        </div>
        <div className="pulse-a-side">
          <PulseFigure card={card} className="is-big" />
          <PulseVisualView visual={card.visual} />
        </div>
      </div>

      {cards.length > 1 && (
        <div className="pulse-foot">
          <div className="pulse-ctl">
            <button type="button" className="pulse-icon-btn" aria-label="Previous insight" onClick={() => go(safe - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
            <button type="button" className="pulse-icon-btn" aria-label="Next insight" onClick={() => go(safe + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
          </div>
          <div className="pulse-pips" role="group" aria-label="Choose insight">
            {cards.map((c, i) => (
              <button
                key={c.key}
                type="button"
                className={c.seen ? '' : 'is-unseen'}
                aria-current={i === safe ? 'true' : undefined}
                aria-label={`Insight ${i + 1} of ${cards.length}${c.seen ? '' : ', new'}`}
                onClick={() => go(i)}
              />
            ))}
          </div>
          <div className="pulse-ctl">
            <span className="pulse-count" aria-hidden="true">{safe + 1} of {cards.length}</span>
            <button
              type="button"
              className={`pulse-ring ${playing ? 'is-run' : 'is-static'}${hold ? ' is-hold' : ''}`}
              aria-label={playing ? 'Pause autoplay' : 'Start autoplay'}
              aria-pressed={playing}
              onClick={() => { setUserPlaying(!playing) }}
            >
              <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                <circle className="tr" cx="16" cy="16" r="13" />
                <circle
                  key={`${card.key}:${playing}`}
                  className="pr"
                  cx="16" cy="16" r="13"
                  onAnimationEnd={() => { if (playing) go(safe + 1) }}
                />
              </svg>
              <span className="glyph" aria-hidden="true">{playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
