// Option (ESOP) grants for a stock asset: vesting progress, what is exercisable,
// intrinsic value, and the exercise flow that converts options into shares.
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { formatDateMDY } from '@/lib/dates'
import { computeEsopPosition, optionSpread, type EsopGrant } from '@/lib/esop'
import { validateExercise, type ExerciseInput, type NewEsopGrant } from '@/lib/db/esop'
import { useHideValues } from '@/hooks/useHideValues'
import { Stat } from '@/components/mne'
import { Dropdown } from '@/components/mne/Dropdown'
import { fmtMoney, fmtMoney0, fmtQty, plural } from '@/components/lots/lotMath'
import { Hide, ProgressBar } from '@/components/lots/parts'
import '@/styles/portfolio.css'

type Grant = EsopGrant & { id: string }
const FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'continuous', label: 'Continuously' },
] as const
const today = () => new Date().toISOString().split('T')[0]

export function EsopGrantList({ grants, price, onExercise, onEndGrant, onDeleteGrant }: {
  grants: Grant[]
  price: number | null
  onExercise?: (grant: Grant, input: ExerciseInput) => Promise<void>
  onEndGrant?: (grantId: string) => Promise<void>
  onDeleteGrant?: (grantId: string) => Promise<void>
}) {
  const [hideValues] = useHideValues()
  const [exercisingId, setExercisingId] = useState<string | null>(null)
  const sorted = [...grants].sort((a, b) => String(b.grant_date).localeCompare(String(a.grant_date)))

  return (
    <div className="lot-stack">
      {sorted.map(grant => {
        const pos = computeEsopPosition(grant)
        const total = Number(grant.total_options)
        const strike = Number(grant.strike_price)
        const vestedPct = total > 0 ? (pos.vested / total) * 100 : 0
        const spread = price != null ? optionSpread(price, strike) : null
        const value = spread != null ? pos.exercisable * spread : null
        const underwater = price != null && price <= strike

        return (
          <div key={grant.id} className="lot-grant">
            <div className="lot-between">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {fmtQty(total)} options @ {fmtMoney(strike)} <span className="mne-muted" style={{ fontWeight: 400 }}>· granted {formatDateMDY(grant.grant_date)}</span>
                </div>
                <div className="mne-help">
                  Vesting {formatDateMDY(grant.vest_start)} → {formatDateMDY(grant.vest_end)}
                  {grant.vesting_frequency && <> · {grant.vesting_frequency}</>}
                  {grant.expiry_date && <> · {pos.expired ? 'Expired' : 'Expires'} {formatDateMDY(grant.expiry_date)}</>}
                  {grant.ended_at && <> · Ended {formatDateMDY(grant.ended_at)}</>}
                </div>
              </div>
              <div className="pf-actions" style={{ alignItems: 'center' }}>
                {grant.ended_at ? (
                  <span className="mne-chip is-outline">Ended</span>
                ) : onEndGrant ? (
                  <button type="button" className="mne-btn is-ghost is-sm" onClick={() => { void onEndGrant(grant.id) }}>End Grant</button>
                ) : null}
                {onDeleteGrant && (
                  <button type="button" className="pf-iconbtn is-danger" aria-label="Delete grant" title="Delete grant" onClick={() => { void onDeleteGrant(grant.id) }}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            <div className="lot-stats">
              <Stat label="Vested" value={fmtQty(pos.vested)} sub={`${vestedPct.toFixed(0)}% of ${fmtQty(total)}`} subClassName="mne-muted" />
              <Stat label="Exercised" value={fmtQty(pos.exercised)} />
              <Stat label="Exercisable" value={fmtQty(pos.exercisable)} sub={pos.expired ? 'expired' : underwater ? 'below strike' : undefined} subClassName="mne-muted" />
              <Stat label="Intrinsic value"
                value={value != null ? <Hide hidden={hideValues}>{fmtMoney0(value)}</Hide> : <span className="mne-muted">—</span>} />
            </div>
            <ProgressBar pct={vestedPct} tone="accent" />

            {onExercise && pos.exercisable > 0 && (
              exercisingId === grant.id ? (
                <ExerciseForm
                  grant={grant}
                  defaultCost={price}
                  exercisable={pos.exercisable}
                  onCancel={() => setExercisingId(null)}
                  onSubmit={async input => { await onExercise(grant, input); setExercisingId(null) }}
                />
              ) : (
                <div>
                  <button type="button" className="mne-btn is-ghost is-sm" onClick={() => setExercisingId(grant.id)}>
                    Exercise options
                  </button>
                </div>
              )
            )}

            {(grant.esop_exercises?.length ?? 0) > 0 && (
              <div className="mne-help">
                {(grant.esop_exercises ?? []).length} {plural((grant.esop_exercises ?? []).length, 'exercise', 'exercises')}:{' '}
                {[...(grant.esop_exercises as any[])]
                  .sort((a, b) => String(b.exercise_date).localeCompare(String(a.exercise_date)))
                  .map(e => `${fmtQty(Number(e.count))} on ${formatDateMDY(e.exercise_date)}`)
                  .join(', ')}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ExerciseForm({ grant, defaultCost, exercisable, onSubmit, onCancel }: {
  grant: Grant
  defaultCost: number | null
  exercisable: number
  onSubmit: (input: ExerciseInput) => Promise<void>
  onCancel: () => void
}) {
  const [count, setCount] = useState(String(exercisable))
  const [date, setDate] = useState(today())
  const [cost, setCost] = useState(defaultCost != null ? String(defaultCost) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const strike = Number(grant.strike_price)
  const n = parseFloat(count)
  const basis = parseFloat(cost)

  async function save() {
    const input: ExerciseInput = { count: n, exerciseDate: date, costPrice: basis }
    if (cost.trim() === '') return setError('Enter the cost basis per share.')
    const problem = validateExercise(grant, input)
    if (problem) return setError(problem)
    setError(null)
    setSaving(true)
    try {
      await onSubmit(input)
    } catch (err: any) {
      setError(err.message ?? 'Could not exercise these options.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pf-lot-edit">
      <div className="pf-lot-edit-grid">
        <div className="mne-field">
          <label htmlFor={`ex-count-${grant.id}`}>Options to exercise</label>
          <input id={`ex-count-${grant.id}`} className="mne-input" type="number" step="any" min="0" value={count} onChange={e => setCount(e.target.value)} />
        </div>
        <div className="mne-field">
          <label htmlFor={`ex-date-${grant.id}`}>Exercise date</label>
          <input id={`ex-date-${grant.id}`} className="mne-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="mne-field">
          <label htmlFor={`ex-cost-${grant.id}`}>Cost basis / share</label>
          <input id={`ex-cost-${grant.id}`} className="mne-input" type="number" step="any" min="0" value={cost} onChange={e => setCost(e.target.value)} />
        </div>
      </div>
      {n > 0 && (
        <p className="mne-help" style={{ margin: 0 }}>
          Pay {fmtMoney(n * strike)} to exercise ({fmtMoney(strike)} strike) and receive {fmtQty(n)} {plural(n, 'share', 'shares')}
          {basis >= 0 && <> with a cost basis of {fmtMoney(n * basis)}</>}.
        </p>
      )}
      {error && <p className="text-loss" role="alert" style={{ margin: 0 }}>▼ {error}</p>}
      <div className="pf-actions">
        <button type="button" className="mne-btn is-sm" onClick={save} disabled={saving}>Convert to shares</button>
        <button type="button" className="mne-btn is-ghost is-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

export function AddEsopGrantForm({ onAdd }: { onAdd: (grant: NewEsopGrant) => Promise<void> }) {
  const blank = { grant_date: today(), total: '', strike: '', vest_start: today(), vest_end: '', cliff: '', frequency: 'monthly' as NewEsopGrant['vesting_frequency'], expiry: '' }
  const [adding, setAdding] = useState(false)
  const [v, setV] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setV(prev => ({ ...prev, [k]: e.target.value }))

  async function save() {
    const total = parseFloat(v.total)
    const strike = parseFloat(v.strike)
    if (!(total > 0)) return setError('Enter the number of options.')
    if (!(strike >= 0) || v.strike.trim() === '') return setError('Enter the strike price.')
    if (!v.grant_date || !v.vest_start || !v.vest_end) return setError('Enter grant, vest start and vest end dates.')
    if (new Date(v.vest_start) >= new Date(v.vest_end)) return setError('Vest start must be before vest end.')
    setError(null)
    setSaving(true)
    try {
      await onAdd({
        grant_date: v.grant_date,
        total_options: total,
        strike_price: strike,
        vest_start: v.vest_start,
        vest_end: v.vest_end,
        cliff_date: v.cliff || null,
        vesting_frequency: v.frequency,
        expiry_date: v.expiry || null,
      })
      setAdding(false)
    } catch (err: any) {
      setError(err.message ?? 'Could not add the grant.')
    } finally {
      setSaving(false)
    }
  }

  if (!adding) {
    return (
      <button type="button" className="mne-btn is-ghost is-sm" onClick={() => { setV(blank); setError(null); setAdding(true) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Plus size={14} aria-hidden="true" /> Add option grant
      </button>
    )
  }

  return (
    <div className="pf-lot-edit">
      <div className="pf-lot-edit-grid">
        <div className="mne-field"><label htmlFor="esop-total">Options granted</label>
          <input id="esop-total" className="mne-input" type="number" step="any" min="0" value={v.total} onChange={set('total')} /></div>
        <div className="mne-field"><label htmlFor="esop-strike">Strike price</label>
          <input id="esop-strike" className="mne-input" type="number" step="any" min="0" value={v.strike} onChange={set('strike')} /></div>
        <div className="mne-field"><label htmlFor="esop-grant">Grant date</label>
          <input id="esop-grant" className="mne-input" type="date" value={v.grant_date} onChange={set('grant_date')} /></div>
        <div className="mne-field"><label htmlFor="esop-vs">Vest start</label>
          <input id="esop-vs" className="mne-input" type="date" value={v.vest_start} onChange={set('vest_start')} /></div>
        <div className="mne-field"><label htmlFor="esop-ve">Vest end</label>
          <input id="esop-ve" className="mne-input" type="date" value={v.vest_end} onChange={set('vest_end')} /></div>
        <div className="mne-field"><label htmlFor="esop-cliff">Cliff date (optional)</label>
          <input id="esop-cliff" className="mne-input" type="date" value={v.cliff} onChange={set('cliff')} /></div>
        <div className="mne-field"><label>Vests</label>
          <Dropdown<NewEsopGrant['vesting_frequency']> label="Vesting frequency" value={v.frequency} options={FREQUENCY_OPTIONS}
            onChange={frequency => setV(prev => ({ ...prev, frequency }))} /></div>
        <div className="mne-field"><label htmlFor="esop-exp">Expiry date (optional)</label>
          <input id="esop-exp" className="mne-input" type="date" value={v.expiry} onChange={set('expiry')} /></div>
      </div>
      {error && <p className="text-loss" role="alert" style={{ margin: 0 }}>▼ {error}</p>}
      <div className="pf-actions">
        <button type="button" className="mne-btn is-sm" onClick={save} disabled={saving}>Save</button>
        <button type="button" className="mne-btn is-ghost is-sm" onClick={() => setAdding(false)}>Cancel</button>
      </div>
    </div>
  )
}
