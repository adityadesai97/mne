import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// See plaid-create-link-token/index.ts for why this credential-lookup +
// fetch-wrapper snippet is duplicated across the plaid-* functions, and why
// this is deployed with verify_jwt:false despite being user-invoked (the
// gateway's own JWT check on CORS preflight OPTIONS requests breaks
// browser calls; auth is checked manually below instead).

const PLAID_ITEM_LIMIT = 10

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
  }

  let body: { public_token?: string; institution_id?: string; institution_name?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }
  if (!body.public_token) {
    return jsonResponse({ error: 'Missing public_token' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const creds = await getPlaidCredentials(supabase, user.id)
  if (!creds) {
    return jsonResponse({ error: 'Plaid credentials not configured.' }, 400)
  }

  // Race-safety: re-check the cap right before we commit, since the UI's
  // and plaid-create-link-token's checks can both pass and still race
  // between two tabs/requests hitting this endpoint close together.
  const { count: countBefore } = await supabase
    .from('plaid_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if ((countBefore ?? 0) >= PLAID_ITEM_LIMIT) {
    return jsonResponse({ error: `You've reached the free-plan limit of ${PLAID_ITEM_LIMIT} connected accounts.` }, 400)
  }

  let accessToken: string
  let itemId: string
  try {
    const exchanged = await plaidFetch(creds, '/item/public_token/exchange', { public_token: body.public_token })
    accessToken = exchanged.access_token
    itemId = exchanged.item_id
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to exchange token' }, 500)
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
    return jsonResponse({ error: `You've reached the free-plan limit of ${PLAID_ITEM_LIMIT} connected accounts.` }, 400)
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
    return jsonResponse({ error: itemError?.message ?? 'Failed to save connection' }, 500)
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

  return jsonResponse({ item_id: itemId, pendingCount })
})
