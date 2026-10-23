// src/pages/AssetDetail.tsx
import { useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { refreshPricesOncePerLoad } from '@/lib/priceRefresh'
import { useParams, useNavigate } from 'react-router-dom'
import { TaxLotList } from '@/components/TaxLotList'
import { FixedIncomeLotList } from '@/components/FixedIncomeLotList'
import { AddLotForm } from '@/components/AddLotForm'
import { AssetLogo } from '@/components/AssetLogo'
import { AssetTags } from '@/components/AssetTags'
import { addMarketLot } from '@/lib/db/marketLots'
import { getAssetById, deleteAsset, upsertAsset } from '@/lib/db/assets'
import { deleteTransaction, deleteTransactions, updateTransaction } from '@/lib/db/transactions'
import { endGrant, deleteGrant } from '@/lib/db/grants'
import { addEsopGrant, exerciseOptions, endEsopGrant, deleteEsopGrant, type ExerciseInput, type NewEsopGrant } from '@/lib/db/esop'
import { AddEsopGrantForm } from '@/components/EsopGrantList'
import { AddOptionContractForm, OptionContractList } from '@/components/OptionContractList'
import { addOptionContract, closeOptionContract, deleteOptionContract, type NewOptionContract } from '@/lib/db/optionContracts'
import { addFixedIncomeLot, updateFixedIncomeLot, deleteFixedIncomeLot } from '@/lib/db/fixedIncomeLots'
import {
  computeAssetValue, computeCostBasis, computeUnrealizedGain, computeShareCount, computeDailyChange, getLivePrice,
  isTradableFixedIncome, computeFixedIncomeExpectedReturn, computeFixedIncomeLotCount, isTickerAsset, computeOptionValue, computeContractValue,
} from '@/lib/portfolio'
import { requestAppConfirm, requestAppPrompt } from '@/lib/appAlerts'
import { Delta, PageBody, PageHead, Stat } from '@/components/mne'
import { AskChip } from '@/components/AskChip'
import '@/styles/portfolio.css'
import { formatDateMDY } from '@/lib/dates'
import { useHideValues, hiddenValueClass } from '@/hooks/useHideValues'
import { config } from '@/store/config'

interface EditAssetValues {
  name: string
  ownership: string
  notes: string
  price: string
  fixedIncomeSubtype: string
  interestRate: string
  maturityDate: string
  faceValue: string
  manualPrice: string
}

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [hideValues] = useHideValues()
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
    manualPrice: '',
  })

  useEffect(() => {
    if (!id) return
    setLoading(true)
    refreshPricesOncePerLoad()
      .then(() => getAssetById(id))
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

  async function reloadAsset() {
    if (id) setAsset(await getAssetById(id))
  }

  async function handleAddEsopGrant(grant: NewEsopGrant) {
    await addEsopGrant(asset.id, grant)
    await reloadAsset()
  }

  async function handleExerciseOptions(grant: any, input: ExerciseInput) {
    await exerciseOptions(asset.id, grant, input)
    await reloadAsset()
  }

  async function handleEndEsopGrant(grantId: string) {
    const date = await requestAppPrompt({
      title: 'End option grant',
      message: 'Enter end date (YYYY-MM-DD)',
      defaultValue: new Date().toISOString().split('T')[0],
      placeholder: 'YYYY-MM-DD',
      submitLabel: 'Save',
      cancelLabel: 'Cancel',
    })
    if (!date) return
    try {
      await endEsopGrant(grantId, date)
      await reloadAsset()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleDeleteEsopGrant(grantId: string) {
    const confirmed = await requestAppConfirm({
      title: 'Delete option grant?',
      message: 'Delete this grant and its exercise history? Shares already created by exercises are kept. This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await deleteEsopGrant(grantId)
      await reloadAsset()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleAddOptionContract(contract: NewOptionContract) {
    await addOptionContract(asset.id, contract)
    await reloadAsset()
  }

  async function handleCloseOptionContract(contractId: string) {
    const premium = await requestAppPrompt({
      title: 'Close option contract',
      message: 'Premium received per share when it was sold (0 if it expired worthless)',
      defaultValue: '0',
      placeholder: '0.00',
      submitLabel: 'Close',
      cancelLabel: 'Cancel',
    })
    if (premium == null || premium === '') return
    try {
      await closeOptionContract(contractId, new Date().toISOString().split('T')[0], parseFloat(premium))
      await reloadAsset()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleDeleteOptionContract(contractId: string) {
    const confirmed = await requestAppConfirm({
      title: 'Delete contract?',
      message: 'Delete this option contract? This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await deleteOptionContract(contractId)
      await reloadAsset()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleAddMarketLot(values: { count: number; cost_price: number; purchase_date: string }) {
    try {
      await addMarketLot(asset.id, values)
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
        ...(isPrivate && editValues.manualPrice !== '' && Number(editValues.manualPrice) !== Number(asset.manual_price)
          ? { manual_price: Number(editValues.manualPrice), manual_price_date: new Date().toISOString().split('T')[0] }
          : {}),
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
      <PageBody>
        <div aria-busy="true" aria-label="Loading" className="contents">
          <div className="mne-skel is-pill" style={{ height: 32, width: 110 }} />
          <section className="mne-card" style={{ display: 'grid', gap: 12 }}>
            <div className="mne-skel" style={{ height: 34, width: '45%' }} />
            <div className="mne-skel is-pill" style={{ height: 14, width: '30%' }} />
            <div className="mne-skel" style={{ height: 64, marginTop: 8 }} />
          </section>
          <div className="mne-skel" style={{ height: 160, borderRadius: 24 }} />
        </div>
      </PageBody>
    )
  }

  if (error || !asset) {
    return (
      <PageBody>
        <section className="mne-card">
          <div className="mne-empty is-error">
            <span className="ico">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.1" /></svg>
            </span>
            <h3>Something went wrong</h3>
            <p>{error ?? 'Asset not found.'}</p>
            <button type="button" className="mne-btn is-ghost" onClick={() => navigate('/portfolio')}>Back to portfolio</button>
          </div>
        </section>
      </PageBody>
    )
  }

  const lotLayout = config.lotView
  const isStock = isTickerAsset(asset)
  const isCrypto = asset.asset_type === 'Crypto'
  const isPrivate = isStock && !asset.ticker_id
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
  const noPriceData = isStock && getLivePrice(asset) == null
  const tickerPrice = getLivePrice(asset) ?? 0
  const todayPct = isStock ? (computeDailyChange(asset)?.percentChange ?? null) : null
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
  const esopGrantCount = isStock
    ? (asset.stock_subtypes ?? []).reduce(
      (sum: number, st: any) => sum + (st.esop_grants?.length ?? 0),
      0,
    )
    : 0
  const optionValue = isStock ? computeOptionValue(asset) : 0
  const optionContracts = isStock ? (asset.option_contracts ?? []) : []
  const contractValue = isStock ? computeContractValue(asset) : 0
  const hasStockActivity = stockTransactionCount + stockGrantCount + esopGrantCount > 0

  const subtitle = [
    isStock && asset.ticker?.symbol ? asset.ticker.symbol : null,
    isPrivate ? 'Private company' : null,
    asset.location?.name,
    asset.asset_type + (isFixedIncome && asset.fixed_income_subtype ? ` (${asset.fixed_income_subtype})` : ''),
  ].filter(Boolean).join(' · ')

  function startEditing() {
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
      manualPrice: asset.manual_price != null ? String(asset.manual_price) : '',
    })
  }

  return (
    <PageBody>
      <PageHead title="Asset detail" />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="mne-btn is-quiet is-sm" aria-label="Go back" onClick={() => navigate(-1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          Portfolio
        </button>
        <AskChip className="ml-auto" prompt={`Tell me about ${asset.ticker?.symbol ?? asset.name}`} />
      </div>

      <section className="mne-card pf-fade">
        {editing ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="mne-field">
              <label htmlFor="asset-name">Name</label>
              <input id="asset-name" className="mne-input" value={editValues.name}
                onChange={e => setEditValues(v => ({ ...v, name: e.target.value }))} />
            </div>
            <div className="mne-field">
              <label htmlFor="asset-ownership">Ownership</label>
              <div className="mne-select-wrap">
                <select id="asset-ownership" className="mne-input" value={editValues.ownership}
                  onChange={e => setEditValues(v => ({ ...v, ownership: e.target.value }))}>
                  <option value="Individual">Individual</option>
                  <option value="Joint">Joint</option>
                </select>
              </div>
            </div>
            {!isStock && !isTradable && (
              <div className="mne-field">
                <label htmlFor="asset-price">Value ($)</label>
                <input id="asset-price" className="mne-input" type="number" step="0.01" value={editValues.price}
                  onChange={e => setEditValues(v => ({ ...v, price: e.target.value }))} />
              </div>
            )}
            {isPrivate && (
              <div className="mne-field">
                <label htmlFor="asset-manual-price">Price per share ($)</label>
                <input id="asset-manual-price" className="mne-input" type="number" step="any" min="0" value={editValues.manualPrice}
                  onChange={e => setEditValues(v => ({ ...v, manualPrice: e.target.value }))} />
                <span className="mne-help">A private company has no live quote: enter its latest 409A or last-round value per share.</span>
              </div>
            )}
            {isTradable && (
              <p className="mne-help">Value is computed from lots below — add or edit a lot to change it.</p>
            )}
            {isFixedIncome && (
              <div className="pf-lot-edit-grid">
                <div className="mne-field">
                  <label htmlFor="asset-fi-subtype">Subtype</label>
                  <div className="mne-select-wrap">
                    <select id="asset-fi-subtype" className="mne-input" value={editValues.fixedIncomeSubtype}
                      onChange={e => setEditValues(v => ({ ...v, fixedIncomeSubtype: e.target.value }))}>
                      <option value="CD">CD</option>
                      <option value="Deposit">Deposit</option>
                      <option value="Bond">Bond</option>
                      <option value="T-Bill">T-Bill</option>
                    </select>
                  </div>
                </div>
                <div className="mne-field">
                  <label htmlFor="asset-fi-rate">Rate (%)</label>
                  <input id="asset-fi-rate" className="mne-input" type="number" step="0.01" value={editValues.interestRate}
                    onChange={e => setEditValues(v => ({ ...v, interestRate: e.target.value }))} />
                </div>
                <div className="mne-field">
                  <label htmlFor="asset-fi-maturity">Maturity</label>
                  <input id="asset-fi-maturity" className="mne-input" type="date" value={editValues.maturityDate}
                    onChange={e => setEditValues(v => ({ ...v, maturityDate: e.target.value }))} />
                </div>
              </div>
            )}
            {isFixedIncome && (editValues.fixedIncomeSubtype === 'T-Bill' || editValues.fixedIncomeSubtype === 'Bond') && (
              <div className="mne-field">
                <label htmlFor="asset-fi-face">Face Value ($)</label>
                <input id="asset-fi-face" className="mne-input" type="number" step="0.01" value={editValues.faceValue}
                  onChange={e => setEditValues(v => ({ ...v, faceValue: e.target.value }))} />
                <span className="mne-help">Paid out at maturity; Value above is what was paid for it.</span>
              </div>
            )}
            <div className="mne-field">
              <label htmlFor="asset-notes">Notes</label>
              <textarea id="asset-notes" className="mne-input" rows={3} value={editValues.notes}
                onChange={e => setEditValues(v => ({ ...v, notes: e.target.value }))} />
            </div>
            <div className="pf-actions">
              <button type="button" className="mne-btn" onClick={handleSaveAsset}>Save</button>
              <button type="button" className="mne-btn is-ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div className="pf-detail-head">
                <AssetLogo asset={asset} size="lg" />
                <div style={{ minWidth: 0 }}>
                  <div className="pf-detail-title">
                    <h2 className="mne-section-title" style={{ fontSize: 28, lineHeight: '34px' }}>{asset.name}</h2>
                    <AssetTags asset={asset} />
                  </div>
                  <div className="mne-muted">{subtitle}</div>
                </div>
              </div>
              <div className="pf-actions" style={{ alignSelf: 'flex-start' }}>
                <button type="button" className="pf-iconbtn" onClick={startEditing} aria-label="Edit asset" title="Edit asset"><Pencil size={16} aria-hidden="true" /></button>
                <button type="button" className="pf-iconbtn is-danger" onClick={handleDeleteAsset} aria-label="Delete asset" title="Delete asset"><Trash2 size={16} aria-hidden="true" /></button>
              </div>
            </div>

            {isFixedIncome && (asset.interest_rate != null || asset.maturity_date || asset.face_value != null) && (
              <div className="pf-card-chips" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
                {isFixedIncome && asset.interest_rate != null && (
                  <span className="mne-chip is-outline">{Number(asset.interest_rate).toFixed(2)}% rate</span>
                )}
                {isFixedIncome && asset.maturity_date && (
                  <span className="mne-chip is-outline">Matures {formatDateMDY(asset.maturity_date)}</span>
                )}
                {isFixedIncome && asset.face_value != null && (
                  <span className={`mne-chip is-outline ${hiddenValueClass(hideValues)}`}>Face {fmt(Number(asset.face_value))}</span>
                )}
              </div>
            )}

            <div className="mne-stats pf-detail-stats" style={{ marginTop: 20 }}>
              {noPriceData ? (
                <Stat label="Value" value={<span className="mne-muted">—</span>} sub="Price pending" subClassName="mne-muted" />
              ) : (
                <Stat
                  label="Value"
                  value={<span className={hiddenValueClass(hideValues, '', 'lg')}>{fmt(value)}</span>}
                  sub={isStock && todayPct != null ? <Delta value={todayPct} suffix={isCrypto ? 'in 24h' : 'today'} /> : undefined}
                />
              )}
              {isStock && !noPriceData && (
                <Stat
                  className="max-sm:hidden"
                  label="Price"
                  value={<span className={hiddenValueClass(hideValues)}>${tickerPrice.toFixed(tickerPrice > 0 && tickerPrice < 1 ? 6 : 2)}</span>}
                  sub={isPrivate ? (asset.manual_price_date ? `manual · as of ${formatDateMDY(asset.manual_price_date)}` : 'manual valuation') : undefined}
                  subClassName="mne-muted"
                />
              )}
              {isStock && (
                <Stat label={isCrypto ? 'Units' : 'Shares'} value={fmtShares(shareCount, isCrypto ? 8 : 2)} />
              )}
              {isTradable && <Stat label="Units" value={fmtShares(lotUnits)} />}
              {isStock && optionValue > 0 && (
                <Stat label="Options (vested)" value={<span className={hiddenValueClass(hideValues)}>{fmt(optionValue)}</span>} />
              )}
              {isStock && contractValue > 0 && (
                <Stat label="Calls / puts" value={<span className={hiddenValueClass(hideValues)}>{fmt(contractValue)}</span>} sub="intrinsic" subClassName="mne-muted" />
              )}
              {(isStock || isTradable) && basis > 0 && (
                <Stat label="Cost basis" value={<span className={hiddenValueClass(hideValues)}>{fmt(basis)}</span>} />
              )}
              {isStock && !noPriceData && basis > 0 && (
                <Stat
                  label="Unrealized gain"
                  value={<span className={hiddenValueClass(hideValues)}>{fmt(gain)}</span>}
                  sub={<Delta value={gainPct} digits={1} />}
                />
              )}
            </div>
          </>
        )}
      </section>

      {isStock && (
        <section className="mne-card pf-fade">
          <h3 className="mne-card-title" style={{ marginBottom: 4 }}>Tax lots</h3>
          <p className="mne-help max-sm:hidden" style={{ marginBottom: 12 }}>
            {stockTransactionCount} transaction{stockTransactionCount === 1 ? '' : 's'}
            {stockGrantCount > 0 && <> · {stockGrantCount} RSU grant{stockGrantCount === 1 ? '' : 's'}</>}
            {esopGrantCount > 0 && <> · {esopGrantCount} option grant{esopGrantCount === 1 ? '' : 's'}</>}
          </p>
          {hasStockActivity && <TaxLotList
            subtypes={asset.stock_subtypes}
            ticker={asset.ticker}
            layout={lotLayout}
            onDeleteTransaction={handleDeleteTransaction}
            onEditTransaction={handleEditTransaction}
            onEndGrant={handleEndGrant}
            onDeleteGrant={handleDeleteGrant}
            onExerciseOptions={handleExerciseOptions}
            onEndEsopGrant={handleEndEsopGrant}
            onDeleteEsopGrant={handleDeleteEsopGrant}
          />}
          <div style={{ marginTop: hasStockActivity ? 12 : 0 }}>
            <AddLotForm isCrypto={isCrypto} onAddLot={handleAddMarketLot} />
          </div>
          {!isCrypto && (
            <div style={{ marginTop: 12 }}>
              <AddEsopGrantForm onAdd={handleAddEsopGrant} />
            </div>
          )}
        </section>
      )}

      {isStock && !isCrypto && !isPrivate && (
        <section className="mne-card pf-fade">
          <h3 className="mne-card-title" style={{ marginBottom: 4 }}>Calls &amp; puts</h3>
          <p className="mne-help" style={{ marginBottom: 12 }}>
            Exchange-traded options on {asset.ticker?.symbol ?? 'this stock'}. Valued at intrinsic value only.
          </p>
          {optionContracts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <OptionContractList
                contracts={optionContracts}
                price={getLivePrice(asset)}
                onClose={handleCloseOptionContract}
                onDelete={handleDeleteOptionContract}
              />
            </div>
          )}
          <AddOptionContractForm onAdd={handleAddOptionContract} />
        </section>
      )}

      {isTradable && (
        <section className="mne-card pf-fade">
          <h3 className="mne-card-title" style={{ marginBottom: 4 }}>Lots</h3>
          <p className="mne-help" style={{ marginBottom: 12 }}>
            {fixedIncomeLots.length} lot{fixedIncomeLots.length === 1 ? '' : 's'} · {fmtShares(lotUnits)} units total
          </p>
          <FixedIncomeLotList
            lots={fixedIncomeLots}
            faceValue={asset.face_value ?? null}
            layout={lotLayout}
            maturityDate={asset.maturity_date ?? null}
            expectedReturn={expectedReturn}
            onAddLot={handleAddLot}
            onEditLot={handleEditLot}
            onDeleteLot={handleDeleteLot}
          />
        </section>
      )}

      {/* Expected pretax return if held to maturity: a projection, not a
          mark-to-market gain, so it gets its own card. */}
      {expectedReturn && (
        <section className="mne-card pf-fade">
          <h3 className="mne-card-title">Expected return to maturity</h3>
          <div className="mne-stats">
            <Stat label="Cost basis" value={<Hidden hidden={hideValues}>{fmt(expectedReturn.costBasis)}</Hidden>} />
            <Stat label="Face value at maturity" value={<Hidden hidden={hideValues}>{fmt(expectedReturn.faceValueTotal)}</Hidden>} />
            {asset.fixed_income_subtype === 'Bond' && (
              <Stat label="Coupon income" value={<Hidden hidden={hideValues}>{fmt(expectedReturn.interestIncome)}</Hidden>} />
            )}
            <Stat
              label={asset.fixed_income_subtype === 'Bond' ? 'Price gain/loss' : 'Discount captured'}
              value={<Hidden hidden={hideValues}><Delta value={expectedReturn.capitalGain} format={abs => fmt(abs)} /></Hidden>}
            />
            <Stat
              label="Total expected return"
              value={<Hidden hidden={hideValues}><Delta value={expectedReturn.totalExpectedReturn} format={abs => fmt(abs)} /></Hidden>}
              sub={expectedReturn.expectedReturnPct != null ? <Delta value={expectedReturn.expectedReturnPct} digits={1} /> : undefined}
            />
            {expectedReturn.annualizedYieldPct != null && (
              <Stat label="Annualized yield" value={`${expectedReturn.annualizedYieldPct.toFixed(2)}%`} />
            )}
          </div>
        </section>
      )}

      {!editing && asset.notes && (
        <section className="mne-card pf-fade">
          <h3 className="mne-card-title">Notes</h3>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{asset.notes}</p>
        </section>
      )}
    </PageBody>
  )
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function fmtShares(n: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(n)
}

function Hidden({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  return <span className={hiddenValueClass(hidden)}>{children}</span>
}
