// Pure helpers for matching a sale Plaid reported (but couldn't attribute) to specific
// lots by hand: the user says how many units came out of each lot, and these check it
// adds up before anything is written.

export interface AllocatableLot {
  id: string
  count: number
  cost_price: number
  purchase_date: string
}

const TOLERANCE = 0.000001
const round8 = (n: number) => Math.round(n * 1e8) / 1e8

/** Oldest lots first — only offered as a one-click starting point the user can still edit. */
export function oldestFirstAllocation(lots: AllocatableLot[], quantity: number): Record<string, number> {
  const out: Record<string, number> = {}
  let remaining = quantity
  for (const lot of [...lots].sort((a, b) => a.purchase_date.localeCompare(b.purchase_date))) {
    if (remaining <= TOLERANCE) break
    const take = Math.min(Number(lot.count), remaining)
    out[lot.id] = round8(take)
    remaining = round8(remaining - take)
  }
  return out
}

/** Returns an error message, or null when the allocation is exactly the shares sold and fits each lot. */
export function validateAllocation(
  lots: AllocatableLot[],
  allocation: Record<string, number>,
  quantity: number,
): string | null {
  let total = 0
  for (const lot of lots) {
    const amount = Number(allocation[lot.id] ?? 0)
    if (!Number.isFinite(amount) || amount < 0) return 'Amounts must be zero or more.'
    if (amount > Number(lot.count) + TOLERANCE) return `The ${lot.purchase_date} lot only has ${lot.count}.`
    total += amount
  }
  const diff = round8(quantity - total)
  if (Math.abs(diff) > TOLERANCE) {
    return diff > 0 ? `${diff} still to assign.` : `${Math.abs(diff)} too many assigned.`
  }
  return null
}

/** Lot changes for an allocation: lots taken to zero are removed, the rest reduced. */
export function allocationOps(
  lots: AllocatableLot[],
  allocation: Record<string, number>,
): Array<{ kind: 'update'; lotId: string; count: number } | { kind: 'delete'; lotId: string }> {
  const ops: Array<{ kind: 'update'; lotId: string; count: number } | { kind: 'delete'; lotId: string }> = []
  for (const lot of lots) {
    const amount = Number(allocation[lot.id] ?? 0)
    if (amount <= TOLERANCE) continue
    const left = round8(Number(lot.count) - amount)
    if (left <= TOLERANCE) ops.push({ kind: 'delete', lotId: lot.id })
    else ops.push({ kind: 'update', lotId: lot.id, count: left })
  }
  return ops
}
