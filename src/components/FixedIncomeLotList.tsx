// src/components/FixedIncomeLotList.tsx
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { formatDateMDY } from '@/lib/dates'
import { useHideValues } from '@/hooks/useHideValues'
import { Delta, Stat } from '@/components/mne'
import { daysBetween, fmtMoney, fmtMoney0, parseIsoDate, plural, startOfToday, toIsoKey } from '@/components/lots/lotMath'
import {
  Hide, LotDisclosure, ProgressBar, RowActions, TextActions, TimelineEvent, TimelineLot, TodayMarker, DetailList,
  type LotLayout,
} from '@/components/lots/parts'
import '@/styles/portfolio.css'
import '@/styles/lots.css'

interface Lot {
  id: string
  count: number | string
  cost_price: number | string
  purchase_date: string
}

interface FormValues {
  count: string
  cost_price: string
  purchase_date: string
}

const EMPTY_FORM: FormValues = { count: '', cost_price: '', purchase_date: new Date().toISOString().split('T')[0] }

/** Lot list for a tradable Fixed Income asset (Bond/T-Bill) — the same
 *  "buy in lots over time" idea as TaxLotList's stock tax lots, but without
 *  the RSU-grant grouping or capital-gains-status a stock lot carries;
 *  Bond/T-Bill lots are just units × cost/unit on a purchase date. */
