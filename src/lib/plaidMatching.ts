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
