import { useMemo, useRef, useState } from 'react'
import { Delta } from '@/components/mne'

interface Point { date: string; value: number }

const VB_W = 300
const VB_H = 100
const PAD = 8

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}

function fmtDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed)
}

/** The design system's LineChart: 3px `chart-1` line, 12% area fill, no grid or
 *  value axis, a dashed cursor + dot and a `.mne-tip` card (value, date, change
 *  since the range start) while scrubbing. With `hideValues` the scrub is
 *  disabled entirely — the trend line alone doesn't read as a dollar figure,
 *  but the tooltip prints the exact net worth for the day under the cursor. */
export function NetWorthChart({ series, height, hideValues, label }: {
  series: Point[]
  height: number
  hideValues: boolean
  label: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)

  const geometry = useMemo(() => {
    const pts = series.length === 1 ? [series[0], series[0]] : series
    const values = pts.map(p => p.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || Math.max(1, Math.abs(max) * 0.04)
    const coords = pts.map((p, i) => ({
      x: pts.length > 1 ? (i / (pts.length - 1)) * VB_W : 0,
      y: PAD + (1 - (p.value - min) / span) * (VB_H - PAD * 2),
    }))
    const d = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')
    return { pts, coords, d, area: `${d} L${VB_W} ${VB_H} L0 ${VB_H} Z` }
  }, [series])

  const { pts, coords, d, area } = geometry
  const first = series[0]
  const last = series[series.length - 1]

  function scrub(clientX: number) {
    if (hideValues || series.length < 2) return
    const rect = plotRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    setHover(Math.round(frac * (pts.length - 1)))
  }

  const active = hover !== null && hover < pts.length ? hover : null
  const cur = active !== null ? pts[active] : null
  const curXY = active !== null ? coords[active] : null
  const change = cur && pts[0].value ? (cur.value / pts[0].value - 1) * 100 : 0
  const xFrac = curXY ? curXY.x / VB_W : 0
  const yPx = curXY ? (curXY.y / VB_H) * height : 0

  return (
    <div>
      <div
        ref={plotRef}
        className={`mne-plot${active !== null ? ' is-hover' : ''}`}
        style={{ height }}
        onPointerMove={(e) => scrub(e.clientX)}
        onPointerDown={(e) => scrub(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        {cur && curXY && (
          <div
            className="mne-tip"
            style={{
              left: `${xFrac * 100}%`,
              top: Math.max(-4, yPx - 58),
              transform: `translateX(${xFrac < 0.15 ? '0%' : xFrac > 0.85 ? '-100%' : '-50%'})`,
            }}
          >
            <b>{fmtCurrency(cur.value)}</b>
            {fmtDate(cur.date)} · <Delta value={change} digits={1} />
          </div>
        )}
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-label={label}>
          <path d={area} fill="var(--mne-chart-1)" opacity={0.12} />
          <path d={d} fill="none" stroke="var(--mne-chart-1)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {curXY && (
            <g className="cursor">
              <line x1={curXY.x} x2={curXY.x} y1={0} y2={VB_H} stroke="var(--mne-line-strong)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            </g>
          )}
        </svg>
        {curXY && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', width: 12, height: 12, borderRadius: '50%', pointerEvents: 'none',
              left: `${xFrac * 100}%`, top: yPx, transform: 'translate(-50%, -50%)',
              background: 'var(--mne-chart-1)', border: '2px solid var(--mne-surface-200)',
            }}
          />
        )}
      </div>
      {first && last && (
        <div className="mne-axis">
          <span>{fmtDate(first.date)}</span>
          <span>{fmtDate(last.date)}</span>
        </div>
      )}
    </div>
  )
}