export function FixedIncomeLotList({ lots, faceValue, layout = 'default', maturityDate = null, expectedReturn = null, onAddLot, onEditLot, onDeleteLot }: {
  lots: Lot[]
  faceValue: number | null
  layout?: LotLayout
  maturityDate?: string | null
  /** Held-to-maturity projection (computeFixedIncomeExpectedReturn), if available. */
  expectedReturn?: { totalExpectedReturn: number; expectedReturnPct: number | null } | null
  onAddLot: (values: { count: number; cost_price: number; purchase_date: string }) => Promise<void>
  onEditLot: (id: string, values: { count: number; cost_price: number; purchase_date: string }) => Promise<void>
  onDeleteLot: (id: string) => Promise<void>
}) {
  const [hideValues] = useHideValues()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [values, setValues] = useState<FormValues>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  function startEdit(lot: Lot) {
    setAdding(false)
    setEditingId(lot.id)
    setValues({ count: String(lot.count), cost_price: String(lot.cost_price), purchase_date: lot.purchase_date })
  }

  function startAdd() {
    setEditingId(null)
    setValues(EMPTY_FORM)
    setAdding(true)
  }

  async function handleSaveEdit(id: string) {
    setSaving(true)
    try {
      await onEditLot(id, {
        count: parseFloat(values.count),
        cost_price: parseFloat(values.cost_price),
        purchase_date: values.purchase_date,
      })
      setEditingId(null)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveAdd() {
    setSaving(true)
    try {
      await onAddLot({
        count: parseFloat(values.count),
        cost_price: parseFloat(values.cost_price),
        purchase_date: values.purchase_date,
      })
      setAdding(false)
    } finally {
      setSaving(false)
    }
  }

  function renderForm(onSave: () => void, onCancel: () => void) {
    return (
      <div className="pf-lot-edit">
        <div className="pf-lot-edit-grid">
          <div className="mne-field">
            <label htmlFor="fi-lot-units">Units</label>
            <input id="fi-lot-units" className="mne-input" type="number" step="0.0001" value={values.count}
              onChange={e => setValues(v => ({ ...v, count: e.target.value }))} />
          </div>
          <div className="mne-field">
            <label htmlFor="fi-lot-cost">Cost/unit</label>
            <input id="fi-lot-cost" className="mne-input" type="number" step="0.01" value={values.cost_price}
              onChange={e => setValues(v => ({ ...v, cost_price: e.target.value }))} />
          </div>
          <div className="mne-field">
            <label htmlFor="fi-lot-date">Purchase date</label>
            <input id="fi-lot-date" className="mne-input" type="date" value={values.purchase_date}
              onChange={e => setValues(v => ({ ...v, purchase_date: e.target.value }))} />
          </div>
        </div>
        <div className="pf-actions">
          <button type="button" className="mne-btn is-sm" onClick={onSave} disabled={saving}>Save</button>
          <button type="button" className="mne-btn is-ghost is-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    )
  }

  const showFace = faceValue != null
  const today = startOfToday()
  const todayKey = toIsoKey(today)
  const maturity = parseIsoDate(maturityDate)
  const daysToMaturity = maturity ? daysBetween(today, maturity) : null
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpenIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const sorted = [...lots].sort((a, b) => String(b.purchase_date).localeCompare(String(a.purchase_date)))
  const totalUnits = lots.reduce((a, l) => a + Number(l.count), 0)
  const totalPaid = lots.reduce((a, l) => a + Number(l.count) * Number(l.cost_price), 0)
  const totalFace = faceValue != null ? totalUnits * faceValue : null
  const lotCount = (n: number) => `${n} ${plural(n, 'lot', 'lots')}`
  const unitsText = (n: number) => `${fmtUnits(n)} ${plural(n, 'unit', 'units')}`
  const daysText = (n: number) => `${n} ${plural(n, 'day', 'days')}`
  const matureText = daysToMaturity === null ? null : daysToMaturity < 0 ? 'matured' : daysToMaturity === 0 ? 'today' : `${daysText(daysToMaturity)} away`

  function lotFigures(lot: Lot) {
    const count = Number(lot.count)
    const costPrice = Number(lot.cost_price)
    return {
      count,
      costPrice,
      paid: count * costPrice,
      face: faceValue != null ? count * faceValue : null,
      toFace: faceValue != null ? count * (faceValue - costPrice) : null,
    }
  }

  function renderRow(lot: Lot) {
    if (editingId === lot.id) {
      return <div key={lot.id} className="lot-row is-edit">{renderForm(() => handleSaveEdit(lot.id), () => setEditingId(null))}</div>
    }
    const f = lotFigures(lot)
    const bought = parseIsoDate(lot.purchase_date)
    const span = bought && maturity ? daysBetween(bought, maturity) : 0
    const progress = bought && maturity && span > 0 ? Math.min(1, Math.max(0, daysBetween(bought, today) / span)) : null
    return (
      <div key={lot.id} className="lot-row">
        <div className="lot-main">
          <div className="lot-title">{formatDateMDY(lot.purchase_date)}</div>
          <div className="mne-help lot-num">
            {unitsText(f.count)} × <Hide hidden={hideValues}>{fmtMoney(f.costPrice)}</Hide> · paid <Hide hidden={hideValues}>{fmtMoney(f.paid)}</Hide>
          </div>
        </div>
        <div className="lot-side">
          <div className="lot-v"><Hide hidden={hideValues}>{fmtMoney(f.face ?? f.paid)}</Hide></div>
          <div className="mne-help">{f.face != null ? 'face value' : 'total cost'}</div>
        </div>
        <div className="lot-foot">
          {progress !== null && <ProgressBar pct={progress * 100} tone="accent" />}
          {daysToMaturity !== null && (
            <span className="lot-lbl">
              {daysToMaturity < 0 ? 'Matured' : daysToMaturity === 0 ? 'Matures today' : `${daysText(daysToMaturity)} to maturity`}
              {f.toFace != null && <> · <Hide hidden={hideValues}><Delta value={f.toFace} format={fmtMoney} /></Hide></>}
            </span>
          )}
          <RowActions
            editLabel="Edit lot" deleteLabel="Delete lot"
            onEdit={() => startEdit(lot)}
            onDelete={() => { void onDeleteLot(lot.id) }}
          />
        </div>
      </div>
    )
  }

  function renderSummary() {
    return (
      <div className="lot-summary">
        <div className="lot-stats">
          <Stat label="Units" value={fmtUnits(totalUnits)} sub={lotCount(lots.length)} subClassName="mne-muted" />
          <Stat label="Amount paid" value={<Hide hidden={hideValues}>{fmtMoney0(totalPaid)}</Hide>} />
          {totalFace != null && (
            <Stat label="Face value" value={<Hide hidden={hideValues}>{fmtMoney0(totalFace)}</Hide>} sub="at maturity" subClassName="mne-muted" />
          )}
          {expectedReturn && (
            <Stat label="Expected return"
              value={<Hide hidden={hideValues}>{expectedReturn.totalExpectedReturn < 0 ? '−' : ''}{fmtMoney0(Math.abs(expectedReturn.totalExpectedReturn))}</Hide>}
              sub={expectedReturn.expectedReturnPct != null ? <Delta value={expectedReturn.expectedReturnPct} digits={1} /> : undefined} />
          )}
          {maturity && (
            <Stat label="Matures" value={formatDateMDY(maturityDate)} sub={matureText ?? undefined} subClassName="mne-muted" />
          )}
        </div>
        {lots.length > 0 && (
          <LotDisclosure label="lots" count={lotCount(lots.length)}>
            <div className="lot-rows">{sorted.map(renderRow)}</div>
          </LotDisclosure>
        )}
      </div>
    )
  }

  function renderTimeline() {
    type Entry = { date: string; lot?: Lot }
    const entries: Entry[] = sorted.map(lot => ({ date: lot.purchase_date, lot }))
    if (maturityDate) entries.push({ date: maturityDate.slice(0, 10) })
    entries.sort((a, b) => b.date.localeCompare(a.date))
    const render = (e: Entry) => {
      if (!e.lot) {
        const matured = e.date <= todayKey
        return (
          <TimelineEvent
            key="maturity"
            title={matured ? (showFace ? 'Matured at face value' : 'Matured') : (showFace ? 'Matures at face value' : 'Matures')}
            sub={<>{formatDateMDY(e.date)}{matureText ? ` · ${matureText}` : ''}</>}
            right={totalFace != null ? <span className="lot-num"><Hide hidden={hideValues}>{fmtMoney0(totalFace)}</Hide></span> : undefined}
          />
        )
      }
      const lot = e.lot
      if (editingId === lot.id) {
        return (
          <li key={lot.id} className="lot-tli is-edit">
            <span className="lot-pin"><span className="lot-dot is-accent" /></span>
            {renderForm(() => handleSaveEdit(lot.id), () => setEditingId(null))}
          </li>
        )
      }
      const f = lotFigures(lot)
      const items = [
        { label: 'Paid', value: <Hide hidden={hideValues}>{fmtMoney(f.paid)}</Hide> },
        { label: 'Cost/unit', value: <Hide hidden={hideValues}>{fmtMoney(f.costPrice)}</Hide> },
        ...(f.face != null ? [{ label: 'Face value', value: <Hide hidden={hideValues}>{fmtMoney(f.face)}</Hide> }] : []),
        ...(f.toFace != null ? [{ label: 'To maturity', value: <Hide hidden={hideValues}><Delta value={f.toFace} format={fmtMoney} /></Hide> }] : []),
      ]
      return (
        <TimelineLot
          key={lot.id}
          dot="accent"
          title={<>{unitsText(f.count)} @ <Hide hidden={hideValues}>{fmtMoney(f.costPrice)}</Hide></>}
          sub={formatDateMDY(lot.purchase_date)}
          right={<span className="lot-num"><Hide hidden={hideValues}>{fmtMoney0(f.paid)}</Hide></span>}
          open={openIds.has(lot.id)}
          onToggle={() => toggle(lot.id)}
        >
          <DetailList items={items} />
          <TextActions onEdit={() => startEdit(lot)} onDelete={() => { void onDeleteLot(lot.id) }} />
        </TimelineLot>
      )
    }
    return (
      <div>
        <div className="lot-legend">
          <span><i className="lot-dot is-accent" aria-hidden="true" />Purchase</span>
          <span><i className="lot-dot is-evt" aria-hidden="true" />Upcoming</span>
          <span className="lot-legend-end">Tap a lot for details</span>
        </div>
        <ol className="lot-tln">
          {entries.filter(e => e.date > todayKey).map(render)}
          <TodayMarker label={formatDateMDY(todayKey)} />
          {entries.filter(e => e.date <= todayKey).map(render)}
        </ol>
      </div>
    )
  }

  return (
    <div className="lot-stack">
      {lots.length > 0 && (layout === 'timeline' ? renderTimeline() : renderSummary())}

      {adding ? (
        renderForm(handleSaveAdd, () => setAdding(false))
      ) : (
        <div>
          <button type="button" className="mne-btn is-ghost is-sm" onClick={startAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} aria-hidden="true" /> Add Lot
          </button>
        </div>
      )}
    </div>
  )
}

function fmtUnits(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n)
}
