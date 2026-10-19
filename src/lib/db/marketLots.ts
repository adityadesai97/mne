import { getSupabaseClient } from '../supabase'

/**
 * Adds a purchase lot to a stock/crypto asset's Market subtype (creating the
 * subtype row if the asset only had RSU/ESPP lots), with the same
 * short/long-term rule add_stock_transaction uses. Returns the new lot's id.
 */
export async function addMarketLot(assetId: string, lot: { count: number; cost_price: number; purchase_date: string }): Promise<string> {
  const supabase = getSupabaseClient()
  const { data: existing, error: lookupError } = await supabase.from('stock_subtypes')
    .select('id').eq('asset_id', assetId).eq('subtype', 'Market').maybeSingle()
  if (lookupError) throw lookupError
  let subtypeId = existing?.id as string | undefined
  if (!subtypeId) {
    const { data, error } = await supabase.from('stock_subtypes').insert({ asset_id: assetId, subtype: 'Market' }).select('id').single()
    if (error) throw error
    subtypeId = data.id as string
  }
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const capital_gains_status = new Date(lot.purchase_date) < oneYearAgo ? 'Long Term' : 'Short Term'
  const { data: inserted, error } = await supabase.from('transactions').insert({
    subtype_id: subtypeId,
    count: lot.count,
    cost_price: lot.cost_price,
    purchase_date: lot.purchase_date,
    capital_gains_status,
  }).select('id').single()
  if (error) throw error
  return inserted.id as string
}
