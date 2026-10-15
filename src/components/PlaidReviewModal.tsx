import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getSupabaseClient } from '@/lib/supabase'
import { executeTool, validateWriteToolInput } from '@/lib/claude'
import { getAllAssets } from '@/lib/db/assets'
import {
  listPendingPositions,
  markPendingPositionConfirmed,
  dismissPendingPosition,
  recordPlaidSyncLink,
  savePlaidLotLinks,
  type PendingPlaidPosition,
} from '@/lib/db/plaid'
import {
  compatibleManualMatchCandidates,
  buildCandidateLotsFromPlaidPayload,
  pairPlaidLots,
  trackedLotTotal,
  sameValueDifferentUnits,
  type ManualMatchCandidate,
  type PlaidLot,
  type ExistingLot,
} from '@/lib/plaidMatching'

// Review-first confirmation screen for positions a Plaid sync detected.
// Nothing here has touched assets/transactions/fixed_income_lots yet —
// Confirm routes through the exact same executeTool/validateWriteToolInput
// path the AI command bar's write-tool confirmations use (see
// src/lib/claude.ts and CommandBar.tsx's PreviewSections), so a synced
// position is written the same way a manually-entered one would be.
//
// A row with no automatic natural-key match can still be manually pointed
// at an existing position (see compatibleManualMatchCandidates) — e.g. an
// account whose ownership Plaid can't tell (it always guesses
// "Individual") missing a manually-tracked "Joint" asset. Once picked, a
// manual match is treated identically to an automatic one everywhere below
// (same reconciliation, same duplicate-risk checkbox for lot-based types).

// ── Lot matching for a row matched to an existing stock/crypto/bond position ──────────
// Plaid's lots are paired with the lots already tracked: identical ones pair automatically,
// the rest the user pairs by hand ("same purchase") or adds as new. A holding Plaid reports
// with no lot breakdown (e.g. Chase) can be linked without adding anything. Nothing is ever
// inserted unless the user chose it, so a position can't be double-counted by accident.

const LOT_MATCHING_TYPES = new Set<PendingPlaidPosition['detected_type']>(['stock', 'fixed_income'])
const NEW_LOT = 'new'

interface RowLotPlan {
  existing: ExistingLot[]
  plaidLots: PlaidLot[]
  autoMatches: (string | null)[]
}

function trackedLotsFor(asset: any, detectedType: PendingPlaidPosition['detected_type']): ExistingLot[] {
  if (!asset) return []
  if (detectedType === 'fixed_income') {
    return (asset.fixed_income_lots ?? []).map((l: any) => ({
      id: l.id, count: l.count, cost_price: l.cost_price, purchase_date: l.purchase_date,
    }))
  }
  const market = (asset.stock_subtypes ?? []).find((s: any) => s.subtype === 'Market')
  return (market?.transactions ?? []).map((t: any) => ({
    id: t.id, count: t.count, cost_price: t.cost_price, purchase_date: t.purchase_date,
  }))
}

function buildLotPlan(row: PendingPlaidPosition, asset: any): RowLotPlan {
  const existing = trackedLotsFor(asset, row.detected_type)
  // Only Plaid's own per-lot breakdown counts here — the aggregate fallback has no date to match on.
  const plaidLots = buildCandidateLotsFromPlaidPayload({ _lots: (row.payload as any)._lots } as any)
  return { existing, plaidLots, autoMatches: pairPlaidLots(plaidLots, existing).map((p) => p.matchedLotId) }
}

function describeLot(l: { count: number | string; cost_price: number | string; purchase_date: string | null }) {
  return `${l.purchase_date ?? 'no date'} · ${Number(l.count)} @ $${Number(l.cost_price)}`
}

interface Props {
  open: boolean
  onClose: () => void
  /** Called after any confirm/skip so a caller (e.g. AppLayout's banner) can refresh its pending count. */
  onChanged?: () => void
}

const TOOL_FOR_TYPE: Record<PendingPlaidPosition['detected_type'], string> = {
  stock: 'add_stock_transaction',
  stock_plan: 'add_stock_transaction',
  cash: 'add_cash_asset',
  fixed_income: 'add_cash_asset',
}

