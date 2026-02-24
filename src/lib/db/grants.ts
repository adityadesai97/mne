import { getSupabaseClient } from '../supabase'

export async function endGrant(grantId: string, endedAt: string) {
  const { error } = await getSupabaseClient()
    .from('rsu_grants')
    .update({ ended_at: endedAt })
    .eq('id', grantId)
  if (error) throw error
}
