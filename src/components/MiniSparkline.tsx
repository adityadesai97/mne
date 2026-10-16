// Small, dependency-free inline charts for stat tiles. Deliberately plain
// SVG (no ECharts instance, no framer-motion) — these render inside compact
// cards where the cost/complexity of a full chart isn't worth it.

/** A thin trend line through `values`. Renders nothing if there's not enough data to draw a line. */
export function MiniSparkline({ values, color, height = 28 }: { values: number[]; color: string; height?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const width = 100
  // Keep the line's own local peaks/troughs inset from the top/bottom edge of
  // its box — otherwise a point that happens to be the min or max sits right
  // on the boundary, and combined with a rounded-sm card corner clipping the
  // box from outside, it reads as the line being cut off rather than just
  // reaching its natural high/low point.
  const vPadding = height * 0.18
  const drawableHeight = height - vPadding * 2
  const coords = values.map((v, i) => ({
    x: (i / (values.length - 1)) * width,
    y: vPadding + (drawableHeight - ((v - min) / range) * drawableHeight),
  }))
  const points = coords.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const last = coords[coords.length - 1]

  // Design-system Sparkline: 2px round line in the trend colour plus a dot on
  // the latest point (an absolutely positioned span, so the stretched viewBox
  // doesn't squash it into an ellipse).
  return (
    <div className="mne-spark relative w-full" style={{ height }} aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="absolute rounded-full"
        style={{ width: 7, height: 7, background: color, left: `${(last.x / width) * 100}%`, top: last.y, transform: 'translate(-50%, -50%)' }}
      />
    </div>
  )
}

/** A radial progress ring showing `pct` (0-100) of some magnitude. */
export function MiniRing({ pct, color, size = 30 }: { pct: number; color: string; size?: number }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const strokeWidth = 3
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - clamped / 100)

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--mne-surface-300)" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset var(--mne-dur-layout) var(--mne-ease)' }}
      />
    </svg>
  )
}

/**
 * MiniRing with its value printed in the center and a caption underneath —
 * a bare ring reads as ambiguous decoration; a number inside it plus a label
 * reads as "34% of something" at a glance, matching the same figure already
 * spelled out in the card's body text below it.
 */
export function RingStat({ pct, color, label, size = 44 }: { pct: number; color: string; label: string; size?: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <MiniRing pct={pct} color={color} size={size} />
        <span className="absolute text-xs font-semibold tabular-nums" style={{ color }}>
          {Math.round(pct)}%
        </span>
      </div>
      <span className="mne-eyebrow" style={{ lineHeight: 1 }}>{label}</span>
    </div>
  )
}
