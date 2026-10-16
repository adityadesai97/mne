import { useState } from 'react'
import { Plus } from 'lucide-react'
import '@/styles/portfolio.css'

interface Values { count: string; cost_price: string; purchase_date: string }
const today = () => new Date().toISOString().split('T')[0]

/** "Add Lot" button + inline form for a stock/crypto Market lot; mirrors FixedIncomeLotList's add flow. */
export function AddLotForm({ isCrypto, onAddLot }: {
  isCrypto: boolean
  onAddLot: (values: { count: number; cost_price: number; purchase_date: string }) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [values, setValues] = useState<Values>({ count: '', cost_price: '', purchase_date: today() })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const unit = isCrypto ? 'Units' : 'Shares'

  async function save() {
    const count = parseFloat(values.count)
    const cost = parseFloat(values.cost_price)
    if (!values.purchase_date) return setFormError('Choose a purchase date.')
    if (!(count > 0)) return setFormError(`Enter ${unit.toLowerCase()} greater than 0.`)
    if (!(cost >= 0) || values.cost_price.trim() === '') return setFormError('Enter the cost per unit.')
    setFormError(null)
    setSaving(true)
    try {
      await onAddLot({ count, cost_price: cost, purchase_date: values.purchase_date })
      setAdding(false)
    } finally {
      setSaving(false)
    }
  }

  if (!adding) {
    return (
      <div>
        <button type="button" className="mne-btn is-ghost is-sm" onClick={() => { setValues({ count: '', cost_price: '', purchase_date: today() }); setFormError(null); setAdding(true) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} aria-hidden="true" /> Add Lot
        </button>
      </div>
    )
  }

  return (
    <div className="pf-lot-edit">
      <div className="pf-lot-edit-grid">
        <div className="mne-field">
          <label htmlFor="add-lot-count">{unit}</label>
          <input id="add-lot-count" className="mne-input" type="number" step="any" min="0" value={values.count}
            onChange={e => setValues(v => ({ ...v, count: e.target.value }))} />
        </div>
        <div className="mne-field">
          <label htmlFor="add-lot-cost">{isCrypto ? 'Cost/unit' : 'Cost/share'}</label>
          <input id="add-lot-cost" className="mne-input" type="number" step="any" min="0" value={values.cost_price}
            onChange={e => setValues(v => ({ ...v, cost_price: e.target.value }))} />
        </div>
        <div className="mne-field">
          <label htmlFor="add-lot-date">Purchase date</label>
          <input id="add-lot-date" className="mne-input" type="date" value={values.purchase_date}
            onChange={e => setValues(v => ({ ...v, purchase_date: e.target.value }))} />
        </div>
      </div>
      {formError && <p className="text-loss" role="alert" style={{ margin: 0 }}>▼ {formError}</p>}
      <div className="pf-actions">
        <button type="button" className="mne-btn is-sm" onClick={save} disabled={saving}>Save</button>
        <button type="button" className="mne-btn is-ghost is-sm" onClick={() => setAdding(false)}>Cancel</button>
      </div>
    </div>
  )
}
