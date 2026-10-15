import { test, expect } from 'vitest'
import { planLedger, computeDrift, attributeSellsFromPlaidLots, type LedgerLot, type PlaidInvestmentTxn } from '../lib/plaidLedger'

const lot = (id: string, count: number, cost: number, date: string): LedgerLot => ({
  id,
  count,
  cost_price: cost,
  purchase_date: date,
})
const txn = (over: Partial<PlaidInvestmentTxn> & { investment_transaction_id: string }): PlaidInvestmentTxn => ({
  date: '2026-09-01',
  type: 'buy',
  subtype: 'buy',
  quantity: 1,
  price: 10,
  ...over,
})

test('a buy adds a new lot at the transaction price and date', () => {
  const plan = planLedger([], [txn({ investment_transaction_id: 'a', quantity: 5, price: 12.5, date: '2026-09-02' })])
  expect(plan.ops).toEqual([
    { kind: 'add_lot', txnId: 'a', count: 5, cost_price: 12.5, purchase_date: '2026-09-02' },
  ])
  expect(plan.applied).toEqual(['a'])
})

test('an ambiguous sell is held for the user instead of guessing a lot', () => {
  const lots = [lot('new', 10, 20, '2025-06-01'), lot('old', 4, 5, '2024-01-01')]
  const plan = planLedger(lots, [txn({ investment_transaction_id: 's', type: 'sell', quantity: -6 })])
  expect(plan.ops).toEqual([])
  expect(plan.applied).toEqual([])
  expect(plan.needsLots).toEqual([{ txnId: 's', date: '2026-09-01', type: 'sell', quantity: 6, price: 10 }])
})

test('a sell that empties the position needs no lot choice', () => {
  const lots = [lot('a', 10, 20, '2025-06-01'), lot('b', 4, 5, '2024-01-01')]
  const plan = planLedger(lots, [txn({ investment_transaction_id: 's', type: 'sell', quantity: -14 })])
  expect(plan.ops).toContainEqual({ kind: 'delete_lot', txnId: 's', lotId: 'a' })
  expect(plan.ops).toContainEqual({ kind: 'delete_lot', txnId: 's', lotId: 'b' })
  expect(plan.needsLots).toEqual([])
})

test('a sell from a position with a single lot comes out of that lot', () => {
  const plan = planLedger([lot('a', 10, 20, '2025-06-01')], [txn({ investment_transaction_id: 's', type: 'sell', quantity: -3 })])
  expect(plan.ops).toEqual([{ kind: 'update_lot', txnId: 's', lotId: 'a', count: 7 }])
})

test('fifo mode (explicit user action) takes the oldest lot first', () => {
  const lots = [lot('new', 10, 20, '2025-06-01'), lot('old', 4, 5, '2024-01-01')]
  const plan = planLedger(lots, [txn({ investment_transaction_id: 's', type: 'sell', quantity: -6 })], { sellMode: 'fifo' })
  expect(plan.ops).toContainEqual({ kind: 'delete_lot', txnId: 's', lotId: 'old' })
  expect(plan.ops).toContainEqual({ kind: 'update_lot', txnId: 's', lotId: 'new', count: 8 })
})

test('once a sell is held, later sells in the batch are held too', () => {
  const lots = [lot('a', 10, 20, '2025-06-01'), lot('b', 4, 5, '2024-01-01')]
  const plan = planLedger(lots, [
    txn({ investment_transaction_id: 's1', type: 'sell', quantity: -3, date: '2026-09-01' }),
    txn({ investment_transaction_id: 's2', type: 'sell', quantity: -11, date: '2026-09-02' }),
  ])
  expect(plan.needsLots.map((t) => t.txnId)).toEqual(['s1', 's2'])
  expect(plan.ops).toEqual([])
})

test('deferAllSells holds even a provable sell while earlier ones still wait', () => {
  const plan = planLedger([lot('a', 10, 20, '2025-06-01')], [txn({ investment_transaction_id: 's', type: 'sell', quantity: -3 })], { deferAllSells: true })
  expect(plan.needsLots).toHaveLength(1)
  expect(plan.ops).toEqual([])
})

test('Plaid lots prove which lot a sell came from', () => {
  const lots = [lot('a', 10, 20, '2025-06-01'), lot('b', 4, 5, '2024-01-01')]
  const plan = planLedger(lots, [txn({ investment_transaction_id: 's', type: 'sell', quantity: -3 })], {
    plaidLots: [
      { quantity: 10, price: 20, date: '2025-06-01' },
      { quantity: 1, price: 5, date: '2024-01-01' },
    ],
  })
  expect(plan.needsLots).toEqual([])
  expect(plan.applied).toEqual(['s'])
  expect(plan.ops).toEqual([{ kind: 'update_lot', txnId: 's', lotId: 'b', count: 1 }])
})

test('a lot Plaid no longer reports is removed when the numbers add up', () => {
  const lots = [lot('a', 10, 20, '2025-06-01'), lot('b', 4, 5, '2024-01-01')]
  const plan = planLedger(lots, [txn({ investment_transaction_id: 's', type: 'sell', quantity: -4 })], {
    plaidLots: [{ quantity: 10, price: 20, date: '2025-06-01' }],
  })
  expect(plan.ops).toEqual([{ kind: 'delete_lot', txnId: 's', lotId: 'b' }])
})

test('Plaid lots that do not add up to the shares sold prove nothing', () => {
  const lots = [lot('a', 10, 20, '2025-06-01'), lot('b', 4, 5, '2024-01-01')]
  const plan = planLedger(lots, [txn({ investment_transaction_id: 's', type: 'sell', quantity: -3 })], {
    plaidLots: [
      { quantity: 9, price: 20, date: '2025-06-01' },
      { quantity: 1, price: 5, date: '2024-01-01' },
    ],
  })
  expect(plan.ops).toEqual([])
  expect(plan.needsLots).toHaveLength(1)
})

