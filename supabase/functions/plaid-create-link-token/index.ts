import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Every Plaid API call in this repo's edge functions uses each user's own
// Plaid developer credentials (client_id/secret), not one credential set
// shared across the deployment — each user brings their own free Plaid
// Trial team, so the 10-Item cap belongs to them alone (see
// plaid_credentials/plaid_credential_secrets in the Plaid migration).
//
// This credential-lookup + fetch-wrapper snippet is intentionally
// duplicated across plaid-create-link-token, plaid-exchange-token,
// plaid-sync, plaid-sync-me, and plaid-remove-item rather than shared via
// an import: this repo's deploy tooling (setup.sh/upgrade.sh) zips each
// function's index.ts in isolation with no access to sibling files, the
// same reason check-vests/check-prices are each fully self-contained.
// Keep these copies in sync if the Plaid call shape changes.

const PLAID_ITEM_LIMIT = 10

function plaidBaseUrl(env: string) {
  return env === 'sandbox' ? 'https://sandbox.plaid.com' : 'https://production.plaid.com'
}

async function getPlaidCredentials(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: creds } = await supabase
    .from('plaid_credentials')
    .select('client_id, plaid_env')
    .eq('user_id', userId)
    .maybeSingle()
  const { data: secretRow } = await supabase
    .from('plaid_credential_secrets')
    .select('secret')
    .eq('user_id', userId)
    .maybeSingle()
  if (!creds?.client_id || !secretRow?.secret) return null
  return { clientId: creds.client_id as string, secret: secretRow.secret as string, env: (creds.plaid_env as string) || 'production' }
}

async function plaidFetch(
  creds: { clientId: string; secret: string; env: string },
  path: string,
  body: Record<string, unknown>,
) {
  const res = await fetch(`${plaidBaseUrl(creds.env)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: creds.clientId, secret: creds.secret, ...body }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error_message || json.error_code || `Plaid ${path} failed`)
  return json
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const creds = await getPlaidCredentials(supabase, user.id)
  if (!creds) {
    return new Response(
      JSON.stringify({ error: 'Plaid credentials not configured. Add your client_id/secret in Settings first.' }),
      { status: 400 },
    )
  }

  const { count } = await supabase
    .from('plaid_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if ((count ?? 0) >= PLAID_ITEM_LIMIT) {
    return new Response(
      JSON.stringify({ error: `You've reached the free-plan limit of ${PLAID_ITEM_LIMIT} connected accounts.` }),
      { status: 400 },
    )
  }

  try {
    // NOTE: verify this products list against Plaid's current docs at build
    // time — 'investments' covers brokerage/401k/HSA holdings, 'auth'
    // covers cash account balances.
    const linkToken = await plaidFetch(creds, '/link/token/create', {
      user: { client_user_id: user.id },
      client_name: 'mne',
      products: ['investments', 'auth'],
      country_codes: ['US'],
      language: 'en',
    })
    return new Response(JSON.stringify({ link_token: linkToken.link_token }))
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to create link token' }),
      { status: 500 },
    )
  }
})
