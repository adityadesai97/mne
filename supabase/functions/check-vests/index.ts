import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: settings } = await supabase.from('user_settings').select('*')

  for (const userSettings of settings ?? []) {
    const daysAhead = userSettings.rsu_alert_days_before ?? 7
    const today = new Date()
    const cutoff = new Date(today)
    cutoff.setDate(today.getDate() + daysAhead)

    const cutoffStr = cutoff.toISOString().split('T')[0]
    const todayStr = today.toISOString().split('T')[0]

    const { data: grants } = await supabase
      .from('rsu_grants')
      .select(`
        *,
        stock_subtypes!inner(
          asset:assets!inner(user_id, name)
        )
      `)
      .is('ended_at', null)
      .lte('vest_end', cutoffStr)
      .gte('vest_end', todayStr)

    for (const grant of grants ?? []) {
      if (grant.stock_subtypes.asset.user_id !== userSettings.user_id) continue
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        },
        body: JSON.stringify({
          user_id: userSettings.user_id,
          title: 'RSU Grant Vesting Soon',
          body: `${grant.stock_subtypes.asset.name}: ${Number(grant.total_shares).toLocaleString()} shares vest on ${grant.vest_end}`,
        }),
      })
    }
  }

  return new Response(JSON.stringify({ ok: true }))
})
