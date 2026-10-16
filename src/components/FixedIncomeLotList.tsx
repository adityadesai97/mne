// src/components/FixedIncomeLotList.tsx
import { useState } from 'react'
import { Trash2, Pencil, Plus } from 'lucide-react'
import { formatDateMDY } from '@/lib/dates'
import { useHideValues, hiddenValueClass } from '@/hooks/useHideValues'
import '@/styles/portfolio.css'

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
export function FixedIncomeLotList({ lots, faceValue, onAddLot, onEditLot, onDeleteLot }: {
  lots: Lot[]
  faceValue: number | null
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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
      {lots.length > 0 && (
        <div className="pf-scroll">
          <table className="mne-table is-compact">
            <thead>
              <tr>
                <th>Purchased</th>
                <th className="r">Units</th>
                <th className="r">Cost/unit</th>
                <th className="r pf-hide-sm">Total cost</th>
                {showFace && <th className="r">Face value</th>}
                <th className="r"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => {
                if (editingId === lot.id) {
                  return (
                    <tr key={lot.id}>
                      <td colSpan={showFace ? 6 : 5}>{renderForm(() => handleSaveEdit(lot.id), () => setEditingId(null))}</td>
                    </tr>
                  )
                }
                const count = Number(lot.count)
                const costPrice = Number(lot.cost_price)
                const totalCost = count * costPrice
                const totalFace = faceValue != null ? count * faceValue : null
                return (
                  <tr key={lot.id}>
                    <td>{formatDateMDY(lot.purchase_date)}</td>
                    <td className="r">{fmtUnits(count)}</td>
                    <td className="r"><span className={hiddenValueClass(hideValues)}>{fmt(costPrice)}</span></td>
                    <td className="r pf-hide-sm"><span className={hiddenValueClass(hideValues)}>{fmt(totalCost)}</span></td>
                    {showFace && <td className="r"><span className={hiddenValueClass(hideValues)}>{totalFace != null ? fmt(totalFace) : '—'}</span></td>}
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="pf-iconbtn" onClick={() => startEdit(lot)} aria-label="Edit lot">
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button type="button" className="pf-iconbtn is-danger" onClick={() => onDeleteLot(lot.id)} aria-label="Delete lot">
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

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

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
}

function fmtUnits(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n)
}
