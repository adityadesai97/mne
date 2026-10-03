import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// See plaid-create-link-token/index.ts for why this credential-lookup +
// fetch-wrapper snippet is duplicated across the plaid-* functions.

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

  let body: { plaid_item_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 })
  }
  if (!body.plaid_item_id) {
    return new Response(JSON.stringify({ error: 'Missing plaid_item_id' }), { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Ownership check happens here (service-role bypasses RLS) rather than
  // relying on the client, since plaid_items only grants `select` to
  // authenticated users — this function is the only path that can delete one.
  const { data: item } = await supabase
    .from('plaid_items')
    .select('id, user_id')
    .eq('id', body.plaid_item_id)
    .maybeSingle()
  if (!item || item.user_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Connection not found' }), { status: 404 })
  }

  const creds = await getPlaidCredentials(supabase, user.id)
  const { data: secretRow } = await supabase
    .from('plaid_item_secrets')
    .select('access_token')
    .eq('item_id', item.id)
    .maybeSingle()

  if (creds && secretRow?.access_token) {
    try {
      await plaidFetch(creds, '/item/remove', { access_token: secretRow.access_token })
    } catch (err) {
      // Still proceed to remove mne's own record of the connection even if
      // Plaid's side fails (e.g. the item was already removed there) —
      // the user asked to disconnect it, and leaving a dangling local row
      // around would be worse than a redundant remote no-op.
      console.error('plaid-remove-item: /item/remove failed', err)
    }
  }

  await supabase.from('plaid_items').delete().eq('id', item.id)
  // plaid_item_secrets and plaid_pending_positions/plaid_synced_positions
  // rows for this item cascade via their `on delete cascade` foreign keys.

  return new Response(JSON.stringify({ ok: true }))
})
