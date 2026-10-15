import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
        <p className="text-sm text-muted-foreground">
          Plaid reports {sell.quantity} {unit} of {sell.symbol ?? sell.assetName} sold on {sell.date}
          {sell.price != null ? ` at $${sell.price}` : ''}, but not which purchase they came from. Say how many
          came out of each lot — it has to add up to {sell.quantity}.
        </p>
        {sell.lots.length === 0 ? (
          <p className="text-sm text-destructive">No regular lots are tracked for this position, so there is nothing to reduce.</p>
        ) : (
          <div className="space-y-2">
            {sell.lots.map((lot) => (
              <label key={lot.id} className="flex items-center gap-3 rounded-md border border-border/70 p-2 text-sm">
                <span className="flex-1">
                  <span className="block">{lot.purchase_date}</span>
                  <span className="block text-xs text-muted-foreground">
                    {lot.count} {unit} @ ${lot.cost_price}
                  </span>
                </span>
                <Input
                  className="w-28"
                  type="number"
                  min={0}
                  step="any"
                  max={lot.count}
                  placeholder="0"
                  value={amounts[lot.id] ?? ''}
                  onChange={(e) => setAmounts((prev) => ({ ...prev, [lot.id]: e.target.value }))}
                />
              </label>
            ))}
            <div className="flex items-center justify-between text-xs">
              <span className={problem ? 'text-muted-foreground' : 'text-green-600'}>
                {problem ?? 'Adds up'} ({Math.round(assigned * 1e8) / 1e8} of {sell.quantity})
              </span>
              <button
                type="button"
                className="text-primary hover:underline"
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
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={busy || !!problem || sell.lots.length === 0}
            onClick={() => void apply()}
            className="flex-1 bg-primary text-primary-foreground rounded-md py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Apply to these lots'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void ignore()}
            className="flex-1 bg-muted text-muted-foreground rounded-md py-1.5 text-xs hover:bg-muted/80 disabled:opacity-50"
          >
            Leave lots as they are
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
