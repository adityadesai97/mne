import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Push notification body text is user-facing, so dates in it follow the
// app-wide MM/DD/YYYY display convention (see src/lib/dates.ts) even though
// this function can't import from src — it's a standalone Deno function.
function formatDateMDY(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${month}/${day}/${year}`
}

// Ports the discrete vesting math from src/lib/charts.ts (computeRsuVestEvents)
// since this function runs standalone in Deno and can't import from src.
// Keep these two in sync if the vesting model changes.
type VestingFrequency = 'monthly' | 'quarterly' | 'annually' | 'continuous'

const FREQUENCY_MONTHS: Record<Exclude<VestingFrequency, 'continuous'>, number> = {
  monthly: 1,
  quarterly: 3,
  annually: 12,
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setMonth(result.getMonth() + months)
  return result
}

function computeVestEvents(grant: {
  grant_date: string
  total_shares: number
  vest_start: string
  vest_end: string
  cliff_date: string | null
  vesting_frequency: VestingFrequency | null
}): { date: Date; shares: number }[] {
  const frequency = grant.vesting_frequency ?? 'quarterly'
  if (frequency === 'continuous') return []
  const periodMonths = FREQUENCY_MONTHS[frequency]
  const grantDate = new Date(grant.grant_date)
  const vestEnd = new Date(grant.vest_end)
  const firstVestDate = new Date(grant.cliff_date ?? grant.vest_start)
  const total = Number(grant.total_shares)
  if (!(total > 0) || !(vestEnd > grantDate) || !(firstVestDate <= vestEnd)) return []

  let totalPeriods = 0
  let cursor = new Date(grantDate)
  while (cursor < vestEnd) {
    cursor = addMonths(cursor, periodMonths)
    totalPeriods += 1
  }
  if (totalPeriods <= 0) return []

  let periodsAtCliff = 0
  cursor = new Date(grantDate)
  while (cursor < firstVestDate) {
    cursor = addMonths(cursor, periodMonths)
    periodsAtCliff += 1
  }

  const remainingPeriods = totalPeriods - periodsAtCliff
  const perPeriodShares = Math.round(total / totalPeriods)
  const cliffShares = total - perPeriodShares * remainingPeriods

  const events = [{ date: firstVestDate, shares: Math.max(0, cliffShares) }]
  cursor = new Date(firstVestDate)
  for (let i = 0; i < remainingPeriods; i += 1) {
    cursor = addMonths(cursor, periodMonths)
    events.push({ date: cursor, shares: perPeriodShares })
  }
  return events
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: settings } = await supabase.from('user_settings').select('*')

  for (const userSettings of settings ?? []) {
    if (userSettings.vest_alerts_enabled === false) continue
    const daysAhead = userSettings.rsu_alert_days_before ?? 7
    const today = new Date()
    const cutoff = new Date(today)
    cutoff.setDate(today.getDate() + daysAhead)

    const cutoffStr = cutoff.toISOString().split('T')[0]
    const todayStr = today.toISOString().split('T')[0]

    // Fetch every grant that hasn't fully vested yet — can't filter by
    // individual vest-event date in SQL since events are computed, not
    // stored, so this over-fetches slightly and filters in JS below.
    const { data: grants } = await supabase
      .from('rsu_grants')
      .select(`
        *,
        stock_subtypes!inner(
          asset:assets!inner(user_id, name)
        )
      `)
      .is('ended_at', null)
      .gte('vest_end', todayStr)

    for (const grant of grants ?? []) {
      if (grant.stock_subtypes.asset.user_id !== userSettings.user_id) continue

      const upcomingEvents = computeVestEvents(grant).filter((event) => {
        const dateStr = event.date.toISOString().split('T')[0]
        return event.shares > 0 && dateStr >= todayStr && dateStr <= cutoffStr
      })

      for (const event of upcomingEvents) {
        const dateStr = event.date.toISOString().split('T')[0]
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          },
          body: JSON.stringify({
            user_id: userSettings.user_id,
            title: 'RSU Vesting Soon',
            body: `${grant.stock_subtypes.asset.name}: ${event.shares.toLocaleString()} shares vest on ${formatDateMDY(dateStr)}`,
          }),
        })
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }))
})