// add_stock_transaction/add_cash_asset insert a new tax lot / a new asset
// row by default — fine for a brand-new detected position, but wrong for a
// row matched (automatically or manually) to something the user already
// tracks: inserting on top of it would double-count a balance or a share
// count rather than reconciling it. Passing _matchedAssetId (see
// handleConfirm) makes both tools resolve the existing asset by id instead
// of creating one, and dedupe each Plaid-reported lot against what's
// already tracked before inserting (src/lib/claude.ts) — never deleting.
//
// For flat-balance types (Cash/401k/HSA/CD — detected_type 'cash'), a
// matched row is safe to route through update_asset_value instead, which
// genuinely updates the existing asset's value in place.
//
// For lot-based types (Stock, Bond/T-Bill), the dedup above still can't
// tell "the same purchase, reported slightly differently" from "a true
// near-duplicate" with full confidence, so those rows still require an
// explicit acknowledgment below before Confirm is enabled.
const LOT_BASED_TYPES = new Set<PendingPlaidPosition['detected_type']>(['stock', 'stock_plan', 'fixed_income'])

const TYPE_LABEL: Record<PendingPlaidPosition['detected_type'], string> = {
  stock: 'Stock',
  stock_plan: 'Stock plan (RSU/ESPP) — check the type below',
  cash: 'Balance',
  fixed_income: 'Fixed Income',
}

type FieldType = 'text' | 'number' | 'date' | 'select'
interface FieldConfig {
  key: string
  label: string
  type: FieldType
  options?: string[]
  required?: boolean
}

const STOCK_FIELDS: FieldConfig[] = [
  { key: 'symbol', label: 'Symbol', type: 'text', required: true },
  { key: 'count', label: 'Shares', type: 'number', required: true },
  { key: 'cost_price', label: 'Cost/share ($)', type: 'number', required: true },
  { key: 'purchase_date', label: 'Purchase date', type: 'date', required: true },
  { key: 'subtype', label: 'Type', type: 'select', options: ['Market', 'ESPP', 'RSU'] },
  { key: 'grant_date', label: 'RSU grant date (if RSU)', type: 'date' },
  { key: 'location_name', label: 'Location', type: 'text', required: true },
]

// A coin Plaid detected rides the 'stock' review row (detected_type 'stock',
// payload.asset_class 'Crypto' — see add_stock_transaction's crypto branch), so
// it only needs its own labels: no RSU/ESPP type or grant date, units rather
// than shares, an exchange/wallet rather than a brokerage.
const CRYPTO_FIELDS: FieldConfig[] = [
  { key: 'symbol', label: 'Coin symbol', type: 'text', required: true },
  { key: 'count', label: 'Units', type: 'number', required: true },
  { key: 'cost_price', label: 'Cost/unit ($)', type: 'number', required: true },
  { key: 'purchase_date', label: 'Purchase date', type: 'date', required: true },
  { key: 'location_name', label: 'Exchange / wallet', type: 'text', required: true },
]

const FIELDS_BY_TYPE: Record<PendingPlaidPosition['detected_type'], FieldConfig[]> = {
  stock: STOCK_FIELDS,
  stock_plan: STOCK_FIELDS,
  cash: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'price', label: 'Value ($)', type: 'number', required: true },
    { key: 'location_name', label: 'Location', type: 'text', required: true },
  ],
  fixed_income: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'count', label: 'Units', type: 'number', required: true },
    { key: 'cost_price', label: 'Cost/unit ($)', type: 'number', required: true },
    { key: 'purchase_date', label: 'Purchase date', type: 'date', required: true },
    { key: 'interest_rate', label: 'Coupon rate (%, Bond only)', type: 'number' },
    { key: 'maturity_date', label: 'Maturity date', type: 'date' },
    { key: 'face_value', label: 'Face value ($/unit at maturity)', type: 'number' },
    { key: 'location_name', label: 'Location', type: 'text', required: true },
  ],
}

/** The choice per Plaid lot: the user's, else the automatic match, else '' (still undecided). */
function resolveDecisions(plan: RowLotPlan, chosen: Record<number, string>): string[] {
  return plan.plaidLots.map((_, i) => chosen[i] ?? plan.autoMatches[i] ?? '')
}

