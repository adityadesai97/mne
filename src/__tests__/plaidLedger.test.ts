import { test, expect } from 'vitest'
import { planLedger, computeDrift, type LedgerLot, type PlaidInvestmentTxn } from '../lib/plaidLedger'

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

test('a sell consumes the oldest lot first and trims a partially sold lot', () => {
  const lots = [lot('new', 10, 20, '2025-06-01'), lot('old', 4, 5, '2024-01-01')]
  const plan = planLedger(lots, [txn({ investment_transaction_id: 's', type: 'sell', quantity: -6 })])
  expect(plan.ops).toContainEqual({ kind: 'delete_lot', txnId: 's', lotId: 'old' })
  expect(plan.ops).toContainEqual({ kind: 'update_lot', txnId: 's', lotId: 'new', count: 8 })
  expect(plan.skipped).toEqual([])
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
    txn({ investment_transaction_id: 'out', type: 'transfer', subtype: 'transfer', quantity: -12, date: '2026-09-02' }),
  ])
  expect(plan.skipped).toEqual([])
  // 10 + 5 - 12 = 3 left: the oldest 10-share lot is gone, the 5-share lot trimmed to 3
  expect(plan.ops).toContainEqual({ kind: 'delete_lot', txnId: 'out', lotId: 'a' })
  expect(plan.ops).toContainEqual({ kind: 'add_lot', txnId: 'in', count: 3, cost_price: 11, purchase_date: '2026-09-01' })
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
