// src/pages/AssetDetail.tsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { TaxLotList } from '@/components/TaxLotList'
import { FixedIncomeLotList } from '@/components/FixedIncomeLotList'
import { getAssetById, deleteAsset, upsertAsset } from '@/lib/db/assets'
import { deleteTransaction, deleteTransactions, updateTransaction } from '@/lib/db/transactions'
import { endGrant, deleteGrant } from '@/lib/db/grants'
import { addFixedIncomeLot, updateFixedIncomeLot, deleteFixedIncomeLot } from '@/lib/db/fixedIncomeLots'
import {
  computeAssetValue, computeCostBasis, computeUnrealizedGain, computeShareCount,
  isTradableFixedIncome, computeFixedIncomeExpectedReturn, computeFixedIncomeLotCount,
} from '@/lib/portfolio'
import { requestAppConfirm, requestAppPrompt } from '@/lib/appAlerts'
import { revealUp } from '@/lib/motionPresets'
import { formatDateMDY } from '@/lib/dates'

interface EditAssetValues {
  name: string
  ownership: string
  notes: string
  price: string
  fixedIncomeSubtype: string
  interestRate: string
  maturityDate: string
  faceValue: string
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
    fixedIncomeSubtype: '',
    interestRate: '',
    maturityDate: '',
    faceValue: '',
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

