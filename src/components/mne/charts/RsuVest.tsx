import type { CSSProperties, ReactNode } from 'react'
import { Chip } from '../index'
import { Tooltip } from '../Tooltip'
import type { RsuTimelineRow } from '@/lib/charts'

const DAY_MS = 86_400_000
const fmtN = (n: number) => n.toLocaleString('en-US')
const shares = (n: number) => `${fmtN(n)} ${n === 1 ? 'share' : 'shares'}`
// Grant dates are date-only strings (UTC midnight), so format in UTC to avoid a day shift.
const fmt = (ms: number, o: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', ...o })
const monthDay = (ms: number) => fmt(ms, { month: 'short', day: 'numeric' })
const monthDayYear = (ms: number) => fmt(ms, { month: 'short', day: 'numeric', year: 'numeric' })
const monthYear = (ms: number) => fmt(ms, { month: 'short', year: 'numeric' })

function countdown(ms: number, todayMs: number): string {
  const d = Math.ceil((ms - todayMs) / DAY_MS)
  if (d <= 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d <= 60) return `in ${d} days`
  return `in ${Math.round(d / 30.4)} months`
}

/** Anchor a label at `p`% of the bar, flipping to the edge so it never clips the card. */
function anchor(p: number): CSSProperties {
  if (p > 80) return { right: `${100 - p}%` }
  if (p < 8) return { left: 0 }
  return { left: `${p}%`, transform: 'translateX(-50%)' }
}

function cliffChip(row: RsuTimelineRow): string | null {
  if (!row.hasCliff || row.cliffMs === null || row.frequency === 'continuous') return null
  const months = Math.round((row.cliffMs - row.grantMs) / (DAY_MS * 30.4))
  if (months <= 0) return null
  if (months % 12 === 0) return `${months / 12}-year cliff`
  return `${months}-month cliff`
}

function summary(row: RsuTimelineRow, pct: number): string {
  const base = `${row.symbol} grant of ${monthDayYear(row.grantMs)}: ${fmtN(row.vestedShares)} of ${fmtN(row.totalShares)} shares vested (${pct}%)`
  if (row.ended) return `${base}, grant ended ${monthDayYear(row.endedMs ?? row.todayMs)}, ${shares(row.forfeitedShares)} forfeited`
  if (row.vestedShares >= row.totalShares) return `${base}, fully vested`
  if (row.nextVest) return `${base}, next vest ${shares(row.nextVest.shares)} on ${monthDayYear(row.nextVest.ms)}`
  return `${base}, vesting continuously through ${monthDayYear(row.endMs)}`
}

function Seg({ tip, interactive, className, style, children }: { tip: ReactNode; interactive: boolean; className: string; style: CSSProperties; children?: ReactNode }) {
  const el = <i className={className} style={style} tabIndex={interactive ? 0 : undefined}>{children}</i>
  return interactive ? <Tooltip content={tip}>{el}</Tooltip> : el
}

const TipLines = ({ title, detail }: { title: string; detail: string }) => <><strong>{title}</strong><br />{detail}</>

/**
 * One grant: a bar measured in SHARES (so a cliff lump is visible), the vested
 * portion solid and the next installment a hatched slice. A Today pill and line
 * mark the position; an ended grant swaps in "Ended <date>" and a hatched
 * forfeited region. Continuous grants have no discrete next vest, so no slice.
 */
export function RsuVestRail({ row, hideValues = false }: { row: RsuTimelineRow; hideValues?: boolean }) {
  const total = Math.max(1, row.totalShares)
  const vp = Math.min(100, (row.vestedShares / total) * 100)
  const pct = Math.round(vp)
  const next = row.ended ? null : row.nextVest
  const np = next ? Math.min(100 - vp, (next.shares / total) * 100) : 0
  const forfeited = row.ended && row.forfeitedShares > 0
  const interactive = !hideValues
  const chip = cliffChip(row)
  const fully = !row.ended && row.vestedShares >= row.totalShares
  const continuous = !row.ended && !fully && !next
  const nextLabelAt = vp + np / 2
  const pillLabel = row.ended ? `Ended ${monthDay(row.endedMs ?? row.todayMs)}` : 'Today'
  const freq = row.frequency[0].toUpperCase() + row.frequency.slice(1)

  let nextBlock: ReactNode
  if (row.ended) {
    nextBlock = <><div className="cap">Forfeited</div><div className="v"><span className="mne-down">▼ {shares(row.forfeitedShares)}</span></div></>
  } else if (fully) {
    nextBlock = <><div className="cap">Status</div><div className="v">Fully vested</div></>
  } else if (next) {
    nextBlock = <><div className="cap">Next vest · {countdown(next.ms, row.todayMs)}</div><div className="v">{monthDay(next.ms)} · <span className="mne-up">▲ +{shares(next.shares)}</span></div></>
  } else {
    nextBlock = <><div className="cap">Vests continuously</div><div className="v">Through {monthDayYear(row.endMs)}</div></>
  }

  return (
    <div className="mne-rsu-grant">
      <div className="mne-rsu-top">
        <div className="mne-rsu-id">
          <div className="mne-rsu-name">
            <b>{row.symbol}</b>
            <span className="cap">Granted {monthDayYear(row.grantMs)}</span>
            <Chip>{freq}</Chip>
            {chip && <Chip variant="outline">{chip}</Chip>}
          </div>
          <div className="mne-rsu-big">
            <span className="v">{fmtN(row.vestedShares)}</span>
            <span className="of">of {fmtN(row.totalShares)} shares vested</span>
            <Chip>{pct}%</Chip>
          </div>
        </div>
        <div className="mne-rsu-next">{nextBlock}</div>
      </div>

      <div className="mne-rsu-wrap">
        <span className="mne-rsu-today" style={anchor(vp)}>{pillLabel}</span>
        <span className="mne-rsu-line" style={{ left: `${vp}%` }} aria-hidden="true" />
        <div className="mne-rsu-bar" role="img" aria-label={summary(row, pct)}>
          <Seg interactive={interactive} className="v" style={{ width: `${vp}%` }} tip={<TipLines title="Vested" detail={`${shares(row.vestedShares)} (${pct}%)`} />} />
          {next && np > 0 && (
            <Seg interactive={interactive} className="n" style={{ left: `${vp}%`, width: `max(${np}%, 5px)` }} tip={<TipLines title={`Next vest ${monthDayYear(next.ms)}`} detail={`+${shares(next.shares)}`} />} />
          )}
          {forfeited && (
            <Seg interactive={interactive} className="f" style={{ left: `${vp}%`, right: 0 }} tip={<TipLines title="Forfeited" detail={`${shares(row.forfeitedShares)} unvested when the grant ended`} />} />
          )}
        </div>
        <div className="mne-rsu-lab" aria-hidden="true">
          {next && <span style={anchor(nextLabelAt)}>Next vest · {monthDay(next.ms)} · +{fmtN(next.shares)}</span>}
          {forfeited && <span style={anchor(vp + (100 - vp) / 2)}>{shares(row.forfeitedShares)} forfeited</span>}
        </div>
        <div className="mne-rsu-caps cap">
          <span>{monthYear(row.grantMs)}</span>
          <span>{continuous || row.ended ? 'Ends' : 'Final vest'} {monthYear(row.endMs)}</span>
        </div>
      </div>
    </div>
  )
}

export function RsuVestChart({ rows, hideValues = false }: { rows: RsuTimelineRow[]; hideValues?: boolean }) {
  return (
    <div className="mne-rsu-list">
      {rows.map((r, i) => <RsuVestRail key={`${r.label}-${i}`} row={r} hideValues={hideValues} />)}
    </div>
  )
}
