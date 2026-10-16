// Portfolio Pulse, "Headline" layout: the top-ranked insight set large, with
// the rest folded behind a "N more insights" disclosure that expands into
// compact rows. Collapsed rows are `inert`, so they can't be tabbed to or read.
import { useId, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { AiMark } from '@/components/mne/AiMark'
import { Chip } from '@/components/mne'
import { CardEyebrow } from '@/components/CardEyebrow'
import type { PulseCardModel } from './model'
import { MaskedText, PulseFigure, PulseVisualView, SeenMark } from './parts'

function PulseRow({ card, onOpen, hidden }: { card: PulseCardModel; onOpen: (c: PulseCardModel) => void; hidden: boolean }) {
  const Icon = card.icon
  return (
    <li>
      <button type="button" className={`pulse-row${card.seen ? ' is-seen' : ''}`} title="Ask about this in the command bar" onClick={() => onOpen(card)}>
        <span className="pulse-row-ico" aria-hidden="true"><Icon size={18} strokeWidth={1.5} /></span>
        <span className="pulse-row-main">
          <span className="pulse-chips">
            {card.tag && <Chip variant={card.tagVariant}>{card.tag}</Chip>}
            {card.timeframe && <Chip variant="outline">{card.timeframe}</Chip>}
            <SeenMark seen={card.seen} />
          </span>
          <span className="pulse-row-text"><MaskedText text={card.text} hidden={hidden} /></span>
          <PulseFigure card={card} className="is-inline" />
        </span>
        <PulseFigure card={card} className="is-end" />
        <ChevronRight size={16} className="pulse-chev" aria-hidden="true" />
      </button>
    </li>
  )
}

export function PulseHeadlineD({ cards, onOpen, hidden }: {
  cards: PulseCardModel[]
  onOpen: (card: PulseCardModel) => void
  hidden: boolean
}) {
  const [open, setOpen] = useState(false)
  const regionId = useId()
  const [top, ...rest] = cards
  if (!top) return null
  const restUnseen = rest.filter(c => !c.seen).length

  return (
    <section className="mne-card pulse-d" aria-label="Portfolio Pulse">
      <div className="pulse-head">
        <CardEyebrow icon={AiMark}>Portfolio Pulse</CardEyebrow>
      </div>

      <div className={`pulse-d-head${top.seen ? ' is-seen' : ''}`} data-testid="pulse-top">
        <div className="pulse-chips">
          {top.tag && <Chip variant={top.tagVariant}>{top.tag}</Chip>}
          {top.timeframe && <Chip variant="outline">{top.timeframe}</Chip>}
          <SeenMark seen={top.seen} />
        </div>
        <button type="button" className="pulse-d-hit" title="Ask about this in the command bar" onClick={() => onOpen(top)}>
          <MaskedText text={top.text} hidden={hidden} />
        </button>
        <div className="pulse-d-row2">
          <PulseFigure card={top} className="is-big" />
          <PulseVisualView visual={top.visual} />
        </div>
      </div>

      {rest.length > 0 && (
        <>
          <button
            type="button"
            className="pulse-disc"
            aria-expanded={open}
            aria-controls={regionId}
            onClick={() => setOpen(o => !o)}
          >
            <span className="stack" aria-hidden="true">
              {rest.slice(0, 4).map(c => { const Icon = c.icon; return <span key={c.key}><Icon size={14} strokeWidth={1.5} /></span> })}
            </span>
            <span className="t">
              {rest.length} more {rest.length === 1 ? 'insight' : 'insights'}
              {restUnseen > 0 && <small>{restUnseen} new</small>}
            </span>
            <ChevronDown size={18} className="chev" aria-hidden="true" />
          </button>
          <div id={regionId} className={`pulse-more${open ? ' is-open' : ''}`} inert={!open}>
            <div>
              <ul className="pulse-list">
                {rest.map(c => <PulseRow key={c.key} card={c} onOpen={onOpen} hidden={hidden} />)}
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
