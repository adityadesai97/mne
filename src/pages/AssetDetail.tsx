// src/pages/AssetDetail.tsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TaxLotList } from '@/components/TaxLotList'
import { getAssetById, deleteAsset, upsertAsset } from '@/lib/db/assets'
import { deleteTransaction, updateTransaction } from '@/lib/db/transactions'
import { endGrant } from '@/lib/db/grants'
import { computeAssetValue, computeCostBasis, computeUnrealizedGain } from '@/lib/portfolio'
import { requestAppConfirm, requestAppPrompt } from '@/lib/appAlerts'

interface EditAssetValues {
  name: string
  ownership: string
  notes: string
  price: string
}

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [asset, setAsset] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editValues, setEditValues] = useState<EditAssetValues>({
    name: '',
    ownership: '',
    notes: '',
    price: '',
  })

  useEffect(() => {
    if (!id) return
    setLoading(true)
    getAssetById(id)
      .then(setAsset)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  async function handleDeleteTransaction(txId: string) {
    const confirmed = await requestAppConfirm({
      title: 'Delete transaction?',
      message: 'Delete this transaction?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await deleteTransaction(txId)
      if (id) setAsset(await getAssetById(id))
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleEditTransaction(txId: string, updates: { count: number; cost_price: number; purchase_date: string; capital_gains_status: string }) {
    try {
      await updateTransaction(txId, updates)
      if (id) setAsset(await getAssetById(id))
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleEndGrant(grantId: string) {
    const date = await requestAppPrompt({
      title: 'End RSU grant',
      message: 'Enter end date (YYYY-MM-DD)',
      defaultValue: new Date().toISOString().split('T')[0],
      placeholder: 'YYYY-MM-DD',
      submitLabel: 'Save',
      cancelLabel: 'Cancel',
    })
    if (!date) return
    try {
      await endGrant(grantId, date)
      if (id) {
        const updated = await getAssetById(id)
        setAsset(updated)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleSaveAsset() {
    try {
      await upsertAsset({
        id: asset.id,
        user_id: asset.user_id,
        name: editValues.name,
        ownership: editValues.ownership,
        notes: editValues.notes || null,
        price: editValues.price ? Number(editValues.price) : null,
        location_id: asset.location_id,
        asset_type: asset.asset_type,
        ticker_id: asset.ticker_id ?? null,
      })
      setEditing(false)
      if (id) setAsset(await getAssetById(id))
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleDeleteAsset() {
    const confirmed = await requestAppConfirm({
      title: 'Delete asset?',
      message: 'Delete this asset and all its transactions? This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await deleteAsset(asset.id)
      navigate('/portfolio')
    } catch (err: any) {
      setError(err.message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full pt-20">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (error || !asset) {
    return (
      <div className="flex items-center justify-center h-full pt-20">
        <p className="text-destructive">{error ?? 'Asset not found.'}</p>
      </div>
    )
  }

  const isStock = asset.asset_type === 'Stock'
  const value = computeAssetValue(asset)
  const gain = computeUnrealizedGain(asset)
  const basis = computeCostBasis(asset)
  const gainPct = basis > 0 ? (gain / basis) * 100 : 0
  const isGain = gain >= 0
  const noPriceData = isStock && asset.ticker?.current_price == null
  const stockTransactionCount = isStock
    ? (asset.stock_subtypes ?? []).reduce(
      (sum: number, st: any) => sum + (st.transactions?.length ?? 0),
      0,
    )
    : 0
  const stockGrantCount = isStock
    ? (asset.stock_subtypes ?? []).reduce(
      (sum: number, st: any) => sum + (st.rsu_grants?.length ?? 0),
      0,
    )
    : 0
  const hasStockActivity = stockTransactionCount + stockGrantCount > 0

  return (
    <div className="flex flex-col min-h-full">
      {/* Sticky header */}
      <header className="sticky top-0 bg-background z-10 flex items-center px-4 py-3 border-b border-border">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-muted-foreground text-sm"
          aria-label="Go back"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          Back
        </button>
        <h1 className="flex-1 text-center font-semibold pr-8 truncate">{asset.name}</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setEditing(true)
              setEditValues({
                name: asset.name,
                ownership: asset.ownership ?? 'Individual',
                notes: asset.notes ?? '',
                price: String(asset.price ?? ''),
              })
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Edit asset"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={handleDeleteAsset}
            className="text-muted-foreground hover:text-destructive transition-colors"
            aria-label="Delete asset"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="px-4 pt-6 pb-24 space-y-4">
        {/* Asset title + subtitle */}
        {editing ? (
          <div className="space-y-2">
            <input
              value={editValues.name}
              onChange={e => setEditValues(v => ({ ...v, name: e.target.value }))}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xl font-bold focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <select
              value={editValues.ownership}
              onChange={e => setEditValues(v => ({ ...v, ownership: e.target.value }))}
              className="bg-card border border-border rounded px-2 py-1 text-sm"
            >
              <option value="Individual">Individual</option>
              <option value="Joint">Joint</option>
            </select>
            {!isStock && (
              <div>
                <label className="text-xs text-muted-foreground">Value ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editValues.price}
                  onChange={e => setEditValues(v => ({ ...v, price: e.target.value }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <textarea
                value={editValues.notes}
                onChange={e => setEditValues(v => ({ ...v, notes: e.target.value }))}
                rows={3}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveAsset}
                className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="flex-1 bg-muted text-muted-foreground rounded-lg py-2 text-sm hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-2xl font-bold">{asset.name}</h2>
              <p className="text-muted-foreground text-sm mt-1">
                {asset.location?.name} · {asset.asset_type}
              </p>
            </div>

            {/* Ownership badge */}
            {asset.ownership && (
              <Badge variant="secondary">{asset.ownership}</Badge>
            )}
          </>
        )}

        {/* Value section */}
        <div>
          {noPriceData ? (
            <>
              <p className="text-3xl font-bold text-muted-foreground">—</p>
              <p className="text-sm text-muted-foreground mt-1">Price pending</p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold">{fmt(value)}</p>
              {isStock && (
                <p className={`text-base mt-1 ${isGain ? 'text-gain' : 'text-loss'}`}>
                  {isGain ? '+' : ''}{fmt(gain)} ({gainPct.toFixed(1)}%)
                </p>
              )}
            </>
          )}
        </div>

        {/* Stock activity */}
        {isStock && hasStockActivity && (
          <section className="border-t border-border pt-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Stock Activity</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {stockTransactionCount} transaction{stockTransactionCount === 1 ? '' : 's'}
                {stockGrantCount > 0 && (
                  <> · {stockGrantCount} RSU grant{stockGrantCount === 1 ? '' : 's'}</>
                )}
              </p>
            </div>
            <TaxLotList
              subtypes={asset.stock_subtypes}
              ticker={asset.ticker}
              onDeleteTransaction={handleDeleteTransaction}
              onEditTransaction={handleEditTransaction}
              onEndGrant={handleEndGrant}
            />
          </section>
        )}

        {/* Notes (read mode only) */}
        {!editing && asset.notes && (
          <div className="border-t border-border pt-4">
            <p className="text-muted-foreground text-sm">{asset.notes}</p>
          </div>
        )}

      </main>
    </div>
  )
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}
