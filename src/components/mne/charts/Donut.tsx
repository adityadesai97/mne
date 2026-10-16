import { useEffect, useRef, useState } from 'react'
import { fmtUsd, pct, prefersReducedMotion, seriesColor, type Segment } from './format'

const R = 44
const C = 2 * Math.PI * R

/**
 * DonutChart: sweeping SVG circles (600ms). Hovering/tapping a segment dims the
 * others, thickens it and shows its share and amount in the centre; otherwise
 * the centre shows the total. Pair it with a legend (names + percentages).
 */
export function Donut({ segments, centerLabel = 'Total', centerValue, formatValue = fmtUsd, label }: {
  segments: Segment[]
  centerLabel?: string
  centerValue?: string
  formatValue?: (n: number) => string
  label: string
}) {
  const total = segments.reduce((s, g) => s + g.value, 0)
  const [active, setActive] = useState<number | null>(null)
  const circles = useRef<(SVGCircleElement | null)[]>([])

  useEffect(() => {
    if (prefersReducedMotion()) return
    circles.current.forEach((c, i) => {
      if (!c || !segments[i]) return
      const len = Math.max(0, C * (segments[i].value / total) - 2)
      c.animate(
        [{ strokeDasharray: `0 ${C}` }, { strokeDasharray: `${len} ${C}` }],
        { duration: 600, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'backwards' },
      )
    })
    // sweep once per data change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments.map(s => `${s.name}:${s.value}`).join('|')])

  if (total <= 0) return null
  let offset = 0
  const act = active !== null ? segments[active] : null
  return (
    <div className={`mne-donut${act ? ' is-hover' : ''}`} onPointerLeave={() => setActive(null)}>
      <svg viewBox="0 0 120 120" width="170" role="img" aria-label={label}>
        {segments.map((s, i) => {
          const share = s.value / total
          const el = (
            <circle
              key={s.name}
              ref={n => { circles.current[i] = n }}
              className={active === i ? 'on' : undefined}
              cx="60" cy="60" r={R} fill="none" stroke={seriesColor(i)} strokeWidth="16"
              style={{ strokeDasharray: `${Math.max(0, C * share - 2)} ${C}`, strokeDashoffset: -offset * C }}
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
            />
          )
          offset += share
          return el
        })}
      </svg>
      <div className="mne-donut-center">
        {act ? (
          <div><b>{Math.round(pct(act.value, total))}%</b>{act.name}<br />{formatValue(act.value)}</div>
        ) : (
          <div><b>{centerValue ?? formatValue(total)}</b>{centerLabel}</div>
        )}
      </div>
    </div>
  )
}