test('a Plaid lot that matches nothing tracked leaves the sell for the user', () => {
  const lots = [lot('a', 10, 20, '2025-06-01'), lot('b', 4, 5, '2024-01-01')]
  const plan = planLedger(lots, [txn({ investment_transaction_id: 's', type: 'sell', quantity: -3 })], {
    plaidLots: [
      { quantity: 10, price: 20, date: '2025-06-01' },
      { quantity: 1, price: 5, date: '2024-01-02' },
    ],
  })
  expect(plan.needsLots).toHaveLength(1)
})

test('a confirmed link lets a lot with a different date or cost still be recognised', () => {
  const lots = [lot('a', 10, 20, '2025-06-01'), lot('b', 4, 5.5, '2024-01-03')]
  const reductions = attributeSellsFromPlaidLots(
    lots,
    [
      { quantity: 10, price: 20, date: '2025-06-01' },
      { quantity: 1, price: 5, date: '2024-01-01' },
    ],
    [{ lotId: 'b', plaidDate: '2024-01-01', plaidPrice: 5 }],
    3,
  )
  expect(reductions).toEqual([{ lotId: 'b', reduceBy: 3 }])
})

test('a sell larger than the tracked shares changes nothing and is skipped', () => {
  const plan = planLedger([lot('a', 3, 10, '2025-01-01')], [txn({ investment_transaction_id: 's', type: 'sell', quantity: -5 })])
  expect(plan.ops).toEqual([])
  expect(plan.applied).toEqual([])
  expect(plan.skipped[0].txnId).toBe('s')
})

test('transfers in add a lot and transfers out consume shares', () => {
  const lots = [lot('a', 10, 10, '2025-01-01')]
  const plan = planLedger(lots, [
    txn({ investment_transaction_id: 'in', type: 'transfer', subtype: 'transfer', quantity: 5, price: 11, date: '2026-09-01' }),
    txn({ investment_transaction_id: 'out', type: 'transfer', subtype: 'transfer', quantity: -15, date: '2026-09-02' }),
  ])
  expect(plan.skipped).toEqual([])
  // everything transferred out: the old lot is deleted and the new one never lands
  expect(plan.ops).toContainEqual({ kind: 'delete_lot', txnId: 'out', lotId: 'a' })
  expect(plan.ops.find((o) => o.kind === 'add_lot')).toBeUndefined()
})

test('transactions apply in date order regardless of input order', () => {
  const plan = planLedger([], [
    txn({ investment_transaction_id: 'sell', type: 'sell', quantity: -2, date: '2026-09-05' }),
    txn({ investment_transaction_id: 'buy', quantity: 2, date: '2026-09-01' }),
  ])
  // bought then fully sold inside the window: nothing to write, both applied
  expect(plan.ops).toEqual([])
  expect(plan.applied.sort()).toEqual(['buy', 'sell'])
})

test('a split scales share counts up and cost per share down, keeping total cost', () => {
  const plan = planLedger([lot('a', 10, 100, '2025-01-01')], [
    txn({ investment_transaction_id: 'sp', type: 'transfer', subtype: 'split', quantity: 30, price: 0 }),
  ])
  expect(plan.ops).toEqual([{ kind: 'update_lot', txnId: 'sp', lotId: 'a', count: 40, cost_price: 25 }])
})

test('dividends, fees and cash movements are ignored', () => {
  const plan = planLedger([lot('a', 1, 1, '2025-01-01')], [
    txn({ investment_transaction_id: 'd', type: 'cash', subtype: 'dividend', quantity: 0 }),
    txn({ investment_transaction_id: 'f', type: 'fee', subtype: 'account fee', quantity: 0 }),
  ])
  expect(plan.ops).toEqual([])
  expect(plan.applied).toEqual([])
  expect(plan.skipped).toEqual([])
})

test('a buy with no price is skipped rather than costed at zero', () => {
  const plan = planLedger([], [txn({ investment_transaction_id: 'x', quantity: 1, price: null })])
  expect(plan.ops).toEqual([])
  expect(plan.skipped).toHaveLength(1)
})

test('computeDrift reports Plaid minus tracked shares and ignores rounding noise', () => {
  expect(computeDrift(10, 12)).toBe(2)
  expect(computeDrift(10, 7.5)).toBe(-2.5)
  expect(computeDrift(10, 10.0000001)).toBe(0)
  expect(computeDrift(10, 10.00001)).toBe(0.00001)
  expect(computeDrift(10, null)).toBeNull()
})

test('crypto-sized quantities and prices keep 8 decimals', () => {
  const plan = planLedger([], [txn({ investment_transaction_id: 'c', quantity: 0.00012345, price: 0.00001234 })])
  expect(plan.ops).toEqual([
    { kind: 'add_lot', txnId: 'c', count: 0.00012345, cost_price: 0.00001234, purchase_date: '2026-09-01' },
  ])
})

test('the Deno ports of the ledger math stay identical to src/lib/plaidLedger.ts', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync('src/lib/plaidLedger.ts', 'utf8')
  const expected = src.slice(src.indexOf('export interface LedgerLot')).replace(/^export /gm, '').trim()
  for (const fn of ['plaid-sync', 'plaid-sync-me']) {
    const code = readFileSync(`supabase/functions/${fn}/index.ts`, 'utf8')
    const port = code.slice(code.indexOf('interface LedgerLot {'), code.indexOf('function shiftDate(')).trim()
    expect(port, `${fn} ledger port drifted from src/lib/plaidLedger.ts`).toBe(expected)
  }
})
