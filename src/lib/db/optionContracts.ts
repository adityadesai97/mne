import { getSupabaseClient } from '../supabase'

export type NewOptionContract = {
  option_type: 'call' | 'put'
  strike_price: number
  expiry_date: string
  contracts: number
  premium_per_share: number
  purchase_date: string
  multiplier?: number
}

export function validateOptionContract(c: NewOptionContract): string | null {
  if (c.option_type !== 'call' && c.option_type !== 'put') return 'Choose call or put'
  if (!Number.isFinite(c.strike_price) || c.strike_price < 0) return 'Strike price must be zero or more'
  if (!Number.isFinite(c.contracts) || c.contracts <= 0) return 'Contracts must be greater than 0'
  if (!Number.isFinite(c.premium_per_share) || c.premium_per_share < 0) return 'Premium per share must be zero or more'
  if (c.multiplier != null && !(c.multiplier > 0)) return 'Multiplier must be greater than 0'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.expiry_date)) return 'Enter the expiry date'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.purchase_date)) return 'Enter the purchase date'
  return null
}

/** Records a long call or put on a stock position's underlying. */
export async function addOptionContract(assetId: string, c: NewOptionContract) {
  const problem = validateOptionContract(c)
  if (problem) throw new Error(problem)
  const { error } = await getSupabaseClient().from('option_contracts').insert({
    asset_id: assetId,
    option_type: c.option_type,
    strike_price: c.strike_price,
    expiry_date: c.expiry_date,
    contracts: c.contracts,
    multiplier: c.multiplier ?? 100,
    premium_per_share: c.premium_per_share,
    purchase_date: c.purchase_date,
  })
  if (error) throw error
}

/** Closes out a contract (sold, exercised or expired) at the premium received per share. */
export async function closeOptionContract(contractId: string, closedDate: string, closePremiumPerShare: number) {
  if (!Number.isFinite(closePremiumPerShare) || closePremiumPerShare < 0) throw new Error('Premium received must be zero or more')
  const { error } = await getSupabaseClient()
    .from('option_contracts')
    .update({ closed_date: closedDate, close_premium_per_share: closePremiumPerShare })
    .eq('id', contractId)
  if (error) throw error
}

export async function deleteOptionContract(contractId: string) {
  const { error } = await getSupabaseClient().from('option_contracts').delete().eq('id', contractId)
  if (error) throw error
}
