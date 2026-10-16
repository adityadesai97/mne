/**
 * Sparkline (design: Sparkline): a 120x36 trend line with an end dot, drawn in
 * gain/loss colour from the first-to-last direction. Pair it with a signed,
 * arrowed figure ("▲ +4.2% 30d") — colour alone never carries the direction.
 */
export function Sparkline({ values, width = 120, height = 36, ariaLabel, tone }: {
  values: number[]
  width?: number
  height?: number
  ariaLabel: string
  /** Override the colour; defaults to gain when the last value >= the first. */
  tone?: 'gain' | 'loss'
}) {
  if (values.length < 2) return null
  const up = tone ? tone === 'gain' : values[values.length - 1] >= values[0]
  const color = up ? 'var(--mne-gain)' : 'var(--mne-loss)'
  const mn = Math.min(...values)
  const mx = Math.max(...values)
  const padX = 2
  const padY = 6
  const pts = values.map((v, i) => [
    padX + (i * (width - padX * 2)) / (values.length - 1),
    padY + (1 - (v - mn) / (mx - mn || 1)) * (height - padY * 2),
  ])
  const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg className="mne-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3.5" fill={color} />
    </svg>
  )
}
