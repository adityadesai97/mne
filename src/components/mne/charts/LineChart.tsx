import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Delta } from '../index'
import { fmtUsd, prefersReducedMotion } from './format'

const W = 300
const H = 120
const POINTS = 64 // every series is resampled to this many points so ranges can morph into each other

function resample(values: number[]): number[] {
  const n = values.length
  if (n === 0) return Array(POINTS).fill(0)
  if (n === 1) return Array(POINTS).fill(values[0])
  return Array.from({ length: POINTS }, (_, i) => {
    const x = (i / (POINTS - 1)) * (n - 1)
    const lo = Math.floor(x)
    const hi = Math.min(n - 1, lo + 1)
    return values[lo] + (values[hi] - values[lo]) * (x - lo)
  })
}

function toY(vs: number[]): number[] {
  const mn = Math.min(...vs)
  const mx = Math.max(...vs)
  return vs.map(v => 10 + (1 - (v - mn) / (mx - mn || 1)) * 100)
}

/**
 * LineChart (design: LineChart): a single-series SVG line with a soft area
 * fill. Hover or touch shows a dashed cursor, a dot and a tooltip with the
 * value, its label and the change since the start. The line draws in on mount
 * (600ms) and morphs between datasets (180ms); reduced motion skips both.
 *
 * `values` and `labels` are parallel arrays. Change `replayKey` to replay the
 * draw-in (e.g. from a "Replay" button).
 */
export function LineChart({
  values,
  labels,
  formatValue = fmtUsd,
  color = 'var(--mne-chart-1)',
  ariaLabel,
  replayKey = 0,
  showAxis = true,
}: {
  values: number[]
  labels: string[]
  formatValue?: (v: number) => string
  color?: string
  ariaLabel: string
  replayKey?: number
  showAxis?: boolean
}) {
  const target = useMemo(() => resample(values), [values])
  const [shown, setShown] = useState<number[]>(target)
  const shownRef = useRef(shown)
  shownRef.current = shown

  // morph the displayed series toward the new one in 180ms (standard curve approximated by ease-out)
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(target); return }
    const from = shownRef.current
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 180)
      const e = 1 - (1 - p) * (1 - p)
      setShown(from.map((y, i) => y + (target[i] - y) * e))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])

  const ys = useMemo(() => toY(shown), [shown])
  const x = (i: number) => (i * W) / (POINTS - 1)
  const d = useMemo(() => ys.map((y, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y.toFixed(1)}`).join(' '), [ys])

  // draw-in
  const lineRef = useRef<SVGPathElement>(null)
  useEffect(() => {
    const el = lineRef.current
    if (!el || prefersReducedMotion() || typeof el.animate !== 'function') return
    const len = el.getTotalLength?.() ?? 0
    if (!len) return
    el.animate(
      [{ strokeDasharray: len, strokeDashoffset: len }, { strokeDasharray: len, strokeDashoffset: 0 }],
      { duration: 600, easing: 'cubic-bezier(.4,0,.2,1)' },
    )
    // only on mount and explicit replays
  }, [replayKey])

  // hover
  const plotRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null) // index into the original values
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 })

  const onMove = useCallback((clientX: number) => {
    const svg = svgRef.current
    if (!svg || values.length === 0) return
    const r = svg.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)))
    setHover(Math.round(frac * (values.length - 1)))
  }, [values.length])

  const hi = hover !== null && hover < values.length ? hover : null
  const px = hi !== null ? (values.length > 1 ? (hi / (values.length - 1)) * W : W / 2) : 0
  const py = hi !== null ? ys[Math.round((px / W) * (POINTS - 1))] : 0

  useLayoutEffect(() => {
    if (hi === null || !svgRef.current || !tipRef.current) return
    const r = svgRef.current.getBoundingClientRect()
    const sc = r.width / W
    const w = tipRef.current.offsetWidth
    setTipPos({ x: Math.max(0, Math.min(r.width - w, px * sc - w / 2)), y: Math.max(-4, py * sc - 58) })
  }, [hi, px, py])

  const change = hi !== null && values[0] ? (values[hi] / values[0] - 1) * 100 : null

  if (values.length === 0) return null
  return (
    <>
      <div
        ref={plotRef}
        className={`mne-plot${hi !== null ? ' is-hover' : ''}`}
        onPointerMove={e => onMove(e.clientX)}
        onPointerDown={e => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <div className="mne-tip" ref={tipRef} style={{ transform: `translate(${tipPos.x}px,${tipPos.y}px)` }} aria-hidden="true">
          {hi !== null && (
            <>
              <b>{formatValue(values[hi])}</b>
              {labels[hi]}
              {change !== null && <> · <Delta value={change} digits={1} /></>}
            </>
          )}
        </div>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
          <path d={`${d} L${W} ${H} L0 ${H} Z`} fill={color} opacity=".12" />
          <path ref={lineRef} d={d} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <g className="cursor">
            <line x1={px} x2={px} y1="0" y2={H} stroke="var(--mne-line-strong)" strokeDasharray="3 3" />
            <circle cx={px} cy={py} r="5" fill={color} stroke="var(--mne-surface-200)" strokeWidth="2" />
          </g>
        </svg>
      </div>
      {showAxis && (
        <div className="mne-axis"><span>{labels[0]}</span><span>{labels[labels.length - 1]}</span></div>
      )}
    </>
  )
}
