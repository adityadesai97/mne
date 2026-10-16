import { Delta } from '../index'
import { fmtUsd, seriesColor } from './format'

function Name({ text }: { text: string }) {
  return <span className="n" title={text}>{text}</span>
}

/** BarChart "By account": one labelled `mne-track` per row, chart-1..5 in order. */
export function TrackBars({ rows, formatValue = fmtUsd }: {
  rows: { name: string; value: number }[]
  formatValue?: (n: number) => string
}) {
  const max = Math.max(0, ...rows.map(r => r.value))
  return (
    <div className="mne-bars is-wide" style={{ marginTop: 16 }}>
      {rows.map((r, i) => (
        <div className="mne-bar-row" key={r.name}>
          <Name text={r.name} />
          <div className="mne-track"><div className="mne-fill" style={{ width: `${max > 0 ? (r.value / max) * 100 : 0}%`, background: seriesColor(i) }} /></div>
          <span className="v">{formatValue(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** BarChart "Unrealized P&L": diverging bars from a centre line, value labelled with ▲/▼ and sign. */
export function DivergingBars({ rows, formatValue = fmtUsd }: {
  rows: { name: string; value: number }[]
  formatValue?: (abs: number) => string
}) {
  const max = Math.max(0, ...rows.map(r => Math.abs(r.value)))
  // Honest proportions, but any non-zero value keeps a visible sliver (min 3% of the half-track).
  const half = (v: number) => (max > 0 && v !== 0 ? Math.max(3, (Math.abs(v) / max) * 50) : 0)
  return (
    <div className="mne-bars is-wide" style={{ marginTop: 16 }}>
      {rows.map(r => (
        <div className="mne-bar-row" key={r.name}>
          <Name text={r.name} />
          <div className="mne-diverge">
            <div className={`bar ${r.value >= 0 ? 'up' : 'down'}`} style={{ width: `${half(r.value)}%` }} />
          </div>
          <span className="v"><Delta value={r.value} format={formatValue} /></span>
        </div>
      ))}
    </div>
  )
}

/** BarChart "Cost basis vs value": thick bar = current value, thin dark bar = cost basis. */
export function CostValueBars({ rows, formatValue = fmtUsd }: {
  rows: { name: string; costBasis: number; currentValue: number }[]
  formatValue?: (n: number) => string
}) {
  const max = Math.max(0, ...rows.flatMap(r => [r.costBasis, r.currentValue]))
  const w = (n: number) => `${max > 0 ? (n / max) * 100 : 0}%`
  return (
    <div className="mne-bars is-wide" style={{ marginTop: 16 }}>
      <div className="mne-legend mne-legend-bars" aria-hidden="true">
        <span><i className="is-thick" style={{ background: 'var(--mne-chart-1)' }} />Current value</span>
        <span><i className="is-thin" style={{ background: 'var(--mne-ink)' }} />Cost basis</span>
      </div>
      {rows.map(r => (
        <div className="mne-bar-row" key={r.name}>
          <Name text={r.name} />
          <div className="mne-track" role="img" aria-label={`${r.name}: value ${formatValue(r.currentValue)}, cost basis ${formatValue(r.costBasis)}`}>
            <div className="mne-fill" style={{ width: w(r.currentValue), background: 'var(--mne-chart-1)' }} />
            <div className="mne-fill is-thin" style={{ width: w(r.costBasis), background: 'var(--mne-ink)' }} />
          </div>
          <span className="v">{formatValue(r.currentValue)}</span>
        </div>
      ))}
    </div>
  )
}
