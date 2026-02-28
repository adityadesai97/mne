import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  const cutoffDate = cutoff.toISOString().split('T')[0]

  // Find lots that should be promoted
  const { data: lots } = await supabase
    .from('transactions')
    .select(`
      id,
      stock_subtypes!inner(
        asset:assets!inner(user_id)
      )
    `)
    .eq('capital_gains_status', 'Short Term')
    .lte('purchase_date', cutoffDate)

  if (!lots?.length) return new Response(JSON.stringify({ ok: true, promoted: 0 }))

  // Load user settings to check per-user notification preferences
  const { data: allSettings } = await supabase.from('user_settings').select('user_id, capital_gains_alerts_enabled')
  const settingsMap = new Map((allSettings ?? []).map((s: any) => [s.user_id, s]))

  // Group lot IDs by user_id
  const byUser = new Map<string, string[]>()
  for (const lot of lots) {
    const uid = lot.stock_subtypes.asset.user_id
    if (!byUser.has(uid)) byUser.set(uid, [])
    byUser.get(uid)!.push(lot.id)
  }

  for (const [userId, ids] of byUser) {
    await supabase
      .from('transactions')
      .update({ capital_gains_status: 'Long Term' })
      .in('id', ids)

    const userSettings = settingsMap.get(userId)
    if (userSettings?.capital_gains_alerts_enabled === false) continue

    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
      },
      body: JSON.stringify({
        user_id: userId,
        title: 'Capital Gains Update',
        body: `${ids.length} lot${ids.length !== 1 ? 's' : ''} promoted to Long Term`,
      }),
    })
  }

  return new Response(JSON.stringify({ ok: true, promoted: lots.length }))
})
