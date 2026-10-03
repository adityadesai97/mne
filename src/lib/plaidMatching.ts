// Canonical implementation of the natural-key matching a Plaid sync uses to
// tell "this detected position matches an existing manually-entered asset"
// from "this is new" — the same asset-type + name + location + ownership +
// ticker + fixed-income-subtype shape src/lib/importExport.ts uses for its
// own import dedup, adapted here to key off raw names (location name,
// ticker symbol) rather than resolved DB ids, since a Plaid sync doesn't
// have ids for a location/ticker that doesn't exist yet.
//
// supabase/functions/plaid-sync/index.ts and plaid-sync-me/index.ts each
// carry their own copy of this exact function — Deno edge functions in
// this repo can't import from src/ (see CLAUDE.md), so this file is the
// source of truth to keep those two copies in sync with, the same way
// src/lib/charts.ts is the canonical source check-vests ports.

export interface AssetNaturalKeyParams {
  assetType: string
  name: string
  locationName: string
  ownership: string
  tickerSymbol: string | null
  fixedIncomeSubtype: string | null
}

export function assetNaturalKey(params: AssetNaturalKeyParams): string {
  return [
    params.assetType.trim().toLowerCase(),
    params.name.trim().toLowerCase(),
    params.locationName.trim().toLowerCase(),
    params.ownership.trim().toLowerCase(),
    (params.tickerSymbol ?? '').trim().toLowerCase(),
    (params.fixedIncomeSubtype ?? '').trim().toLowerCase(),
  ].join('::')
}

// ─── Crypto holdings from Plaid ─────────────────────────────────────────────
//
// Canonical source for these two helpers — supabase/functions/plaid-sync and
// plaid-sync-me carry hand-kept Deno ports (edge functions can't import src/).

// Plaid may report a coin as "BTC", "btc", or a trading pair like "BTC-USD";
// mne tracks the bare coin symbol (CoinGecko resolves it from there).
export function normalizeCryptoSymbol(raw: unknown): string | null {
  const text = String(raw ?? '').trim().toUpperCase()
  if (!text) return null
  // Only a delimited quote currency is a trading pair ("BTC-USD"); a bare
  // "USDT"/"USDC" is the coin itself and must survive.
  const pair = text.match(/^(.+?)[-/_ ](?:USD|USDT|USDC)$/)
  return pair ? pair[1] : text
}

// Plaid's holding-level cost_basis is the holding's total cost, not a per-unit
// price, so the per-unit figure mne stores is total / quantity. Null when
// either is missing or the quantity is zero.
export function perUnitCost(holding: { cost_basis?: number | null; quantity?: number | null }): number | null {
  const total = holding.cost_basis
  const qty = holding.quantity
  if (total == null || qty == null || !Number.isFinite(Number(total)) || !Number(qty)) return null
  return Math.round((Number(total) / Number(qty)) * 1e8) / 1e8
}

// ─── Manual match candidates ───────────────────────────────────────────────
//
// When the natural-key match above misses (e.g. an account's ownership is
// "Joint" but Plaid has no ownership signal and always guesses
// "Individual" — see CLAUDE.md's Plaid Integration section), the review
// screen lets the user manually point a detected position at an existing
// asset instead of creating a new one. The candidate list is restricted to
// assets that are structurally compatible with what was detected — e.g. a
// detected cash balance can never be pointed at a Stock or Crypto asset,
// and a detected stock lot can only be pointed at an existing Stock asset
// for the exact same ticker (never a different symbol, never a Crypto
// asset, even though both are "ticker assets" — see isTickerAsset).

export type PlaidDetectedType = 'stock' | 'cash' | 'fixed_income' | 'stock_plan'

export interface PlaidPendingPayload {
  symbol?: string
  /** 'Crypto' for a detected coin; absent for an ordinary stock lot. */
  asset_class?: string
  asset_type?: string
  fixed_income_subtype?: string | null
}

export interface ManualMatchCandidateAsset {
  id: string
  name: string
  asset_type: string
  fixed_income_subtype?: string | null
  location?: { name?: string | null } | null
  ticker?: { symbol?: string | null; kind?: string | null } | null
}

export interface ManualMatchCandidate {
  id: string
  label: string
}

