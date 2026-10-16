// Small building blocks shared by both Portfolio Pulse layouts.
import type { ReactNode } from 'react'
import { Delta } from '@/components/mne'
import { hiddenValueClass } from '@/hooks/useHideValues'
import type { PulseCardModel, PulseVisual } from './model'
import '@/styles/pulse.css'

/** Blurs dollar amounts in a one-liner when Privacy mode is on. */
export function MaskedText({ text, hidden }: { text: string; hidden: boolean }) {
  if (!hidden) return <>{text}</>
  return (
    <>
      {text.split(/(\$[\d,]+(?:\.\d+)?)/).map((part, i) =>
        /^\$/.test(part) ? <span key={i} className={hiddenValueClass(true)}>{part}</span> : part,
      )}
    </>
  )
}

/** "New" (dot + word) or "Seen": never colour alone. */
export function SeenMark({ seen }: { seen: boolean }) {
  return seen
    ? <span className="pulse-seen">Seen</span>
    : <span className="pulse-seen"><i className="pulse-dot" aria-hidden="true" />New</span>
}

/** The big right-hand figure: a signed ▲/▼ percent, or a countdown/plain metric. */
export function PulseFigure({ card, className = '' }: { card: PulseCardModel; className?: string }) {
  if (card.delta == null && !card.metric) return null
  return (
    <span className={`pulse-figure ${className}`}>
      {card.delta != null ? <Delta value={card.delta} /> : <span className="mne-num">{card.metric}</span>}
      {card.unit && <small>{card.unit}</small>}
    </span>
  )
}

function Spark({ values, dir, base }: { values: number[]; dir: 'up' | 'down'; base?: number }) {
  const w = 150
  const h = 44
  const all = base != null ? [...values, base] : values
  let mn = Math.min(...all)
  let mx = Math.max(...all)
  const pad = (mx - mn) * 0.12 || 1
  mn -= pad
  mx += pad
  const y = (v: number) => h - ((v - mn) / (mx - mn)) * h
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)} ${y(v).toFixed(1)}`).join('')
  return (
    <svg className={`pulse-spark ${dir}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {base != null && <line className="base" x1="0" x2={w} y1={y(base)} y2={y(base)} />}
      <path className="ar" d={`${d}L${w} ${h}L0 ${h}Z`} />
      <path className="ln" d={d} />
    </svg>
  )
}

/** Decorative thumbnail. The text beside it carries the meaning, so the whole
 *  thing is aria-hidden; returns null when there's no data. */
export function PulseVisualView({ visual, showLabel = true }: { visual: PulseVisual | null; showLabel?: boolean }): ReactNode {
  if (!visual) return null
  switch (visual.kind) {
    case 'spark':
      return <div className="pulse-vis" aria-hidden="true"><Spark values={visual.values} dir={visual.dir} base={visual.base} /></div>
    case 'progress':
      return (
        <div className="pulse-vis pulse-prog" aria-hidden="true">
          <div className="rail"><i style={{ width: `${visual.pct}%` }} /></div>
          {showLabel && <small>{visual.label}</small>}
        </div>
      )
    case 'vest':
      return (
        <div className="pulse-vis pulse-segs" aria-hidden="true">
          <div className="segs">
            {Array.from({ length: Math.min(visual.total, 24) }, (_, i) => (
              <i key={i} className={i < visual.done ? 'd' : i === visual.done ? 'n' : ''} />
            ))}
          </div>
          {showLabel && <small>{visual.label}</small>}
        </div>
      )
    case 'target': {
      const max = Math.max(visual.actual, visual.target, 1) * 1.15
      return (
        <div className="pulse-vis pulse-prog" aria-hidden="true">
          <div className="rail">
            <i style={{ width: `${(visual.actual / max) * 100}%` }} />
            <b className="tgt" style={{ left: `${(visual.target / max) * 100}%` }} />
          </div>
          {showLabel && <small>{visual.label}</small>}
        </div>
      )
    }
  }
}
