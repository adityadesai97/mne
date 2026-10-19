// Exchange-traded calls and puts held on a stock position's underlying.
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { formatDateMDY } from '@/lib/dates'
import { closedContractResult, contractShares, contractSpread, isContractExpired, isContractOpen, type OptionContract } from '@/lib/options'
import type { NewOptionContract } from '@/lib/db/optionContracts'
import { useHideValues } from '@/hooks/useHideValues'
import { Dropdown } from '@/components/mne/Dropdown'
import { fmtMoney, fmtMoney0, fmtQty } from '@/components/lots/lotMath'
import { Hide } from '@/components/lots/parts'
import '@/styles/portfolio.css'

type Contract = OptionContract & { id: string; close_premium_per_share?: number | string | null }
const today = () => new Date().toISOString().split('T')[0]

const TYPE_OPTIONS = [
  { value: 'call', label: 'Call' },
  { value: 'put', label: 'Put' },
] as const

export function OptionContractList({ contracts, price, onClose, onDelete }: {
  contracts: Contract[]
  price: number | null
  onClose?: (id: string) => Promise<void>
  onDelete?: (id: string) => Promise<void>
}) {
  const [hideValues] = useHideValues()
  const sorted = [...contracts].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
  return (
    <div className="lot-stack">
      {sorted.map(c => {
        const open = isContractOpen(c)
        const shares = contractShares(c)
        const intrinsic = open && price != null ? contractSpread(c, price) * shares : null
        const paid = Number(c.premium_per_share) * shares
        const realized = closedContractResult(c)
        const status = c.closed_date ? `Closed ${formatDateMDY(c.closed_date)}` : isContractExpired(c) ? 'Expired' : null
        return (
          <div key={c.id} className="lot-grant">
            <div className="lot-between">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {fmtQty(Number(c.contracts))} × {fmtMoney(Number(c.strike_price))} {c.option_type === 'put' ? 'put' : 'call'}
                  <span className="mne-muted" style={{ fontWeight: 400 }}> · expires {formatDateMDY(c.expiry_date)}</span>
                </div>
                <div className="mne-help">
                  Paid {fmtMoney(Number(c.premium_per_share))}/share (<Hide hidden={hideValues}>{fmtMoney0(paid)}</Hide> total)
                  {c.purchase_date && <> · bought {formatDateMDY(c.purchase_date)}</>}
                  {status && <> · {status}</>}
                </div>
              </div>
              <div className="pf-actions" style={{ alignItems: 'center' }}>
                {intrinsic != null ? (
                  <span><Hide hidden={hideValues}>{fmtMoney0(intrinsic)}</Hide> <span className="mne-help">intrinsic</span></span>
                ) : realized != null ? (
                  <span className="mne-help">Result <Hide hidden={hideValues}>{realized < 0 ? '−' : ''}{fmtMoney0(Math.abs(realized))}</Hide></span>
                ) : null}
                {open && onClose && (
                  <button type="button" className="mne-btn is-ghost is-sm" onClick={() => { void onClose(c.id) }}>Close</button>
                )}
                {onDelete && (
                  <button type="button" className="pf-iconbtn is-danger" aria-label="Delete contract" title="Delete contract" onClick={() => { void onDelete(c.id) }}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function AddOptionContractForm({ onAdd }: { onAdd: (c: NewOptionContract) => Promise<void> }) {
  const blank = { type: 'call' as 'call' | 'put', strike: '', expiry: '', contracts: '1', premium: '', purchased: today() }
  const [adding, setAdding] = useState(false)
  const [v, setV] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setV(prev => ({ ...prev, [k]: e.target.value }))

  async function save() {
    setError(null)
    setSaving(true)
    try {
      await onAdd({
        option_type: v.type,
        strike_price: parseFloat(v.strike),
        expiry_date: v.expiry,
        contracts: parseFloat(v.contracts),
        premium_per_share: parseFloat(v.premium),
        purchase_date: v.purchased,
      })
      setAdding(false)
    } catch (err: any) {
      setError(err.message ?? 'Could not add the contract.')
    } finally {
      setSaving(false)
    }
  }

  if (!adding) {
    return (
      <button type="button" className="mne-btn is-ghost is-sm" onClick={() => { setV(blank); setError(null); setAdding(true) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Plus size={14} aria-hidden="true" /> Add call / put
      </button>
    )
  }

  return (
    <div className="pf-lot-edit">
      <div className="pf-lot-edit-grid">
        <div className="mne-field"><label>Type</label>
          <Dropdown<'call' | 'put'> label="Option type" value={v.type} options={TYPE_OPTIONS} onChange={type => setV(prev => ({ ...prev, type }))} /></div>
        <div className="mne-field"><label htmlFor="opt-strike">Strike</label>
          <input id="opt-strike" className="mne-input" type="number" step="any" min="0" value={v.strike} onChange={set('strike')} /></div>
        <div className="mne-field"><label htmlFor="opt-expiry">Expiry</label>
          <input id="opt-expiry" className="mne-input" type="date" value={v.expiry} onChange={set('expiry')} /></div>
        <div className="mne-field"><label htmlFor="opt-contracts">Contracts</label>
          <input id="opt-contracts" className="mne-input" type="number" step="any" min="0" value={v.contracts} onChange={set('contracts')} /></div>
        <div className="mne-field"><label htmlFor="opt-premium">Premium / share</label>
          <input id="opt-premium" className="mne-input" type="number" step="any" min="0" value={v.premium} onChange={set('premium')} /></div>
        <div className="mne-field"><label htmlFor="opt-bought">Purchase date</label>
          <input id="opt-bought" className="mne-input" type="date" value={v.purchased} onChange={set('purchased')} /></div>
      </div>
      <p className="mne-help" style={{ margin: 0 }}>One contract covers 100 shares. Valued at intrinsic value only (no time value).</p>
      {error && <p className="text-loss" role="alert" style={{ margin: 0 }}>▼ {error}</p>}
      <div className="pf-actions">
        <button type="button" className="mne-btn is-sm" onClick={save} disabled={saving}>Save</button>
        <button type="button" className="mne-btn is-ghost is-sm" onClick={() => setAdding(false)}>Cancel</button>
      </div>
    </div>
  )
}
