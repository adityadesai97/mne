import { test, expect } from 'vitest'
import { computeEsopPosition, esopIntrinsicValue } from '@/lib/esop'
import { computeAssetValue, computeSubtypeValue, computeOptionValue } from '@/lib/portfolio'
import { validateExercise } from '@/lib/db/esop'

const grant = (over: any = {}) => ({
  grant_date: '2024-01-01',
  total_options: 1200,
  strike_price: 10,
  vest_start: '2024-01-01',
  vest_end: '2028-01-01',
  cliff_date: '2025-01-01',
  vesting_frequency: 'monthly',
  expiry_date: '2034-01-01',
  esop_exercises: [],
  ...over,
})

const asset = (grants: any[], price = 25, transactions: any[] = []) => ({
  asset_type: 'Stock',
  price: null,
  ticker: { current_price: price },
  stock_subtypes: [
    { subtype: 'Market', transactions, rsu_grants: [], esop_grants: [] },
    { subtype: 'ESOP', transactions: [], rsu_grants: [], esop_grants: grants },
  ],
})

test('nothing is vested before the cliff, the cliff lump after it', () => {
  expect(computeEsopPosition(grant(), new Date('2024-12-31')).vested).toBe(0)
  expect(computeEsopPosition(grant(), new Date('2025-01-01')).vested).toBe(300)
})

test('fully vested at the end of the schedule', () => {
  expect(computeEsopPosition(grant(), new Date('2028-06-01')).vested).toBe(1200)
})

test('exercised options come off the exercisable count', () => {
  const g = grant({ esop_exercises: [{ count: 100 }] })
  const p = computeEsopPosition(g, new Date('2025-01-01'))
  expect(p).toMatchObject({ vested: 300, exercised: 100, exercisable: 200, expired: false })
})

test('expired options are not exercisable', () => {
  const g = grant({ expiry_date: '2026-01-01' })
  expect(computeEsopPosition(g, new Date('2027-01-01')).exercisable).toBe(0)
})

test('options are worth their spread over the strike, never negative', () => {
  const g = grant()
  const asOf = new Date('2025-01-01')
  expect(esopIntrinsicValue([g], 25, asOf)).toBe(300 * 15)
  expect(esopIntrinsicValue([g], 8, asOf)).toBe(0)
})

test('asset value adds vested intrinsic value to the shares', () => {
  const a = asset([grant({ vest_end: '2000-01-01', vest_start: '1999-01-01', cliff_date: null, grant_date: '1999-01-01', total_options: 100 })], 25, [
    { count: 10, cost_price: 5 },
  ])
  expect(computeOptionValue(a as any)).toBe(100 * 15)
  expect(computeAssetValue(a as any)).toBe(10 * 25 + 100 * 15)
})

test('the subtype filter includes options only when ESOP is active', () => {
  const a = asset([grant({ vest_end: '2000-01-01', vest_start: '1999-01-01', cliff_date: null, grant_date: '1999-01-01', total_options: 100 })], 25, [
    { count: 10, cost_price: 5 },
  ])
  expect(computeSubtypeValue(a as any, new Set(['Market']))).toBe(250)
  expect(computeSubtypeValue(a as any, new Set(['ESOP']))).toBe(1500)
  expect(computeSubtypeValue(a as any, new Set(['Market', 'ESOP']))).toBe(computeAssetValue(a as any))
})

test('no live price means no option value', () => {
  const a = asset([grant()], 25)
  ;(a.ticker as any).current_price = null
  expect(computeAssetValue(a as any)).toBe(0)
})

test('exercise validation', () => {
  const g = grant()
  const ok = { count: 100, exerciseDate: '2025-06-01', costPrice: 20 }
  expect(validateExercise(g, ok)).toBeNull()
  expect(validateExercise(g, { ...ok, count: 0 })).toMatch(/positive/)
  expect(validateExercise(g, { ...ok, count: 100000 })).toMatch(/Only/)
  expect(validateExercise(g, { ...ok, exerciseDate: '2024-06-01' })).toMatch(/Only 0/)
  expect(validateExercise(grant({ expiry_date: '2025-02-01' }), ok)).toMatch(/expired/)
})
