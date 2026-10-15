import { test, expect } from 'vitest'
import { oldestFirstAllocation, validateAllocation, allocationOps } from '../lib/plaidLotAllocation'

const lots = [
  { id: 'new', count: 10, cost_price: 20, purchase_date: '2025-06-01' },
  { id: 'old', count: 4, cost_price: 5, purchase_date: '2024-01-01' },
]

test('oldest-first allocation fills the oldest lot before the next', () => {
  expect(oldestFirstAllocation(lots, 6)).toEqual({ old: 4, new: 2 })
})

test('validation requires the allocation to add up exactly and fit each lot', () => {
  expect(validateAllocation(lots, { old: 4, new: 2 }, 6)).toBeNull()
  expect(validateAllocation(lots, { new: 5 }, 6)).toMatch(/1 still to assign/)
  expect(validateAllocation(lots, { new: 7 }, 6)).toMatch(/1 too many/)
  expect(validateAllocation(lots, { old: 5, new: 1 }, 6)).toMatch(/only has 4/)
  expect(validateAllocation(lots, { old: -1, new: 7 }, 6)).toMatch(/zero or more/)
})

test('lots taken to zero are removed and others reduced', () => {
  expect(allocationOps(lots, { old: 4, new: 2 })).toEqual([
    { kind: 'update', lotId: 'new', count: 8 },
    { kind: 'delete', lotId: 'old' },
  ])
})

test('crypto-sized amounts keep 8 decimals', () => {
  const crypto = [{ id: 'a', count: 5.9784, cost_price: 164.884, purchase_date: '2026-09-27' }]
  expect(allocationOps(crypto, { a: 0.00012345 })).toEqual([{ kind: 'update', lotId: 'a', count: 5.97827655 }])
})
