// Stock / crypto tax-lot presentation: "summary first" and "timeline" layouts.
// Data handling (edit/delete/save) is passed in by TaxLotList unchanged.
import { useState, type ReactNode } from 'react'
import { formatDateMDY } from '@/lib/dates'
import { Stat, Delta } from '@/components/mne'
import {
  type StockLot, fmtMoney, fmtMoney0, fmtQty, qtyText, plural, sumLots, toIsoKey,
} from './lotMath'
import {
  Hide, TermChip, GainText, RowActions, TextActions, LotDisclosure, ProgressBar, InfoIcon,
  TimelineEvent, TimelineLot, TimelineLegend, TodayMarker, DetailList,
} from './parts'

export interface EditValues {
  count: string
  cost_price: string
  purchase_date: string
  capital_gains_status: string
  sold_at_vest: string
}

export interface StockLotCtx {
  isCrypto: boolean
  hideValues: boolean
  price: number | null
  today: Date
  editingId: string | null
  onStartEdit?: (id: string) => void
  onSaveEdit: (id: string, values: EditValues) => Promise<void>
  onCancelEdit: () => void
  onDelete?: (id: string) => Promise<void>
}

export function StockLotEditForm({ lot, ctx }: { lot: StockLot; ctx: StockLotCtx }) {
  const t = lot.raw
  const step = ctx.isCrypto ? 'any' : '0.01'
  const [values, setValues] = useState<EditValues>({
    count: String(t.count),
    cost_price: String(t.cost_price),
    purchase_date: t.purchase_date,
    capital_gains_status: t.capital_gains_status,
    sold_at_vest: String(t.sold_at_vest ?? 0),
  })
  const set = (patch: Partial<EditValues>) => setValues(v => ({ ...v, ...patch }))
  return (
    <div className="pf-lot-edit">
      <div className="pf-lot-edit-grid">
        <div className="mne-field">
          <label htmlFor={`${t.id}-count`}>{ctx.isCrypto ? 'Units' : 'Shares'}</label>
          <input id={`${t.id}-count`} className="mne-input" type="number" step={step} value={values.count}
            onChange={e => set({ count: e.target.value })} />
        </div>
        <div className="mne-field">
          <label htmlFor={`${t.id}-cost`}>{ctx.isCrypto ? 'Cost/unit' : 'Cost/share'}</label>
          <input id={`${t.id}-cost`} className="mne-input" type="number" step={step} value={values.cost_price}
            onChange={e => set({ cost_price: e.target.value })} />
        </div>
        <div className="mne-field">
          <label htmlFor={`${t.id}-date`}>Purchase date</label>
          <input id={`${t.id}-date`} className="mne-input" type="date" value={values.purchase_date}
            onChange={e => set({ purchase_date: e.target.value })} />
        </div>
        <div className="mne-field">
          <label htmlFor={`${t.id}-status`}>Status</label>
          <div className="mne-select-wrap">
            <select id={`${t.id}-status`} className="mne-input" value={values.capital_gains_status}
              onChange={e => set({ capital_gains_status: e.target.value })}>
              <option value="Short Term">Short Term</option>
              <option value="Long Term">Long Term</option>
            </select>
          </div>
        </div>
        <div className="mne-field">
          <label htmlFor={`${t.id}-sav`}>Sold at vest</label>
          <input id={`${t.id}-sav`} className="mne-input" type="number" step={step} min="0" placeholder="0" value={values.sold_at_vest}
            onChange={e => set({ sold_at_vest: e.target.value })} />
        </div>
      </div>
      <div className="pf-actions">
        <button type="button" className="mne-btn is-sm" onClick={() => { void ctx.onSaveEdit(t.id, values) }}>Save</button>
        <button type="button" className="mne-btn is-ghost is-sm" onClick={ctx.onCancelEdit}>Cancel</button>
      </div>
    </div>
  )
}

function daysText(n: number) {
  return `${n} ${plural(n, 'day', 'days')}`
}

/* ------------------------------ summary rows ------------------------------ */

