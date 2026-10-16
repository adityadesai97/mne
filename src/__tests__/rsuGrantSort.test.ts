import { expect, test } from 'vitest'
import { sortRsuGrants } from '@/components/lots/lotMath'

test('RSU grants sort oldest to newest, tie-broken by vest_start then id', () => {
  const grants = [
    { id: 'd', grant_date: '2023-01-01', vest_start: '2023-06-01' },
    { id: 'c', grant_date: '2022-01-01', vest_start: '2022-02-01' },
    { id: 'b', grant_date: '2022-01-01', vest_start: '2022-01-01' },
    { id: 'a', grant_date: '2022-01-01', vest_start: '2022-01-01' },
    { id: 'e', grant_date: '2021-05-05', vest_start: '2021-05-05' },
  ]
  const copy = [...grants]
  expect(sortRsuGrants(grants).map(g => g.id)).toEqual(['e', 'a', 'b', 'c', 'd'])
  expect(grants).toEqual(copy)
})
