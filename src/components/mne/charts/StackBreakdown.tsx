import type { ReactNode } from 'react'
import { fmtUsd, pct, seriesColor, type Segment } from './format'

/**
 * AllocationBreakdown: a segmented `mne-stack` bar over a labelled
 * `mne-breakdown` list (name, share, amount). Series colours run chart-1..5 in
 * order; every segment is named in the list so hue is never the only cue.
 */
export function StackBreakdown({
  segments,
  height,
  formatValue = fmtUsd,
  label,
  empty = 'No data',
}: {
  segments: (Segment & { display?: ReactNode })[]
  height?: number
  formatValue?: (n: number) => string
  label: string
  empty?: string
}) {
  const total = segments.reduce((s, g) => s + Math.abs(g.value), 0)
  if (segments.length === 0 || total <= 0) return <p className="mne-help" style={{ marginTop: 14 }}>{empty}</p>
  return (
    <>
      <div className="mne-stack" role="img" aria-label={label} style={{ marginTop: 14, ...(height ? { height } : {}) }}>
        {segments.map((s, i) => (
          <span key={s.name} style={{ width: `${pct(Math.abs(s.value), total)}%`, background: seriesColor(i) }} />
        ))}
      </div>
      <div className="mne-breakdown">
        {segments.map((s, i) => (
          <div key={s.name}>
            <i style={{ background: seriesColor(i) }} />
            <span>{s.name}</span>
            <span className="mne-muted">{Math.round(pct(Math.abs(s.value), total))}%</span>
            <b>{s.display ?? formatValue(s.value)}</b>
          </div>
        ))}
      </div>
    </>
  )
}