function StockLotRow({ lot, ctx }: { lot: StockLot; ctx: StockLotCtx }) {
  if (ctx.editingId === lot.id) {
    return <div className="lot-row is-edit"><StockLotEditForm lot={lot} ctx={ctx} /></div>
  }
  const { isCrypto, hideValues } = ctx
  const foot = lot.isLong
    ? <span className="lot-lbl">Long term{lot.ltDate ? ` since ${formatDateMDY(toIsoKey(lot.ltDate))}` : ''}</span>
    : lot.toLT !== null && lot.ltDate
      ? <span className="lot-lbl"><b>{lot.toLT === 0 ? 'Turns long term today' : `${daysText(lot.toLT)} to long term`}</b> · {formatDateMDY(toIsoKey(lot.ltDate))}</span>
      : <span className="lot-lbl">Short term</span>
  return (
    <div className="lot-row">
      <div className="lot-main">
        <div className="lot-title">{formatDateMDY(lot.date)} <TermChip isLong={lot.isLong} /></div>
        <div className="mne-help lot-num">
          {qtyText(lot.shares, isCrypto)} × <Hide hidden={hideValues}>{fmtMoney(lot.cost)}</Hide>
          {' · '}cost <Hide hidden={hideValues}>{fmtMoney(lot.basis)}</Hide>
        </div>
        {lot.soldAtVest > 0 && (
          <div className="mne-help lot-num">{fmtQty(lot.soldAtVest, isCrypto)} sold at vest</div>
        )}
      </div>
      <div className="lot-side">
        <div className="lot-v">{lot.value !== null ? <Hide hidden={hideValues}>{fmtMoney(lot.value)}</Hide> : '—'}</div>
        <div className="lot-gainchip"><GainText gain={lot.gain} pct={lot.pct} hidden={hideValues} format={fmtMoney} /></div>
      </div>
      <div className="lot-foot">
        <ProgressBar pct={lot.progress * 100} tone={lot.isLong ? 'long' : undefined} />
        {foot}
        <RowActions
          editLabel="Edit" deleteLabel="Delete"
          onEdit={ctx.onStartEdit ? () => ctx.onStartEdit!(lot.id) : undefined}
          onDelete={ctx.onDelete ? () => { void ctx.onDelete!(lot.id) } : undefined}
        />
      </div>
    </div>
  )
}

export function StockLotRows({ lots, ctx }: { lots: StockLot[]; ctx: StockLotCtx }) {
  return <div className="lot-rows">{lots.map(l => <StockLotRow key={l.id} lot={l} ctx={ctx} />)}</div>
}

function lotCount(n: number) {
  return `${n} ${plural(n, 'lot', 'lots')}`
}

/* ------------------------------ summary block ----------------------------- */

