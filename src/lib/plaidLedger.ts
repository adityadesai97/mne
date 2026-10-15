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

// A reduction/removal of shares the user still has to attribute to specific lots:
// Plaid's investment transactions never say which lot a sell came out of, so a
// sell is only applied automatically when the lot is provable (see planLedger).
export interface PendingLotSell {
  txnId: string
  date: string
  type: string
  quantity: number
  price: number | null
}

export interface LedgerPlan {
  ops: LedgerOp[]
  applied: string[]
  skipped: Array<{ txnId: string; reason: string }>
  /** Sells that couldn't be attributed to lots; nothing was changed for these. */
  needsLots: PendingLotSell[]
}

/** One of Plaid's own tax lots for a holding (quantity still held, per-unit cost, purchase date). */
export interface PlaidTaxLot {
  quantity: number
  price: number
  date: string
}

/** A user-confirmed pairing of a tracked lot with the Plaid lot it corresponds to (for when their date/cost differ). */
export interface LotLink {
  lotId: string
  plaidDate: string
  plaidPrice: number
}

export interface PlanLedgerOptions {
  /**
   * What to do with a sell that can't be pinned to specific lots.
   * 'defer' (default) leaves it for the user to match; 'fifo' takes the oldest lots
   * first — only for callers acting on an explicit user request (drift resolution).
   */
  sellMode?: 'defer' | 'fifo'
  /** Plaid's remaining lots for this holding; null/undefined when Plaid reports no usable lot breakdown. */
  plaidLots?: PlaidTaxLot[] | null
  lotLinks?: LotLink[]
  /** True when earlier sells for this position are still waiting on the user, so lot state is stale. */
  deferAllSells?: boolean
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

const LOT_PRICE_TOLERANCE = 0.01
const ATTRIBUTION_TOLERANCE = 0.000001

/**
 * Works out which tracked lots a batch of sells came out of by comparing them with the lots
 * Plaid says remain. Returns null unless the answer is certain: every Plaid lot must belong to
 * a tracked lot, no lot may have grown, and the reductions must add up to the shares sold.
 */
export function attributeSellsFromPlaidLots(
  tracked: Array<{ id: string; count: number; cost_price: number; purchase_date: string }>,
  plaidLots: PlaidTaxLot[],
  links: LotLink[],
  totalSold: number,
): Array<{ lotId: string; reduceBy: number }> | null {
  const claimed = new Set<number>()
  const remaining = new Map<string, number>()
  for (const lot of tracked) {
    const link = links.find((l) => l.lotId === lot.id)
    const date = link ? link.plaidDate : lot.purchase_date
    const price = link ? link.plaidPrice : Number(lot.cost_price)
    let qty = 0
    plaidLots.forEach((p, i) => {
      if (p.date === date && Math.abs(p.price - price) < LOT_PRICE_TOLERANCE) {
        if (claimed.has(i)) return
        claimed.add(i)
        qty += p.quantity
      }
    })
    remaining.set(lot.id, qty)
  }
  // A Plaid lot we can't pair with anything tracked is unexplained, so nothing is certain.
  if (claimed.size !== plaidLots.length) return null

  const out: Array<{ lotId: string; reduceBy: number }> = []
  let sum = 0
  for (const lot of tracked) {
    const reduceBy = round8(Number(lot.count) - (remaining.get(lot.id) ?? 0))
    if (reduceBy < -ATTRIBUTION_TOLERANCE) return null
    if (reduceBy > ATTRIBUTION_TOLERANCE) {
      out.push({ lotId: lot.id, reduceBy })
      sum += reduceBy
    }
  }
  if (Math.abs(sum - totalSold) > ATTRIBUTION_TOLERANCE) return null
  return out
}

export function planLedger(lots: LedgerLot[], txns: PlaidInvestmentTxn[], options: PlanLedgerOptions = {}): LedgerPlan {
  const sellMode = options.sellMode ?? 'defer'
  const working: WorkingLot[] = lots.map((l) => ({
    ...l,
    count: Number(l.count),
    cost_price: Number(l.cost_price),
    txnIds: [],
  }))
  const ops: LedgerOp[] = []
  const applied: string[] = []
  const skipped: Array<{ txnId: string; reason: string }> = []
  const needsLots: PendingLotSell[] = []
  // Sells held back for lot attribution; may still be resolved together from Plaid's lots below.
  let deferring = !!options.deferAllSells

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
      const sell: PendingLotSell = { txnId: id, date: txn.date, type, quantity: amount, price: txn.price == null ? null : Number(txn.price) }
      if (sellMode === 'fifo') {
        const problem = consume(id, amount)
        if (problem) skipped.push({ txnId: id, reason: problem })
        else applied.push(id)
        continue
      }
      // Once one sell is waiting on the user, lot state no longer reflects reality, so every
      // later sell waits too rather than being judged against stale lots.
      if (deferring) {
        needsLots.push(sell)
        continue
      }
      if (totalShares() + EPSILON < amount) {
        skipped.push({ txnId: id, reason: `only ${round8(totalShares())} shares tracked, transaction reduces ${round8(amount)}` })
        continue
      }
      const live = liveLots()
      // Provable without guessing: the sale empties the position, or there is only one lot to take from.
      if (Math.abs(totalShares() - amount) < EPSILON || live.length === 1) {
        consume(id, amount)
        applied.push(id)
        continue
      }
      deferring = true
      needsLots.push(sell)
    }
  }

  // Sells that need lot attribution: Plaid reports the lots it still holds, so when every
  // tracked lot can be paired with one and the per-lot reductions add up to exactly the
  // shares sold, the lots are proven rather than guessed.
  if (needsLots.length > 0 && options.plaidLots && options.plaidLots.length > 0) {
    const totalSold = needsLots.reduce((sum, t) => sum + t.quantity, 0)
    const reductions = attributeSellsFromPlaidLots(liveLots(), options.plaidLots, options.lotLinks ?? [], totalSold)
    if (reductions) {
      for (const r of reductions) {
        const target = working.find((l) => l.id === r.lotId)!
        target.count = round8(target.count - r.reduceBy)
        if (target.count <= EPSILON) target.deleted = true
        target.dirty = true
        target.txnIds.push(needsLots[0].txnId)
      }
      for (const t of needsLots) applied.push(t.txnId)
      needsLots.length = 0
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

  return { ops, applied, skipped, needsLots }
}

export const DRIFT_TOLERANCE_SHARES = 0.000001

// Positive = Plaid reports more shares than mne tracks. `plaidShares` null means
// we couldn't read Plaid's holdings this run, so nothing is known — no drift.
export function computeDrift(trackedShares: number, plaidShares: number | null): number | null {
  if (plaidShares == null) return null
  const diff = round8(plaidShares - trackedShares)
  return Math.abs(diff) < DRIFT_TOLERANCE_SHARES ? 0 : diff
}
