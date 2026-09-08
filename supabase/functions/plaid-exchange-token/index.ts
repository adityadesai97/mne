import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// See plaid-create-link-token/index.ts for why this credential-lookup +
// fetch-wrapper snippet is duplicated across the plaid-* functions.

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

  let body: { public_token?: string; institution_id?: string; institution_name?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 })
  }
  if (!body.public_token) {
    return new Response(JSON.stringify({ error: 'Missing public_token' }), { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const creds = await getPlaidCredentials(supabase, user.id)
  if (!creds) {
    return new Response(JSON.stringify({ error: 'Plaid credentials not configured.' }), { status: 400 })
  }

  // Race-safety: re-check the cap right before we commit, since the UI's
  // and plaid-create-link-token's checks can both pass and still race
  // between two tabs/requests hitting this endpoint close together.
  const { count: countBefore } = await supabase
    .from('plaid_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if ((countBefore ?? 0) >= PLAID_ITEM_LIMIT) {
    return new Response(
      JSON.stringify({ error: `You've reached the free-plan limit of ${PLAID_ITEM_LIMIT} connected accounts.` }),
      { status: 400 },
    )
  }

  let accessToken: string
  let itemId: string
  try {
    const exchanged = await plaidFetch(creds, '/item/public_token/exchange', { public_token: body.public_token })
    accessToken = exchanged.access_token
    itemId = exchanged.item_id
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to exchange token' }),
      { status: 500 },
    )
  }

  // Re-check the cap one more time now that we hold a real Plaid Item — if
  // two requests both passed the check above, only one should get to keep
  // its Item; the other undoes it below rather than leaving mne's own cap
  // silently violated.
  const { count: countAfter } = await supabase
    .from('plaid_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if ((countAfter ?? 0) >= PLAID_ITEM_LIMIT) {
    try {
      await plaidFetch(creds, '/item/remove', { access_token: accessToken })
    } catch {
      // best-effort — the user still gets a clear error below either way
    }
    return new Response(
      JSON.stringify({ error: `You've reached the free-plan limit of ${PLAID_ITEM_LIMIT} connected accounts.` }),
      { status: 400 },
    )
  }

  const { data: itemRow, error: itemError } = await supabase
    .from('plaid_items')
    .insert({
      user_id: user.id,
      item_id: itemId,
      institution_id: body.institution_id ?? null,
      institution_name: body.institution_name ?? null,
      status: 'active',
    })
    .select('id')
    .single()

  if (itemError || !itemRow) {
    try {
      await plaidFetch(creds, '/item/remove', { access_token: accessToken })
    } catch {
      // best-effort
    }
    return new Response(JSON.stringify({ error: itemError?.message ?? 'Failed to save connection' }), { status: 500 })
  }

  await supabase.from('plaid_item_secrets').insert({ item_id: itemRow.id, access_token: accessToken })

  // Kick off an initial sync for just this item so the review screen has
  // something to show right away, without waiting for the hourly cron.
  let pendingCount = 0
  try {
    const syncRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/plaid-sync-me`, {
      method: 'POST',
      headers: { Authorization: authHeader },
    })
    if (syncRes.ok) {
      const syncJson = await syncRes.json()
      pendingCount = syncJson.pendingCount ?? 0
    }
  } catch {
    // Initial sync is best-effort — the hourly cron will pick it up either way.
  }

  return new Response(JSON.stringify({ item_id: itemId, pendingCount }))
})