/** Stats strip + long/short split + "turns long term" line + collapsed lots. */
export function StockSummary({ lots, ctx, detailLabel = 'lot detail' }: { lots: StockLot[]; ctx: StockLotCtx; detailLabel?: string }) {
  const { isCrypto, hideValues, price } = ctx
  const s = sumLots(lots)
  const longLots = lots.filter(l => l.isLong)
  const shortLots = lots.filter(l => !l.isLong)
  const lv = sumLots(longLots)
  const sv = sumLots(shortLots)
  // Weight the split by value; fall back to cost when there's no price yet.
  const byValue = s.value !== null
  const weigh = (x: { value: number | null; basis: number }) => (byValue ? x.value ?? 0 : x.basis)
  const total = (byValue ? s.value ?? 0 : s.basis) || 1
  const longPct = (weigh(lv) / total) * 100
  const shortPct = (weigh(sv) / total) * 100

  // Lots that turn long term soonest (same date merge into one line).
  const upcoming = shortLots.filter(l => l.toLT !== null && l.ltDate)
  let next: { shares: number; days: number; date: Date } | null = null
  if (upcoming.length > 0) {
    const soonest = Math.min(...upcoming.map(l => l.toLT as number))
    const group = upcoming.filter(l => l.toLT === soonest)
    next = { shares: group.reduce((a, l) => a + l.shares, 0), days: soonest, date: group[0].ltDate as Date }
  }

  const sorted = [...lots].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const avgCost = s.shares > 0 ? s.basis / s.shares : 0

  return (
    <div className="lot-summary">
      <div className="lot-stats">
        <Stat label={isCrypto ? 'Units' : 'Shares'} value={fmtQty(s.shares, isCrypto)}
          sub={s.shares > 0 ? <>avg cost <Hide hidden={hideValues}>{fmtMoney(avgCost)}</Hide></> : undefined} subClassName="mne-muted" />
        <Stat label="Cost basis" value={<Hide hidden={hideValues}>{fmtMoney0(s.basis)}</Hide>} />
        <Stat label="Value"
          value={s.value !== null ? <Hide hidden={hideValues}>{fmtMoney0(s.value)}</Hide> : <span className="mne-muted">—</span>}
          sub={price !== null ? <>@ <Hide hidden={hideValues}>{fmtMoney(price)}</Hide></> : 'Price pending'} subClassName="mne-muted" />
        <Stat label="Unrealized gain"
          value={s.gain !== null ? <Hide hidden={hideValues}>{s.gain < 0 ? '−' : ''}{fmtMoney0(Math.abs(s.gain))}</Hide> : <span className="mne-muted">—</span>}
          sub={s.gain !== null && s.pct !== null ? <Delta value={s.pct} digits={1} /> : undefined} />
      </div>

      <div className="lot-split">
        <div className="lot-split-hd">
          <span>Holding period split</span>
          <span><Hide hidden={hideValues}>{fmtMoney0(byValue ? s.value ?? 0 : s.basis)}</Hide>{byValue ? '' : ' at cost'}</span>
        </div>
        <div className="mne-stack" role="img"
          aria-label={`Long term ${longPct.toFixed(0)} percent, short term ${shortPct.toFixed(0)} percent`}>
          {longPct > 0 && <span style={{ width: `${longPct}%`, background: 'var(--mne-chart-3)' }} />}
          {shortPct > 0 && <span style={{ width: `${shortPct}%`, background: 'var(--mne-amber)' }} />}
        </div>
        <div className="mne-breakdown">
          <div>
            <i style={{ background: 'var(--mne-chart-3)' }} />
            <span className="lot-l2">Long term<span className="lot-sub">{lotCount(longLots.length)} · {qtyText(lv.shares, isCrypto)} · held over a year</span></span>
            <span><Hide hidden={hideValues}>{fmtMoney0(weigh(lv))}</Hide></span>
            <span className="mne-muted">{longPct.toFixed(0)}%</span>
          </div>
          <div>
            <i style={{ background: 'var(--mne-amber)' }} />
            <span className="lot-l2">Short term<span className="lot-sub">
              {lotCount(shortLots.length)} · {qtyText(sv.shares, isCrypto)}
              {sv.gain !== null && shortLots.length > 0 && <> · unrealized <Hide hidden={hideValues}><Delta value={sv.gain} format={fmtMoney} /></Hide></>}
            </span></span>
            <span><Hide hidden={hideValues}>{fmtMoney0(weigh(sv))}</Hide></span>
            <span className="mne-muted">{shortPct.toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {next && (
        <div className="mne-banner is-info" style={{ marginTop: 16 }}>
          <span className="ico"><InfoIcon /></span>
          <span className="txt">
            <b>{qtyText(next.shares, isCrypto)}</b> {next.shares === 1 ? 'turns' : 'turn'} long term{' '}
            {next.days === 0 ? <b>today</b> : <>in <b>{daysText(next.days)}</b></>} ({formatDateMDY(toIsoKey(next.date))}).
          </span>
        </div>
      )}

      <LotDisclosure label={detailLabel} count={lotCount(lots.length)}>
        <StockLotRows lots={sorted} ctx={ctx} />
      </LotDisclosure>
    </div>
  )
}

/* -------------------------------- timeline -------------------------------- */

export interface TimelineExtraEvent {
  key: string
  date: string // ISO yyyy-mm-dd
  title: ReactNode
  sub: ReactNode
  right?: ReactNode
}

function StockTimelineLot({ lot, ctx, open, onToggle }: { lot: StockLot; ctx: StockLotCtx; open: boolean; onToggle: () => void }) {
  const { isCrypto, hideValues } = ctx
  if (ctx.editingId === lot.id) {
    return (
      <li className="lot-tli is-edit">
        <span className="lot-pin"><span className={`lot-dot ${lot.isLong ? 'is-long' : 'is-short'}`} /></span>
        <StockLotEditForm lot={lot} ctx={ctx} />
      </li>
    )
  }
  const details = [
    { label: 'Cost basis', value: <Hide hidden={hideValues}>{fmtMoney(lot.basis)}</Hide> },
    { label: isCrypto ? 'Cost/unit' : 'Cost/share', value: <Hide hidden={hideValues}>{fmtMoney(lot.cost)}</Hide> },
    { label: 'Value', value: lot.value !== null ? <Hide hidden={hideValues}>{fmtMoney(lot.value)}</Hide> : '—' },
    { label: 'Return', value: lot.pct !== null ? <Delta value={lot.pct} digits={1} /> : '—' },
    ...(lot.held !== null ? [{ label: 'Held', value: daysText(lot.held) }] : []),
    ...(lot.ltDate ? [{ label: lot.isLong ? 'Long term since' : 'Long term on', value: formatDateMDY(toIsoKey(lot.ltDate)) }] : []),
    ...(lot.soldAtVest > 0 ? [{ label: 'Sold at vest', value: qtyText(lot.soldAtVest, isCrypto) }] : []),
  ]
  return (
    <TimelineLot
      dot={lot.isLong ? 'long' : 'short'}
      title={<>{qtyText(lot.shares, isCrypto)} @ <Hide hidden={hideValues}>{fmtMoney(lot.cost)}</Hide></>}
      sub={<>{formatDateMDY(lot.date)} · {lot.isLong ? 'Long term' : 'Short term'}</>}
      right={<GainText gain={lot.gain} hidden={hideValues} format={fmtMoney} />}
      open={open}
      onToggle={onToggle}
    >
      <DetailList items={details} />
      {!lot.isLong && lot.toLT !== null && (
        <div className="lot-flex lot-togo">
          <ProgressBar pct={lot.progress * 100} />
          <span className="mne-help">{lot.toLT === 0 ? 'Turns long term today' : `${daysText(lot.toLT)} to go`}</span>
        </div>
      )}
      <TextActions
        onEdit={ctx.onStartEdit ? () => ctx.onStartEdit!(lot.id) : undefined}
        onDelete={ctx.onDelete ? () => { void ctx.onDelete!(lot.id) } : undefined}
      />
    </TimelineLot>
  )
}

type Entry =
  | { kind: 'lot'; date: string; lot: StockLot }
  | { kind: 'evt'; date: string; evt: TimelineExtraEvent }

/** Date-ordered ledger with upcoming events above a "Today" marker. */
export function StockTimeline({ lots, ctx, extraEvents = [], showTermEvents = true, legend = true }: {
  lots: StockLot[]
  ctx: StockLotCtx
  extraEvents?: TimelineExtraEvent[]
  showTermEvents?: boolean
  legend?: boolean
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpenIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const entries: Entry[] = lots.map(lot => ({ kind: 'lot', date: lot.date, lot }))
  if (showTermEvents) {
    for (const l of lots) {
      if (l.isLong || l.toLT === null || !l.ltDate) continue
      entries.push({
        kind: 'evt',
        date: toIsoKey(l.ltDate),
        evt: {
          key: `lt-${l.id}`,
          date: toIsoKey(l.ltDate),
          title: `${qtyText(l.shares, ctx.isCrypto)} ${l.shares === 1 ? 'becomes' : 'become'} long term`,
          sub: `${formatDateMDY(toIsoKey(l.ltDate))} · lot from ${formatDateMDY(l.date)} · ${l.toLT === 0 ? 'today' : `in ${daysText(l.toLT)}`}`,
          right: <span className="mne-chip is-outline lot-chip"><span className="lot-dot is-long" aria-hidden="true" />Long term</span>,
        },
      })
    }
  }
  for (const evt of extraEvents) entries.push({ kind: 'evt', date: evt.date, evt })
  entries.sort((a, b) => String(b.date).localeCompare(String(a.date)))

  const todayKey = toIsoKey(ctx.today)
  const upcoming = entries.filter(e => e.date > todayKey)
  const past = entries.filter(e => e.date <= todayKey)
  const render = (e: Entry) => e.kind === 'lot'
    ? <StockTimelineLot key={e.lot.id} lot={e.lot} ctx={ctx} open={openIds.has(e.lot.id)} onToggle={() => toggle(e.lot.id)} />
    : <TimelineEvent key={e.evt.key} title={e.evt.title} sub={e.evt.sub} right={e.evt.right} />

  return (
    <div>
      {legend && <TimelineLegend />}
      <ol className="lot-tln">
        {upcoming.map(render)}
        <TodayMarker label={formatDateMDY(todayKey)} />
        {past.map(render)}
      </ol>
    </div>
  )
}
