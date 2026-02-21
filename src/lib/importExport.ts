// src/lib/importExport.ts
import { getAllAssets } from './db/assets'
import { getAllTickers } from './db/tickers'

export function serializeForExport(data: { assets: any[]; tickers: any[]; themes: any[] }) {
  return {
    ...data,
    version: '1.0',
    exportDate: new Date().toISOString().split('T')[0],
  }
}

export function parseImport(raw: string) {
  const data = JSON.parse(raw)  // throws on invalid JSON
  if (!data.assets || !Array.isArray(data.assets)) throw new Error('Invalid format: missing assets')
  return data
}

export async function exportData() {
  const [assets, tickers] = await Promise.all([getAllAssets(), getAllTickers()])
  const payload = serializeForExport({ assets, tickers, themes: [] })
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mne-export-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importData(file: File) {
  const raw = await file.text()
  const data = parseImport(raw)
  alert(`Ready to import ${data.assets.length} assets. Bulk import not yet implemented.`)
}
