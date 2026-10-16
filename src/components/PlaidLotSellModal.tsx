import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { dismissHeldLotSell, resolveHeldLotSell, type HeldLotSell } from '@/lib/db/plaid'
import { oldestFirstAllocation, validateAllocation } from '@/lib/plaidLotAllocation'

// Plaid reported a sale but not which lot it came out of, and the sync couldn't
// prove it from Plaid's remaining lots, so nothing was changed. The user says
// how much came out of each lot; it has to add up to the shares sold exactly.

interface Props {
  sell: HeldLotSell | null
  onClose: () => void
  onChanged: () => void
}

export function PlaidLotSellModal({ sell, onClose, onChanged }: Props) {
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setAmounts({})
    setError('')
  }, [sell?.id])

  const allocation = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [id, raw] of Object.entries(amounts)) out[id] = raw === '' ? 0 : Number(raw)
    return out
  }, [amounts])

  if (!sell) return null
  const unit = sell.isCrypto ? 'units' : 'shares'
  const problem = validateAllocation(sell.lots, allocation, sell.quantity)
  const assigned = Object.values(allocation).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)

  async function apply() {
    if (!sell) return
    setBusy(true)
    setError('')
    try {
      await resolveHeldLotSell(sell, allocation)
      onChanged()
      onClose()
    } catch (e: any) {
      setError(e.message ?? 'Failed to update lots')
    } finally {
      setBusy(false)
    }
  }

  async function ignore() {
    if (!sell) return
    setBusy(true)
    try {
      await dismissHeldLotSell(sell.id)
      onChanged()
      onClose()
    } catch (e: any) {
      setError(e.message ?? 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Which lots did you sell?</DialogTitle>
        </DialogHeader>
        <p className="mne-muted" style={{ margin: 0 }}>
          Plaid reports {sell.quantity} {unit} of {sell.symbol ?? sell.assetName} sold on {sell.date}
          {sell.price != null ? ` at $${sell.price}` : ''}, but not which purchase they came from. Say how many
          came out of each lot. It has to add up to {sell.quantity}.
        </p>
        {sell.lots.length === 0 ? (
          <span className="mne-help is-error" role="alert">▼ No regular lots are tracked for this position, so there is nothing to reduce.</span>
        ) : (
          <>
            <table className="mne-table is-compact">
              <thead>
                <tr><th>Lot</th><th className="r">Held</th><th className="r">Sold</th></tr>
              </thead>
              <tbody>
                {sell.lots.map((lot) => (
                  <tr key={lot.id}>
                    <td>{lot.purchase_date} · ${lot.cost_price}</td>
                    <td className="r">{lot.count}</td>
                    <td className="r">
                      <input
                        className="mne-input mne-num"
                        style={{ width: 90, textAlign: 'right' }}
                        type="number"
                        min={0}
                        step="any"
                        max={lot.count}
                        placeholder="0"
                        aria-label={`${unit} sold from ${lot.purchase_date} lot`}
                        value={amounts[lot.id] ?? ''}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [lot.id]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              {problem ? (
                <span className="mne-help is-error">▼ {problem} ({Math.round(assigned * 1e8) / 1e8} of {sell.quantity})</span>
              ) : (
                <span className="mne-help mne-up">Adds up ({Math.round(assigned * 1e8) / 1e8} of {sell.quantity})</span>
              )}
              <button
                type="button"
                className="mne-btn is-quiet is-sm"
                onClick={() =>
                  setAmounts(
                    Object.fromEntries(
                      Object.entries(oldestFirstAllocation(sell.lots, sell.quantity)).map(([k, v]) => [k, String(v)]),
                    ),
                  )
                }
              >
                Fill oldest first
              </button>
            </div>
          </>
        )}
        {error && <span className="mne-help is-error" role="alert">▼ {error}</span>}
        <div className="mne-dialog-actions">
          <button type="button" className="mne-btn is-quiet" disabled={busy} onClick={() => void ignore()}>
            Leave lots as they are
          </button>
          <button type="button" className="mne-btn" disabled={busy || !!problem || sell.lots.length === 0} onClick={() => void apply()}>
            {busy ? 'Saving…' : 'Apply to these lots'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
