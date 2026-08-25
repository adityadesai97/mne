// src/components/FixedIncomeLotList.tsx
import { useState } from 'react'
import { Trash2, Pencil, Plus } from 'lucide-react'
import { formatDateMDY } from '@/lib/dates'
import { useHideValues, hiddenValueClass } from '@/hooks/useHideValues'

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
      <div className="border border-border rounded-lg p-3 space-y-2 bg-background">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Units</label>
            <input
              type="number"
              step="0.0001"
              value={values.count}
              onChange={e => setValues(v => ({ ...v, count: e.target.value }))}
              className="w-full mt-0.5 bg-background border border-border rounded px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Cost/unit</label>
            <input
              type="number"
              step="0.01"
              value={values.cost_price}
              onChange={e => setValues(v => ({ ...v, cost_price: e.target.value }))}
              className="w-full mt-0.5 bg-background border border-border rounded px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Purchase date</label>
            <input
              type="date"
              value={values.purchase_date}
              onChange={e => setValues(v => ({ ...v, purchase_date: e.target.value }))}
              className="w-full mt-0.5 bg-background border border-border rounded px-2 py-1 text-xs"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSave}
            disabled={saving}
            className="text-xs bg-primary text-primary-foreground hover:opacity-90 px-3 py-1.5 rounded-md transition-opacity font-medium disabled:opacity-50"
          >
            Save
          </button>
          <button onClick={onCancel} className="text-xs bg-muted text-muted-foreground hover:bg-muted/80 px-3 py-1.5 rounded-md transition-colors">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {lots.map((lot) => {
        if (editingId === lot.id) {
          return <div key={lot.id}>{renderForm(() => handleSaveEdit(lot.id), () => setEditingId(null))}</div>
        }
        const count = Number(lot.count)
        const costPrice = Number(lot.cost_price)
        const totalCost = count * costPrice
        const totalFace = faceValue != null ? count * faceValue : null
        return (
          <div key={lot.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-medium">{formatDateMDY(lot.purchase_date)}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {fmtUnits(count)} units @ <span className={hiddenValueClass(hideValues)}>{fmt(costPrice)} = {fmt(totalCost)}</span>
                {totalFace != null && <span className={hiddenValueClass(hideValues, 'text-muted-foreground/70')}> · face {fmt(totalFace)}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => startEdit(lot)} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Edit lot">
                <Pencil size={12} />
              </button>
              <button onClick={() => onDeleteLot(lot.id)} className="text-muted-foreground hover:text-destructive transition-colors" aria-label="Delete lot">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        )
      })}

      {adding ? (
        renderForm(handleSaveAdd, () => setAdding(false))
      ) : (
        <button
          onClick={startAdd}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-lg py-2 transition-colors"
        >
          <Plus size={13} /> Add Lot
        </button>
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
