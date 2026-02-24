import { getSupabaseClient } from '../supabase'

export async function updateTransaction(id: string, updates: {
  count: number
  cost_price: number
  purchase_date: string
  capital_gains_status: string
}) {
  const { error } = await getSupabaseClient()
    .from('transactions')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function deleteTransaction(id: string) {
  const { error } = await getSupabaseClient().from('transactions').delete().eq('id', id)
  if (error) throw error
}

export async function promoteStaleShortTermLots(): Promise<number> {
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  const cutoffDate = cutoff.toISOString().split('T')[0]
  const { data, error } = await getSupabaseClient()
    .from('transactions')
    .update({ capital_gains_status: 'Long Term' })
    .eq('capital_gains_status', 'Short Term')
    .lte('purchase_date', cutoffDate)
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}