function lotInsertionInput(plan: RowLotPlan, decisions: string[], aggregateAddsLot: boolean, payload: Record<string, unknown>) {
  if (plan.plaidLots.length > 0) {
    return {
      _plaidLots: plan.plaidLots.filter((_, i) => decisions[i] === NEW_LOT),
      _plaidLotsExplicit: true,
    }
  }
  // No per-lot breakdown from Plaid: link only, unless the user asked for Plaid's total as a lot.
  return {
    _plaidLots: aggregateAddsLot
      ? [{ count: Number(payload.count), cost_price: Number(payload.cost_price), purchase_date: payload.purchase_date as string }]
      : [],
    _plaidLotsExplicit: true,
  }
}

export function PlaidReviewModal({ open, onClose, onChanged }: Props) {
  const [rows, setRows] = useState<PendingPlaidPosition[]>([])
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({})
  const [allAssets, setAllAssets] = useState<any[]>([])
  const [manualMatchedAssetId, setManualMatchedAssetId] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [acknowledgedDuplicateRisk, setAcknowledgedDuplicateRisk] = useState<Record<string, boolean>>({})
  // Per row: Plaid lot index -> '' (undecided) | 'new' | id of the tracked lot it's the same purchase as.
  const [lotChoices, setLotChoices] = useState<Record<string, Record<number, string>>>({})
  // Per row, for holdings Plaid reports without lots: link only (default) or add Plaid's total as a lot.
  const [aggregateAddsLot, setAggregateAddsLot] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!open) return
    void load()
  }, [open])

  async function load() {
    setLoading(true)
    try {
      const [pending, assets] = await Promise.all([listPendingPositions(), getAllAssets()])
      setRows(pending)
      const initialEdits: Record<string, Record<string, unknown>> = {}
      for (const row of pending) initialEdits[row.id] = { ...row.payload }
      setEdits(initialEdits)
      setAllAssets(assets ?? [])
      setManualMatchedAssetId({})
      setLotChoices({})
      setAggregateAddsLot({})
    } finally {
      setLoading(false)
    }
  }

  function setField(rowId: string, key: string, value: unknown) {
    setEdits((prev) => ({ ...prev, [rowId]: { ...prev[rowId], [key]: value } }))
  }

  const assetNameById: Record<string, string> = {}
  for (const a of allAssets) assetNameById[a.id] = a.name

  async function handleConfirm(row: PendingPlaidPosition) {
    const effectiveMatchedAssetId = row.matched_asset_id ?? manualMatchedAssetId[row.id] ?? null
    const isLotBasedMatch = !!effectiveMatchedAssetId && LOT_BASED_TYPES.has(row.detected_type)
    const lotMatching = !!effectiveMatchedAssetId && LOT_MATCHING_TYPES.has(row.detected_type)
    const matchedAsset = effectiveMatchedAssetId ? allAssets.find((a) => a.id === effectiveMatchedAssetId) : undefined
    const lotPlan = lotMatching ? buildLotPlan(row, matchedAsset) : null
    const decisions = lotPlan ? resolveDecisions(lotPlan, lotChoices[row.id] ?? {}) : []
    if (lotPlan && lotPlan.plaidLots.length > 0 && decisions.some((d) => d === '')) {
      setErrors((prev) => ({ ...prev, [row.id]: 'Say how each Plaid lot relates to your existing lots first.' }))
      return
    }
    if (isLotBasedMatch && !lotMatching && !acknowledgedDuplicateRisk[row.id]) {
      setErrors((prev) => ({ ...prev, [row.id]: 'Check the box above to confirm this won’t double-count an existing position.' }))
      return
    }

    // A matched flat-balance position (Cash/401k/HSA/CD) can be reconciled
    // safely: update_asset_value overwrites the existing asset's value in
    // place instead of inserting a duplicate row the way add_cash_asset would.
    const isFlatBalanceMatch = !!effectiveMatchedAssetId && row.detected_type === 'cash'
    const toolName = isFlatBalanceMatch ? 'update_asset_value' : TOOL_FOR_TYPE[row.detected_type]
    const payload = edits[row.id] ?? {}
    const input: Record<string, unknown> = isFlatBalanceMatch
      ? {
          asset_name: assetNameById[effectiveMatchedAssetId!],
          // _assetId/_expectedAssetType/_matchedAssetId/_plaidLots are
          // consumed only by executeTool's Plaid-reconciliation handling
          // (src/lib/claude.ts) — never part of a tool's public schema, so
          // the AI command bar's model never sees or sets them.
          _assetId: effectiveMatchedAssetId,
          _expectedAssetType: (row.payload as any).asset_type,
          price: payload.price,
        }
      : {
          ...payload,
          ...(effectiveMatchedAssetId ? { _matchedAssetId: effectiveMatchedAssetId } : {}),
          ...(lotPlan
            ? lotInsertionInput(lotPlan, decisions, !!aggregateAddsLot[row.id], payload)
            : LOT_BASED_TYPES.has(row.detected_type)
              ? { _plaidLots: buildCandidateLotsFromPlaidPayload({ ...payload, _lots: (row.payload as any)._lots } as any) }
              : {}),
        }
    delete input._lots

    // When the user chose to add nothing, the lot fields on the form aren't used, so validate
    // the rest of the input against a harmless placeholder lot.
    const addsNothing = !!lotPlan && (input._plaidLots as unknown[]).length === 0
    const validationError = validateWriteToolInput(
      toolName,
      addsNothing ? { ...input, count: 1, cost_price: 0, purchase_date: new Date().toISOString().slice(0, 10) } : input,
    )
    if (validationError) {
      setErrors((prev) => ({ ...prev, [row.id]: validationError }))
      return
    }

    setBusyId(row.id)
    setErrors((prev) => ({ ...prev, [row.id]: '' }))
    try {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const result = await executeTool(toolName, input, user.id)
      // Records the sync link so the badge has something to key off and so
      // a later plaid-sync run updates this position in place instead of
      // re-detecting (and potentially re-confirming, i.e. duplicating) it.
      await recordPlaidSyncLink(row, {
        assetId: result?.assetId,
        transactionId: row.detected_type === 'stock' || row.detected_type === 'stock_plan' ? result?.transactionId : undefined,
        fixedIncomeLotId: row.detected_type === 'fixed_income' ? result?.fixedIncomeLotId : undefined,
      })
      if (lotPlan && row.detected_type === 'stock') {
        await savePlaidLotLinks(
          row,
          lotPlan.plaidLots.flatMap((lot, i) =>
            decisions[i] && decisions[i] !== NEW_LOT
              ? [{ transactionId: decisions[i], plaidDate: lot.purchase_date!, plaidPrice: lot.cost_price }]
              : [],
          ),
        )
      }
      await markPendingPositionConfirmed(row.id)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      onChanged?.()
    } catch (err) {
      setErrors((prev) => ({ ...prev, [row.id]: err instanceof Error ? err.message : 'Failed to save' }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleSkip(row: PendingPlaidPosition) {
    setBusyId(row.id)
    try {
      await dismissPendingPosition(row.id)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      onChanged?.()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review synced positions</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Plaid detected these positions. Nothing is added to your portfolio until you confirm each one — fill
          in anything Plaid couldn't supply first.
        </p>
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing left to review.</p>
        ) : (
          <div className="space-y-4">
            {rows.map((row) => {
              const manualId = manualMatchedAssetId[row.id]
              const effectiveMatchedId = row.matched_asset_id ?? manualId ?? null
              const candidates = row.matched_asset_id
                ? []
                : compatibleManualMatchCandidates(row.detected_type, row.payload as any, allAssets)
              return (
                <PendingRow
                  key={row.id}
                  row={row}
                  edit={edits[row.id] ?? {}}
                  matchedName={effectiveMatchedId ? assetNameById[effectiveMatchedId] : undefined}
                  isManualMatch={!row.matched_asset_id && !!manualId}
                  candidates={candidates}
                  selectedCandidateId={manualId ?? ''}
                  onManualMatchChange={(assetId) =>
                    setManualMatchedAssetId((prev) => {
                      const next = { ...prev }
                      if (assetId) next[row.id] = assetId
                      else delete next[row.id]
                      return next
                    })
                  }
                  error={errors[row.id]}
                  busy={busyId === row.id}
                  lotPlan={
                    effectiveMatchedId && LOT_MATCHING_TYPES.has(row.detected_type)
                      ? buildLotPlan(row, allAssets.find((a) => a.id === effectiveMatchedId))
                      : null
                  }
                  lotChoice={lotChoices[row.id] ?? {}}
                  onLotChoice={(index, value) =>
                    setLotChoices((prev) => ({ ...prev, [row.id]: { ...(prev[row.id] ?? {}), [index]: value } }))
                  }
                  aggregateAddsLot={!!aggregateAddsLot[row.id]}
                  onAggregateAddsLotChange={(v) => setAggregateAddsLot((prev) => ({ ...prev, [row.id]: v }))}
                  acknowledgedDuplicateRisk={!!acknowledgedDuplicateRisk[row.id]}
                  onAcknowledgeDuplicateRiskChange={(checked) =>
                    setAcknowledgedDuplicateRisk((prev) => ({ ...prev, [row.id]: checked }))
                  }
                  onFieldChange={(key, value) => setField(row.id, key, value)}
                  onConfirm={() => handleConfirm(row)}
                  onSkip={() => handleSkip(row)}
                />
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PendingRow({
  row,
  edit,
  matchedName,
  isManualMatch,
  candidates,
  selectedCandidateId,
  onManualMatchChange,
  error,
  busy,
  lotPlan,
  lotChoice,
  onLotChoice,
  aggregateAddsLot,
  onAggregateAddsLotChange,
  acknowledgedDuplicateRisk,
  onAcknowledgeDuplicateRiskChange,
  onFieldChange,
  onConfirm,
  onSkip,
}: {
  row: PendingPlaidPosition
  edit: Record<string, unknown>
  matchedName?: string
  isManualMatch: boolean
  candidates: ManualMatchCandidate[]
  selectedCandidateId: string
  onManualMatchChange: (assetId: string | null) => void
  error?: string
  busy: boolean
  lotPlan: RowLotPlan | null
  lotChoice: Record<number, string>
  onLotChoice: (index: number, value: string) => void
  aggregateAddsLot: boolean
  onAggregateAddsLotChange: (v: boolean) => void
  acknowledgedDuplicateRisk: boolean
  onAcknowledgeDuplicateRiskChange: (checked: boolean) => void
  onFieldChange: (key: string, value: unknown) => void
  onConfirm: () => void
  onSkip: () => void
}) {
  const isCrypto = (row.payload as { asset_class?: string }).asset_class === 'Crypto'
  const fields = isCrypto ? CRYPTO_FIELDS : FIELDS_BY_TYPE[row.detected_type]
  const isLotBasedMatch = !!matchedName && LOT_BASED_TYPES.has(row.detected_type)
  const isFlatBalanceMatch = !!matchedName && row.detected_type === 'cash'
  const unit = isCrypto ? 'units' : row.detected_type === 'fixed_income' ? 'units' : 'shares'
  const decisions = lotPlan ? resolveDecisions(lotPlan, lotChoice) : []
  const hasLotDetail = !!lotPlan && lotPlan.plaidLots.length > 0
  const undecided = hasLotDetail && decisions.some((d) => d === '')
  // The count/cost/date form fields describe the lot being added; when the user is matching
  // lots (or linking only) those aren't what gets written, so they're hidden.
  const hideLotFields = !!lotPlan && (hasLotDetail || !aggregateAddsLot)
  const visibleFields = hideLotFields ? fields.filter((f) => !['count', 'cost_price', 'purchase_date'].includes(f.key)) : fields

  return (
    <div className="rounded-md border border-border/70 p-3 space-y-2">
      <div>
        <span
          className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${
            matchedName ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
          }`}
        >
          {matchedName ? (isManualMatch ? `Linked to "${matchedName}"` : `Looks like "${matchedName}"`) : 'New'}
        </span>
        <p className="text-xs text-muted-foreground mt-1">{isCrypto ? 'Crypto' : TYPE_LABEL[row.detected_type]}</p>
        {!row.matched_asset_id && candidates.length > 0 && (
          <label className="text-xs space-y-1 block mt-1.5">
            <span className="text-muted-foreground">
              No automatic match found — link to an existing position instead? (optional)
            </span>
            <select
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={selectedCandidateId}
              onChange={(e) => onManualMatchChange(e.target.value || null)}
            >
              <option value="">Create as a new position</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {isFlatBalanceMatch && (
          <p className="text-[11px] text-muted-foreground mt-1">
            Confirming updates "{matchedName}"'s value — it won't create a duplicate.
          </p>
        )}
        {lotPlan && (
          <div className="mt-2 rounded border border-border/70 p-2 space-y-2">
            {hasLotDetail ? (
              <>
                <p className="text-[11px] text-muted-foreground">
                  Plaid lists {lotPlan.plaidLots.length} lot{lotPlan.plaidLots.length !== 1 ? 's' : ''}. Say which of your
                  lots each one is, so nothing is counted twice and later sells land on the right lot.
                </p>
                {lotPlan.plaidLots.map((lot, i) => (
                  <label key={i} className="block text-[11px] space-y-1">
                    <span className="text-foreground">
                      Plaid: {describeLot(lot)}
                      {lotPlan.autoMatches[i] && decisions[i] === lotPlan.autoMatches[i] ? ' — matched automatically' : ''}
                    </span>
                    <select
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                      value={decisions[i]}
                      onChange={(e) => onLotChoice(i, e.target.value)}
                    >
                      <option value="">Choose…</option>
                      <option value={NEW_LOT}>A new purchase — add it as a lot</option>
                      {lotPlan.existing.map((e) => (
                        <option key={e.id} value={e.id}>
                          Same as my lot: {describeLot(e)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </>
            ) : (
              <>
                <p className="text-[11px] text-muted-foreground">
                  Plaid reports this holding as a single total with no lot detail. You track{' '}
                  {trackedLotTotal(lotPlan.existing)} {unit} across {lotPlan.existing.length} lot
                  {lotPlan.existing.length !== 1 ? 's' : ''}; Plaid shows {Number((row.payload as any).count ?? 0)}.
                </p>
                {sameValueDifferentUnits(row.payload as any, lotPlan.existing) && (
                  <p className="text-[11px] text-green-700 dark:text-green-500">
                    The total value matches what you track — Plaid just counts in a different unit size, so this is
                    very likely the same position. Link only is the right choice.
                  </p>
                )}
                <label className="flex items-start gap-1.5 text-[11px] text-foreground">
                  <input type="radio" checked={!aggregateAddsLot} onChange={() => onAggregateAddsLotChange(false)} className="mt-0.5" />
                  <span>Link only — keep my lots exactly as they are (recommended)</span>
                </label>
                <label className="flex items-start gap-1.5 text-[11px] text-foreground">
                  <input type="radio" checked={aggregateAddsLot} onChange={() => onAggregateAddsLotChange(true)} className="mt-0.5" />
                  <span>Add Plaid's total as a new lot (fill in its date below)</span>
                </label>
              </>
            )}
            <p className="text-[11px] text-muted-foreground">
              Once linked, later buys are added automatically. A sell is applied only when the lot can be proven;
              otherwise you'll be asked which lots it came from.
            </p>
          </div>
        )}
        {isLotBasedMatch && !lotPlan && (
          <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 space-y-1.5">
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              This looks like a position you may already track manually as "{matchedName}". Confirming
              <strong> adds this as an additional lot</strong> rather than replacing anything — if it's the
              same purchase you already entered, confirming will double-count it. Skip this row instead if
              you're unsure, and adjust "{matchedName}" by hand if needed.
            </p>
            <label className="flex items-center gap-1.5 text-[11px] text-foreground">
              <input
                type="checkbox"
                checked={acknowledgedDuplicateRisk}
                onChange={(e) => onAcknowledgeDuplicateRiskChange(e.target.checked)}
              />
              This is a new/different lot, not a duplicate of "{matchedName}"
            </label>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {visibleFields.map((field) => (
          <label key={field.key} className="text-xs space-y-1 block">
            <span className="text-muted-foreground">
              {field.label}
              {field.required ? ' *' : ''}
            </span>
            {field.type === 'select' ? (
              <select
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={String(edit[field.key] ?? '')}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
              >
                <option value="">–</option>
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                value={(edit[field.key] as string | number | undefined) ?? ''}
                onChange={(e) =>
                  onFieldChange(
                    field.key,
                    field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
                  )
                }
              />
            )}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={busy || undecided || (isLotBasedMatch && !lotPlan && !acknowledgedDuplicateRisk)}
          onClick={onConfirm}
          className="flex-1 bg-primary text-primary-foreground rounded-md py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Confirm'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSkip}
          className="flex-1 bg-muted text-muted-foreground rounded-md py-1.5 text-xs hover:bg-muted/80 transition-colors disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
