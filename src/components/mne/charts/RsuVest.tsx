import { Stat } from '../index'
import type { RsuTimelineRow } from '@/lib/charts'

const MAX_TICKS = 8
const monthYear = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
const monthDay = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * RsuVestChart: one `mne-vest` rail per grant. Filled rail = time elapsed,
 * ticks = vest events (accent when done), the cliff is a diamond, and the
 * Today label sits on the rail. Vested / next-vest figures are written above.
 */
export function RsuVestRail({ row }: { row: RsuTimelineRow }) {
  const span = Math.max(1, row.endMs - row.startMs)
  // keep ticks inside 3%..97% so their labels never clip at the card edge
  const at = (ms: number) => 3 + Math.min(1, Math.max(0, (ms - row.startMs) / span)) * 94
  const today = at(row.todayMs)
  const cliff = row.cliffMs !== null ? at(row.cliffMs) : null
  const finalAt = at(row.endMs)
  const showAllTicks = row.events.length <= MAX_TICKS
  const ticks = row.events.filter((e, i) => showAllTicks || i === 0 || i === row.events.length - 1 || e === row.events.find(x => !x.done))
  // keep edge labels inside the card: right-align near the end, left-align near the start
  const labStyle = (left: number) => ({ left: `${left}%`, ...(left > 88 ? { transform: 'translateX(-100%)' } : left < 12 ? { transform: 'none' } : {}) })
  const pctVested = row.totalShares > 0 ? Math.round((row.vestedShares / row.totalShares) * 100) : 0
  const fmtN = (n: number) => n.toLocaleString('en-US')

  return (
    <div className="mne-rsu-grant">
      <div className="mne-rsu-head">
        <Stat label={row.label} value={<>{fmtN(row.vestedShares)} of {fmtN(row.totalShares)} <span className="mne-muted mne-rsu-pct">· {pctVested}%</span></>} />
        <Stat
          className="mne-rsu-next"
          label={row.ended ? 'Status' : 'Next vest'}
          value={row.ended ? 'Ended' : row.nextVest ? `${monthDay(row.nextVest.ms)} · ${fmtN(row.nextVest.shares)} sh` : row.vestedShares >= row.totalShares ? 'Fully vested' : 'Ongoing'}
        />
      </div>
      <div className="mne-vest has-today-row" role="img" aria-label={`${row.label}: ${fmtN(row.vestedShares)} of ${fmtN(row.totalShares)} shares vested (${pctVested}%)`}>
        <div className="rail" />
        <div className="done" style={{ width: `${today}%` }} />
        {ticks.map(e => {
          const isCliff = cliff !== null && Math.abs(at(e.ms) - cliff) < 0.01
          return <span key={e.ms} className={`tick${e.done ? ' is-done' : ''}${isCliff ? ' is-cliff' : ''}`} style={{ left: `${at(e.ms)}%` }} />
        })}
        {row.events.length === 0 && cliff !== null && <span className={`tick is-cliff${row.todayMs >= (row.cliffMs ?? 0) ? ' is-done' : ''}`} style={{ left: `${cliff}%` }} />}
        {row.events.length === 0 && <span className={`tick${row.todayMs >= row.endMs ? ' is-done' : ''}`} style={{ left: `${finalAt}%` }} />}
        {cliff !== null && <span className="lab" style={labStyle(cliff)}>Cliff · {monthYear(row.cliffMs!)}</span>}
        {<span className="lab" style={labStyle(finalAt)}>Final · {monthYear(row.endMs)}</span>}
        <span className="lab is-today" style={labStyle(today)}>{row.ended ? 'Ended' : 'Today'}</span>
      </div>
    </div>
  )
}

export function RsuVestChart({ rows }: { rows: RsuTimelineRow[] }) {
  return (
    <div className="mne-rsu-list">
      {rows.map((r, i) => <RsuVestRail key={`${r.label}-${i}`} row={r} />)}
    </div>
  )
}
