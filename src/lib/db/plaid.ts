import { getSupabaseClient } from '../supabase'

// Client-side helpers for the Plaid integration. Each user configures their
// own Plaid developer credentials (client_id/secret) here, the same way they
// configure their own Claude/Groq/Finnhub key — see CLAUDE.md's Plaid
// Integration section. The secret itself is write-only from this client:
// plaid_credential_secrets has no select policy, so it is never read back
// here, only ever written.

export interface PlaidCredentialsStatus {
  configured: boolean
  clientId: string | null
  plaidEnv: string
}

export async function getPlaidCredentialsStatus(): Promise<PlaidCredentialsStatus> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) return { configured: false, clientId: null, plaidEnv: 'production' }
  const { data, error } = await getSupabaseClient()
    .from('plaid_credentials')
    .select('client_id, plaid_env')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return {
    configured: !!data?.client_id,
    clientId: data?.client_id ?? null,
    plaidEnv: data?.plaid_env ?? 'production',
  }
}

export async function savePlaidCredentials(clientId: string, plaidEnv: string, secret: string): Promise<void> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error: credError } = await getSupabaseClient()
    .from('plaid_credentials')
    .upsert(
      { user_id: user.id, client_id: clientId, plaid_env: plaidEnv, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  if (credError) throw credError

  // Only sent when the user actually typed a new secret — "rotate" leaves
  // an existing one in place if the field was left blank.
  if (secret) {
    const { error: secretError } = await getSupabaseClient()
      .from('plaid_credential_secrets')
      .upsert(
        { user_id: user.id, secret, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
    if (secretError) throw secretError
  }
}

export interface PlaidItem {
  id: string
  institution_id: string | null
  institution_name: string | null
  status: 'active' | 'error' | 'disconnected'
  created_at: string
  last_synced_at: string | null
}

export const PLAID_ITEM_LIMIT = 10

export async function listPlaidItems(): Promise<PlaidItem[]> {
  const { data, error } = await getSupabaseClient()
    .from('plaid_items')
    .select('id, institution_id, institution_name, status, created_at, last_synced_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export interface PendingPlaidPosition {
  id: string
  plaid_item_id: string
  detected_type: 'stock' | 'cash' | 'fixed_income' | 'stock_plan'
  payload: Record<string, unknown>
  matched_asset_id: string | null
  created_at: string
}

export async function getPendingPlaidPositionsCount(): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from('plaid_pending_positions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}

export async function listPendingPositions(): Promise<PendingPlaidPosition[]> {
  const { data, error } = await getSupabaseClient()
    .from('plaid_pending_positions')
    .select('id, plaid_item_id, detected_type, payload, matched_asset_id, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function markPendingPositionConfirmed(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('plaid_pending_positions')
    .update({ status: 'confirmed' })
    .eq('id', id)
  if (error) throw error
}

export async function dismissPendingPosition(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('plaid_pending_positions')
    .update({ status: 'dismissed' })
    .eq('id', id)
  if (error) throw error
}

export async function createPlaidLinkToken(): Promise<string> {
  const { data, error } = await getSupabaseClient().functions.invoke('plaid-create-link-token')
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data.link_token
}

export async function exchangePlaidPublicToken(
  publicToken: string,
  institutionId: string | null,
  institutionName: string | null,
): Promise<{ pendingCount: number }> {
  const { data, error } = await getSupabaseClient().functions.invoke('plaid-exchange-token', {
    body: { public_token: publicToken, institution_id: institutionId, institution_name: institutionName },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return { pendingCount: data.pendingCount ?? 0 }
}

export async function syncPlaidNow(): Promise<{ pendingCount: number }> {
  const { data, error } = await getSupabaseClient().functions.invoke('plaid-sync-me')
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return { pendingCount: data.pendingCount ?? 0 }
}

export async function removePlaidItem(plaidItemId: string): Promise<void> {
  const { data, error } = await getSupabaseClient().functions.invoke('plaid-remove-item', {
    body: { plaid_item_id: plaidItemId },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
}