  async function handleDeleteGrant(grantId: string, transactionIds: string[]) {
    const txCount = transactionIds.length
    const confirmed = await requestAppConfirm({
      title: 'Delete RSU grant?',
      message: txCount > 0
        ? `Delete this grant and its ${txCount} vesting transaction${txCount === 1 ? '' : 's'}? This cannot be undone.`
        : 'Delete this grant? This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await deleteTransactions(transactionIds)
      await deleteGrant(grantId)
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

  async function handleAddLot(values: { count: number; cost_price: number; purchase_date: string }) {
    try {
      await addFixedIncomeLot(asset.id, values)
      if (id) setAsset(await getAssetById(id))
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleEditLot(lotId: string, values: { count: number; cost_price: number; purchase_date: string }) {
    try {
      await updateFixedIncomeLot(lotId, values)
      if (id) setAsset(await getAssetById(id))
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleDeleteLot(lotId: string) {
    const confirmed = await requestAppConfirm({
      title: 'Delete lot?',
      message: 'Delete this lot?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await deleteFixedIncomeLot(lotId)
      if (id) setAsset(await getAssetById(id))
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleSaveAsset() {
    try {
      const isFixedIncome = asset.asset_type === 'Fixed Income'
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
        fixed_income_subtype: isFixedIncome ? (editValues.fixedIncomeSubtype || null) : asset.fixed_income_subtype ?? null,
        interest_rate: isFixedIncome ? (editValues.interestRate ? Number(editValues.interestRate) : null) : asset.interest_rate ?? null,
        maturity_date: isFixedIncome ? (editValues.maturityDate || null) : asset.maturity_date ?? null,
        face_value: isFixedIncome ? (editValues.faceValue ? Number(editValues.faceValue) : null) : asset.face_value ?? null,
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
      <div className="flex flex-col min-h-full">
        <header className="sticky top-0 bg-background z-10 flex items-center px-4 py-3 border-b border-border">
          <Skeleton className="h-4 w-14" />
        </header>
        <main className="px-4 pt-6 pb-24 space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </main>
      </div>
    )
  }

  if (error || !asset) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center h-full pt-20"
      >
        <p className="text-destructive">{error ?? 'Asset not found.'}</p>
      </motion.div>
    )
  }

  const isStock = asset.asset_type === 'Stock'
  const isFixedIncome = asset.asset_type === 'Fixed Income'
  const isTradable = isTradableFixedIncome(asset)
  const fixedIncomeLots = asset.fixed_income_lots ?? []
  const lotUnits = isTradable ? computeFixedIncomeLotCount(asset) : 0
  const expectedReturn = isTradable ? computeFixedIncomeExpectedReturn(asset) : null
  const value = computeAssetValue(asset)
  const shareCount = isStock ? computeShareCount(asset) : 0
  const gain = computeUnrealizedGain(asset)
  const basis = computeCostBasis(asset)
  const gainPct = basis > 0 ? (gain / basis) * 100 : 0
  const isGain = gain >= 0
  const noPriceData = isStock && asset.ticker?.current_price == null
  // Live per-share quote, colored the same way as the Watchlist row: green/red
  // against the ticker's last-refreshed previous close, neutral until one exists.
  const tickerPrice = Number(asset.ticker?.current_price ?? 0)
  const tickerPreviousClose = asset.ticker?.previous_close != null ? Number(asset.ticker.previous_close) : null
  const tickerPriceChangeClass = tickerPreviousClose == null
    ? ''
    : tickerPrice > tickerPreviousClose
      ? 'text-gain'
      : tickerPrice < tickerPreviousClose
        ? 'text-loss'
        : ''
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
      <header className="sticky top-0 bg-background/85 backdrop-blur-md z-10 flex items-center px-4 py-3 border-b border-border">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm transition-colors"
          aria-label="Go back"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          Back
        </button>
        <h1 className="flex-1 text-center font-semibold pr-8 truncate">{asset.name}</h1>
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.85 }}
            onClick={() => {
              setEditing(true)
              setEditValues({
                name: asset.name,
                ownership: asset.ownership ?? 'Individual',
                notes: asset.notes ?? '',
                price: String(asset.price ?? ''),
                fixedIncomeSubtype: asset.fixed_income_subtype ?? 'CD',
                interestRate: asset.interest_rate != null ? String(asset.interest_rate) : '',
                maturityDate: asset.maturity_date ?? '',
                faceValue: asset.face_value != null ? String(asset.face_value) : '',
              })
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Edit asset"
          >
            <Pencil size={16} />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.85 }}
            onClick={handleDeleteAsset}
            className="text-muted-foreground hover:text-destructive transition-colors"
            aria-label="Delete asset"
          >
            <Trash2 size={16} />
          </motion.button>
        </div>
      </header>

      {/* Main content */}
      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        className="px-4 pt-6 pb-24 space-y-3"
      >
        {/* Hero card: title/type/ownership + value. AnimatePresence here is
            a single, standalone one (not nested inside another) — safe per
            the pattern used everywhere else in the app. */}
        <motion.div {...revealUp(0)} className="bg-card shadow-card rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className={`absolute -top-8 left-1/4 w-64 h-32 rounded-full blur-3xl ${isStock ? (isGain ? 'bg-gain/[0.12]' : 'bg-loss/[0.12]') : 'bg-brand-subtle'}`} />
          </div>
          <AnimatePresence mode="wait">
            {editing ? (
              <motion.div
                key="edit"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="relative space-y-2"
              >
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
                {!isStock && !isTradable && (
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
                {isTradable && (
                  <p className="text-xs text-muted-foreground">
                    Value is computed from lots below — add or edit a lot to change it.
                  </p>
                )}
                {isFixedIncome && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Subtype</label>
                      <select
                        value={editValues.fixedIncomeSubtype}
                        onChange={e => setEditValues(v => ({ ...v, fixedIncomeSubtype: e.target.value }))}
                        className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="CD">CD</option>
                        <option value="Deposit">Deposit</option>
                        <option value="Bond">Bond</option>
                        <option value="T-Bill">T-Bill</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Rate (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editValues.interestRate}
                        onChange={e => setEditValues(v => ({ ...v, interestRate: e.target.value }))}
                        className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Maturity</label>
                      <input
                        type="date"
                        value={editValues.maturityDate}
                        onChange={e => setEditValues(v => ({ ...v, maturityDate: e.target.value }))}
                        className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>
                )}
                {isFixedIncome && (editValues.fixedIncomeSubtype === 'T-Bill' || editValues.fixedIncomeSubtype === 'Bond') && (
                  <div>
                    <label className="text-xs text-muted-foreground">Face Value ($) — paid out at maturity; Value above is what was paid for it</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editValues.faceValue}
                      onChange={e => setEditValues(v => ({ ...v, faceValue: e.target.value }))}
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
              </motion.div>
            ) : (
              <motion.div
                key="view"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="relative"
              >
                <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] mb-2 font-medium">
                  {asset.location?.name} · {asset.asset_type}{isFixedIncome && asset.fixed_income_subtype ? ` (${asset.fixed_income_subtype})` : ''}
                </p>
                <h2 className="font-syne text-2xl font-bold tracking-tight">{asset.name}</h2>
                {isStock && asset.ticker && !noPriceData && (
                  <p className="text-sm mt-1 flex items-center gap-1.5">
                    <span className="text-muted-foreground">{asset.ticker.symbol}</span>
                    <span className={`font-medium tabular-nums ${tickerPriceChangeClass}`}>${tickerPrice.toFixed(2)}</span>
                  </p>
                )}
                {(asset.ownership || (isFixedIncome && (asset.interest_rate != null || asset.maturity_date || asset.face_value != null))) && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {asset.ownership && <Badge variant="secondary">{asset.ownership}</Badge>}
                    {isFixedIncome && asset.interest_rate != null && (
                      <Badge variant="secondary">{Number(asset.interest_rate).toFixed(2)}% rate</Badge>
                    )}
                    {isFixedIncome && asset.maturity_date && (
                      <Badge variant="secondary">Matures {formatDateMDY(asset.maturity_date)}</Badge>
                    )}
                    {isFixedIncome && asset.face_value != null && (
                      <Badge variant="secondary">Face {fmt(Number(asset.face_value))}</Badge>
                    )}
                  </div>
                )}

                <div className={asset.ownership ? 'mt-4' : 'mt-3'}>
                  {noPriceData ? (
                    <>
                      <p className="text-3xl font-bold text-muted-foreground">—</p>
                      <p className="text-sm text-muted-foreground mt-1">Price pending</p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold tabular-nums font-syne">
                        {fmt(value)}
                        {isStock && (
                          <span className="text-base text-muted-foreground font-normal ml-2">{fmtShares(shareCount)} shares</span>
                        )}
                        {isTradable && (
                          <span className="text-base text-muted-foreground font-normal ml-2">{fmtShares(lotUnits)} units</span>
                        )}
                      </p>
                      {isStock && (
                        <p className={`text-base mt-1 tabular-nums ${isGain ? 'text-gain' : 'text-loss'}`}>
                          {isGain ? '+' : ''}{fmt(gain)} ({gainPct.toFixed(1)}%)
                        </p>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Stock activity */}
        {isStock && hasStockActivity && (
          <motion.div {...revealUp(0.06)} className="bg-card shadow-card rounded-2xl p-5">
            <div className="mb-3">
              <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] font-medium">Stock Activity</p>
              <p className="text-xs text-muted-foreground mt-1">
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
              onDeleteGrant={handleDeleteGrant}
            />
          </motion.div>
        )}

        {/* Fixed Income lots (Bond/T-Bill) — units bought over time, mirroring stock tax lots */}
        {isTradable && (
          <motion.div {...revealUp(0.06)} className="bg-card shadow-card rounded-2xl p-5">
            <div className="mb-3">
              <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] font-medium">Lots</p>
              <p className="text-xs text-muted-foreground mt-1">
                {fixedIncomeLots.length} lot{fixedIncomeLots.length === 1 ? '' : 's'} · {fmtShares(lotUnits)} units total
              </p>
            </div>
            <FixedIncomeLotList
              lots={fixedIncomeLots}
              faceValue={asset.face_value ?? null}
              onAddLot={handleAddLot}
              onEditLot={handleEditLot}
              onDeleteLot={handleDeleteLot}
            />
          </motion.div>
        )}

        {/* Expected pretax return if held to maturity — a projection (coupon
            income + discount/premium to face value), not a mark-to-market
            gain, so it lives in its own card rather than next to the hero
            value the way a stock's unrealized gain does. */}
        {expectedReturn && (
          <motion.div {...revealUp(0.08)} className="bg-card shadow-card rounded-2xl p-5">
            <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] mb-3 font-medium">Expected Return to Maturity</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Metric label="Cost basis" value={fmt(expectedReturn.costBasis)} />
              <Metric label="Face value at maturity" value={fmt(expectedReturn.faceValueTotal)} />
              {asset.fixed_income_subtype === 'Bond' && (
                <Metric label="Coupon income" value={fmt(expectedReturn.interestIncome)} />
              )}
              <Metric
                label={asset.fixed_income_subtype === 'Bond' ? 'Price gain/loss' : 'Discount captured'}
                value={`${expectedReturn.capitalGain >= 0 ? '+' : ''}${fmt(expectedReturn.capitalGain)}`}
                className={expectedReturn.capitalGain >= 0 ? 'text-gain' : 'text-loss'}
              />
              <Metric
                label="Total expected return"
                value={`${expectedReturn.totalExpectedReturn >= 0 ? '+' : ''}${fmt(expectedReturn.totalExpectedReturn)}${expectedReturn.expectedReturnPct != null ? ` (${expectedReturn.expectedReturnPct.toFixed(1)}%)` : ''}`}
                className={expectedReturn.totalExpectedReturn >= 0 ? 'text-gain' : 'text-loss'}
              />
              {expectedReturn.annualizedYieldPct != null && (
                <Metric label="Annualized yield" value={`${expectedReturn.annualizedYieldPct.toFixed(2)}%`} />
              )}
            </div>
          </motion.div>
        )}

        {/* Notes (read mode only) */}
        {!editing && asset.notes && (
          <motion.div {...revealUp(0.1)} className="bg-card shadow-card rounded-2xl p-5">
            <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] mb-2 font-medium">Notes</p>
            <p className="text-foreground/90 text-sm whitespace-pre-wrap">{asset.notes}</p>
          </motion.div>
        )}

      </motion.main>
    </div>
  )
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}

function fmtShares(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}

function Metric({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-medium tabular-nums mt-0.5 ${className}`}>{value}</p>
    </div>
  )
}
