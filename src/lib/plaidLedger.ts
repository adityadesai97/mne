// Pure ledger math for Plaid investment-transaction sync. Canonical source —
// supabase/functions/plaid-sync/index.ts and plaid-sync-me/index.ts carry
// hand-kept Deno ports of planLedger/computeDrift (edge functions can't import
// from src/), so change all three together.
//
// Given a linked position's current lots and the Plaid investment transactions
// reported for it, planLedger returns the lot operations to apply — never a
// delete of anything but a fully-consumed lot, and never a partial application
// of a transaction it can't fully explain (those are reported as `skipped`
// and left for the drift check to surface).

export interface LedgerLot {
  id: string
  count: number
  cost_price: number
  purchase_date: string
}

export interface PlaidInvestmentTxn {
  investment_transaction_id: string
  date: string
  type: string
  subtype?: string | null
  quantity: number | null
  price: number | null
}

export type LedgerOp =
  | { kind: 'add_lot'; txnId: string; count: number; cost_price: number; purchase_date: string }
  | { kind: 'update_lot'; txnId: string; lotId: string; count: number; cost_price?: number }
  | { kind: 'delete_lot'; txnId: string; lotId: string }

export interface LedgerPlan {
  ops: LedgerOp[]
  applied: string[]
  skipped: Array<{ txnId: string; reason: string }>
}

// 8 decimals throughout: crypto units and per-unit prices need them (the lot
// columns are numeric(20,8)/numeric(18,8) for crypto), and for stocks the
// database simply rounds to its own narrower scale on write.
const round8 = (n: number) => Math.round(n * 1e8) / 1e8
const EPSILON = 1e-8

interface WorkingLot extends LedgerLot {
  isNew?: boolean
  dirty?: boolean
  deleted?: boolean
  costDirty?: boolean
  txnIds: string[]
}

export function planLedger(lots: LedgerLot[], txns: PlaidInvestmentTxn[]): LedgerPlan {
  const working: WorkingLot[] = lots.map((l) => ({
    ...l,
    count: Number(l.count),
    cost_price: Number(l.cost_price),
    txnIds: [],
  }))
  const ops: LedgerOp[] = []
  const applied: string[] = []
  const skipped: Array<{ txnId: string; reason: string }> = []

  const sorted = [...txns].sort((a, b) =>
    a.date === b.date
      ? a.investment_transaction_id.localeCompare(b.investment_transaction_id)
      : a.date.localeCompare(b.date),
  )

  const liveLots = () => working.filter((l) => !l.deleted)
  const totalShares = () => liveLots().reduce((s, l) => s + l.count, 0)

  // Consumes `qty` shares oldest-lot-first (Plaid doesn't say which lot a sell
  // targeted, and FIFO is the brokerage default). All-or-nothing: if the
  // tracked lots can't cover it, nothing changes.
  function consume(txnId: string, qty: number): string | null {
    if (totalShares() + EPSILON < qty) {
      return `only ${round8(totalShares())} shares tracked, transaction reduces ${round8(qty)}`
    }
    let remaining = qty
    const fifo = liveLots().sort((a, b) => a.purchase_date.localeCompare(b.purchase_date))
    for (const lot of fifo) {
      if (remaining <= EPSILON) break
      if (lot.count <= remaining + EPSILON) {
        remaining -= lot.count
        lot.deleted = true
        lot.dirty = true
        lot.txnIds.push(txnId)
      } else {
        lot.count = round8(lot.count - remaining)
        remaining = 0
        lot.dirty = true
        lot.txnIds.push(txnId)
      }
    }
    return null
  }

  for (const txn of sorted) {
    const id = txn.investment_transaction_id
    const type = (txn.type ?? '').toLowerCase()
    const subtype = (txn.subtype ?? '').toLowerCase()
    const qty = Number(txn.quantity ?? 0)

    const isSplit = subtype === 'split' || subtype === 'stock split'
    const affectsShares = type === 'buy' || type === 'sell' || type === 'transfer' || isSplit
    if (!affectsShares || !Number.isFinite(qty) || Math.abs(qty) < EPSILON) continue

    if (isSplit) {
      // Plaid reports the shares *added* by the split. Scale every lot so
      // total shares rise by that amount while each lot's total cost basis
      // stays unchanged.
      const before = totalShares()
      if (qty <= 0 || before <= EPSILON) {
        skipped.push({ txnId: id, reason: 'split with nothing tracked to split' })
        continue
      }
      const ratio = (before + qty) / before
      for (const lot of liveLots()) {
        lot.count = round8(lot.count * ratio)
        lot.cost_price = round8(lot.cost_price / ratio)
        lot.dirty = true
        lot.costDirty = true
        lot.txnIds.push(id)
      }
      applied.push(id)
      continue
    }

    const isIncrease = type === 'buy' ? true : type === 'sell' ? false : qty > 0
    const amount = Math.abs(qty)

    if (isIncrease) {
      const price = txn.price == null ? NaN : Number(txn.price)
      if (!Number.isFinite(price) || price < 0) {
        skipped.push({ txnId: id, reason: 'no usable price to cost the new lot' })
        continue
      }
      working.push({
        id: `new:${id}`,
        count: round8(amount),
        cost_price: round8(price),
        purchase_date: txn.date,
        isNew: true,
        txnIds: [id],
      })
      applied.push(id)
    } else {
      const problem = consume(id, amount)
      if (problem) {
        skipped.push({ txnId: id, reason: problem })
        continue
      }
      applied.push(id)
    }
  }

  for (const lot of working) {
    const txnId = lot.txnIds[0]
    if (lot.isNew) {
      if (lot.deleted) continue // bought then fully sold within the window
      ops.push({
        kind: 'add_lot',
        txnId: txnId,
        count: lot.count,
        cost_price: lot.cost_price,
        purchase_date: lot.purchase_date,
      })
    } else if (lot.dirty) {
      if (lot.deleted) ops.push({ kind: 'delete_lot', txnId, lotId: lot.id })
      else
        ops.push({
          kind: 'update_lot',
          txnId,
          lotId: lot.id,
          count: lot.count,
          ...(lot.costDirty ? { cost_price: lot.cost_price } : {}),
        })
    }
  }

  return { ops, applied, skipped }
}

export const DRIFT_TOLERANCE_SHARES = 0.000001

// Positive = Plaid reports more shares than mne tracks. `plaidShares` null means
// we couldn't read Plaid's holdings this run, so nothing is known — no drift.
export function computeDrift(trackedShares: number, plaidShares: number | null): number | null {
  if (plaidShares == null) return null
  const diff = round8(plaidShares - trackedShares)
  return Math.abs(diff) < DRIFT_TOLERANCE_SHARES ? 0 : diff
}