// Mirrors the per-tool compatibility a confirmed manual match is later
// re-verified against server-side (see executeTool's _matchedAssetId
// handling in src/lib/claude.ts) — this is the UI-facing half of the same
// rule, kept here so it's one tested source of truth for both.
export function isCompatibleManualMatch(
  detectedType: PlaidDetectedType,
  payload: PlaidPendingPayload,
  candidate: ManualMatchCandidateAsset,
): boolean {
  if (detectedType === 'stock' || detectedType === 'stock_plan') {
    const symbol = (payload.symbol ?? '').trim().toUpperCase()
    const wantsCrypto = payload.asset_class === 'Crypto'
    // A detected coin only links to an existing Crypto asset of the same
    // symbol, and a detected stock never to a Crypto asset (even though both
    // are ticker assets — see isTickerAsset).
    return (
      candidate.asset_type === (wantsCrypto ? 'Crypto' : 'Stock') &&
      (wantsCrypto || candidate.ticker?.kind !== 'crypto') &&
      (candidate.ticker?.symbol ?? '').trim().toUpperCase() === symbol
    )
  }
  if (detectedType === 'fixed_income') {
    return (
      candidate.asset_type === 'Fixed Income' &&
      (candidate.fixed_income_subtype ?? null) === (payload.fixed_income_subtype ?? null)
    )
  }
  // 'cash': Cash/401k/HSA flat-balance accounts — must be the exact same
  // asset_type (a 401k balance can never be pointed at a Cash asset, even
  // though both are flat-balance types with no live quote).
  return candidate.asset_type === (payload.asset_type ?? '')
}

export function compatibleManualMatchCandidates(
  detectedType: PlaidDetectedType,
  payload: PlaidPendingPayload,
  assets: ManualMatchCandidateAsset[],
): ManualMatchCandidate[] {
  return assets
    .filter((a) => isCompatibleManualMatch(detectedType, payload, a))
    .map((a) => ({
      id: a.id,
      label: a.location?.name ? `${a.name} (${a.location.name})` : a.name,
    }))
}

// ─── Lot reconciliation ─────────────────────────────────────────────────────
//
// A Plaid holding can report either a per-lot tax-lot breakdown (_lots,
// stashed on the pending position's payload at sync time) or, for brokerages
// that don't expose that, just one aggregate quantity/cost-basis figure.
// Reconciling a matched position's lots against what's already tracked must
// never delete an existing transaction/fixed_income_lot just because this
// particular sync pass didn't see it — see CLAUDE.md's Plaid Integration
// section: this function only ever decides what (if anything) to insert.

export interface PlaidLot {
  count: number
  cost_price: number
  purchase_date: string | null
}

export interface ExistingLot {
  id: string
  count: number | string
  cost_price: number | string
  purchase_date: string | null
}

export function buildCandidateLotsFromPlaidPayload(payload: {
  count?: number | string | null
  cost_price?: number | string | null
  purchase_date?: string | null
  _lots?: unknown
}): PlaidLot[] {
  const rawLots = Array.isArray(payload._lots) ? payload._lots : null
  if (rawLots && rawLots.length > 0) {
    return rawLots
      .map((l): PlaidLot | null => {
        const lot = l as { quantity?: number | string | null; purchase_price?: number | string | null; purchase_date?: string | null }
        if (lot.quantity == null || lot.purchase_price == null || !lot.purchase_date) return null
        return { count: Number(lot.quantity), cost_price: Number(lot.purchase_price), purchase_date: lot.purchase_date }
      })
      .filter((l): l is PlaidLot => l != null && l.count > 0)
  }
  // No per-lot breakdown from Plaid for this holding -- fall back to the
  // single aggregate figure already surfaced in the review form.
  if (payload.count == null || payload.cost_price == null || !payload.purchase_date) return []
  return [{ count: Number(payload.count), cost_price: Number(payload.cost_price), purchase_date: payload.purchase_date }]
}

const LOT_MATCH_COUNT_TOLERANCE = 0.0001
const LOT_MATCH_COST_TOLERANCE = 0.01

// A Plaid-reported lot counts as already tracked when an existing lot
// matches its purchase date exactly and its count/cost basis within a
// small rounding tolerance -- close enough that re-syncing the same
// purchase repeatedly (the normal case) never inserts a duplicate, while
// two genuinely different purchases on the same day still both land.
export function findMatchingLot(lot: PlaidLot, existing: ExistingLot[]): ExistingLot | null {
  return (
    existing.find(
      (t) =>
        t.purchase_date === lot.purchase_date &&
        Math.abs(Number(t.count) - lot.count) < LOT_MATCH_COUNT_TOLERANCE &&
        Math.abs(Number(t.cost_price) - lot.cost_price) < LOT_MATCH_COST_TOLERANCE,
    ) ?? null
  )
}
