// src/__tests__/importExport.test.ts
import { serializeForExport, parseImport } from '../lib/importExport'

test('serializes assets to export format', () => {
  const data = { assets: [{ id: '1', name: 'Cash', asset_type: 'Cash' }], tickers: [], themes: [] }
  const result = serializeForExport(data)
  expect(result.assets).toHaveLength(1)
  expect(result.version).toBe('1.0')
  expect(result.exportDate).toBeDefined()
})

test('parses valid import JSON', () => {
  const raw = JSON.stringify({ assets: [], tickers: [], themes: [], version: '1.0' })
  const result = parseImport(raw)
  expect(result.assets).toEqual([])
})

test('throws on invalid import JSON', () => {
  expect(() => parseImport('not json')).toThrow()
})

test('throws on missing assets array', () => {
  expect(() => parseImport('{"tickers":[]}')).toThrow('Invalid format')
})
