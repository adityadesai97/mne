import { fmtUsd, pct, seriesColor } from './format'

/**
 * ThemeTargetChart: each theme's share as a `mne-track`/`mne-fill`; when the
 * theme has a target, a dark `mne-target` tick marks it and the gap is written
 * out in points ("▲ +9 pts"), so the tick is never the only cue.
 */
export function ThemeTargetBars({ rows, targets, formatValue = fmtUsd }: {
  rows: { name: string; value: number }[]
  /** theme name → target percentage */
  targets?: Record<string, number>
  formatValue?: (n: number) => string
}) {
  const total = rows.reduce((s, r) => s + r.value, 0)
  const anyTarget = rows.some(r => targets?.[r.name] !== undefined)
  return (
    <div className="mne-bars is-wide" style={{ marginTop: 16 }}>
      {rows.map((r, i) => {
        const share = pct(r.value, total)
        const target = targets?.[r.name]
        const drift = target !== undefined ? share - target : null
        return (
          <div className="mne-bar-row" key={r.name} title={formatValue(r.value)}>
            <span className="n">{r.name}</span>
            <div className="mne-track" role="img" aria-label={`${r.name}: ${Math.round(share)}%${target !== undefined ? `, target ${Math.round(target)}%` : ''}`}>
              <div className="mne-fill" style={{ width: `${share}%`, background: seriesColor(i) }} />
              {target !== undefined && <div className="mne-target" style={{ left: `${Math.min(100, Math.max(0, target))}%` }} />}
            </div>
            <span className="v">
              {Math.round(share)}%{' '}
              {drift !== null && Math.round(drift) !== 0
                ? <span className="mne-down mne-num">{drift > 0 ? '▲ +' : '▼ −'}{Math.abs(Math.round(drift))} pts</span>
                : null}
            </span>
          </div>
        )
      })}
      {anyTarget && <div className="mne-help">The dark tick marks each theme&rsquo;s target.</div>}
    </div>
  )
}
