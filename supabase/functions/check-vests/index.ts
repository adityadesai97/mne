import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: settings } = await supabase.from('user_settings').select('*')

  for (const userSettings of settings ?? []) {
    const daysAhead = userSettings.rsu_alert_days_before ?? 7
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + daysAhead)

    const { data: grants } = await supabase
      .from('rsu_grants')
      .select(`
        *,
        stock_subtypes!inner(
          asset:assets!inner(user_id, name)
        )
      `)
      .eq('stock_subtypes.asset.user_id', userSettings.user_id)
      .gt('unvested_count', 0)

    for (const grant of grants ?? []) {
      const nextVest = computeNextVestDate(grant)
      if (!nextVest) continue
      if (nextVest <= cutoff && nextVest >= new Date()) {
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          },
          body: JSON.stringify({
            user_id: userSettings.user_id,
            title: `RSU Vesting Soon`,
            body: `${grant.stock_subtypes.asset.name}: ${grant.unvested_count} shares vest on ${nextVest.toDateString()}`,
          }),
        })
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }))
})

function computeNextVestDate(grant: any): Date | null {
  if (!grant.first_vest_date || !grant.cadence_months) return null
  const first = new Date(grant.first_vest_date)
  const now = new Date()
  let vest = new Date(first)
  while (vest < now) {
    vest.setMonth(vest.getMonth() + grant.cadence_months)
  }
  return vest
}
