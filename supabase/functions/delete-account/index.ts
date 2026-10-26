import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Deployed verify_jwt:false like the plaid-* functions (the gateway's JWT check on CORS preflight breaks
// browser calls), so the caller's session is checked manually below.

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // Every user-owned table references auth.users with on delete cascade, so this removes all of the user's data too.
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
})
