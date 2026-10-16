// Small building blocks shared by the summary and timeline lot layouts.
import { useId, useState, type ReactNode } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Delta } from '@/components/mne'
import { hiddenValueClass } from '@/hooks/useHideValues'
import '@/styles/portfolio.css'
import '@/styles/lots.css'

export type LotLayout = 'default' | 'timeline'

export function Hide({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return <span className={hiddenValueClass(hidden)}>{children}</span>
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`pf-chev${open ? ' is-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function TermChip({ isLong }: { isLong: boolean }) {
  return (
    <span className="mne-chip is-outline lot-chip">
      <span className={`lot-dot ${isLong ? 'is-long' : 'is-short'}`} aria-hidden="true" />
      {isLong ? 'Long term' : 'Short term'}
    </span>
  )
}

/** Signed gain with arrow, used wherever a lot or grant shows a result. */
export function GainText({ gain, pct, hidden, format }: {
  gain: number | null
  pct?: number | null
  hidden: boolean
  format: (abs: number) => string
}) {
  if (gain === null) return <span className="mne-muted">—</span>
  return (
    <span className="lot-gain">
      <Hide hidden={hidden}><Delta value={gain} format={format} /></Hide>
      {pct != null && <Delta value={pct} digits={1} />}
    </span>
  )
}

/** Icon-only edit/delete pair used on the summary rows. */
export function RowActions({ onEdit, onDelete, editLabel, deleteLabel }: {
  onEdit?: () => void
  onDelete?: () => void
  editLabel: string
  deleteLabel: string
}) {
  if (!onEdit && !onDelete) return null
  return (
    <span className="lot-acts">
      {onEdit && (
        <button type="button" className="pf-iconbtn" aria-label={editLabel} onClick={onEdit}>
          <Pencil size={14} aria-hidden="true" />
        </button>
      )}
      {onDelete && (
        <button type="button" className="pf-iconbtn is-danger" aria-label={deleteLabel} onClick={onDelete}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

/** Text edit/delete pair used inside an expanded timeline entry. */
export function TextActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  if (!onEdit && !onDelete) return null
  return (
    <div className="lot-text-acts">
      {onEdit && (
        <button type="button" className="lot-textbtn" onClick={onEdit}>
          <Pencil size={14} aria-hidden="true" /> Edit
        </button>
      )}
      {onDelete && (
        <button type="button" className="lot-textbtn is-danger" onClick={onDelete}>
          <Trash2 size={14} aria-hidden="true" /> Delete
        </button>
      )}
    </div>
  )
}

/** "Show lot detail" disclosure: the lot list stays collapsed until asked for. */
export function LotDisclosure({ label, count, defaultOpen = false, children }: {
  label: string
  count: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  return (
    <div className="lot-wrap">
      <button type="button" className="pf-disclose" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(o => !o)}>
        <span className="lot-flex">
          <Chevron open={open} />
          <b>{open ? 'Hide' : 'Show'} {label}</b>
        </span>
        <span className="mne-help">{count}</span>
      </button>
      {open && <div id={panelId} className="pf-fade" style={{ marginTop: 8 }}>{children}</div>}
    </div>
  )
}

export function ProgressBar({ pct, tone }: { pct: number; tone?: 'long' | 'accent' }) {
  return (
    <div className="lot-bar" aria-hidden="true">
      <i className={tone ? `is-${tone}` : undefined} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

export function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
  )
}

/** One entry in the vertical timeline (a lot or an upcoming event). */
export function TimelineEvent({ title, sub, right }: { title: ReactNode; sub: ReactNode; right?: ReactNode }) {
  return (
    <li className="lot-tli is-evt">
      <span className="lot-pin"><span className="lot-dot is-evt" /></span>
      <div className="lot-tli-hd">
        <span className="lot-what">{title}<span className="lot-sub">{sub}</span></span>
        <span className="lot-gl">{right}</span>
      </div>
    </li>
  )
}

export function TimelineLot({ dot, title, sub, right, open, onToggle, children }: {
  dot: 'long' | 'short' | 'accent'
  title: ReactNode
  sub: ReactNode
  right: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const panelId = useId()
  return (
    <li className={`lot-tli${open ? ' is-open' : ''}`}>
      <span className="lot-pin"><span className={`lot-dot is-${dot}`} /></span>
      <button type="button" className="lot-tli-hd" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span className="lot-what">{title}<span className="lot-sub">{sub}</span></span>
        <span className="lot-gl">{right}</span>
        <span className="lot-chev"><Chevron open={open} /></span>
      </button>
      {open && <div id={panelId} className="lot-det pf-fade">{children}</div>}
    </li>
  )
}

export function TimelineLegend({ extra }: { extra?: ReactNode }) {
  return (
    <div className="lot-legend">
      <span><i className="lot-dot is-long" aria-hidden="true" />Long term</span>
      <span><i className="lot-dot is-short" aria-hidden="true" />Short term</span>
      <span><i className="lot-dot is-evt" aria-hidden="true" />Upcoming</span>
      <span className="lot-legend-end">{extra ?? 'Tap a lot for details'}</span>
    </div>
  )
}

export function TodayMarker({ label }: { label: string }) {
  return <li className="lot-today" aria-label={`Today, ${label}`}>Today · {label}</li>
}

export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="lot-dl">
      {items.map(i => (
        <div key={i.label}><dt>{i.label}</dt><dd>{i.value}</dd></div>
      ))}
    </dl>
  )
}
