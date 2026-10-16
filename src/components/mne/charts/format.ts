export function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export function fmtCompactUsd(n: number): string {
  const abs = Math.abs(n)
  const body = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M` : abs >= 1_000 ? `${(abs / 1_000).toFixed(0)}k` : String(Math.round(abs))
  return `${n < 0 ? '−' : ''}$${body}`
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export type Segment = { name: string; value: number }

/** The design has five series colours: keep the largest four and fold the rest into "Other". */
export function capSegments(segments: Segment[], max = 5): Segment[] {
  const sorted = [...segments].sort((a, b) => b.value - a.value)
  if (sorted.length <= max) return sorted
  const head = sorted.slice(0, max - 1)
  const other = sorted.slice(max - 1).reduce((s, g) => s + g.value, 0)
  return [...head, { name: 'Other', value: other }]
}

export function seriesColor(i: number): string {
  return `var(--mne-chart-${(i % 5) + 1})`
}
