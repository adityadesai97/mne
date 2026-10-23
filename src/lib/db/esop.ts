import { getSupabaseClient } from '../supabase'
import { addMarketLot } from './marketLots'
import { computeEsopPosition, type EsopGrant } from '../esop'

export type ExerciseInput = {
  /** Options to convert into shares. */
  count: number
  exerciseDate: string
  /** Cost basis per share of the resulting lot (usually FMV at exercise for
   *  NSOs); entered by the user each time. */
  costPrice: number
}

/** Why `input` can't be exercised against `grant`, or null when it can. */
export function validateExercise(grant: EsopGrant, input: ExerciseInput): string | null {
  if (!Number.isFinite(input.count) || input.count <= 0) return 'Options to exercise must be a positive number'
  if (!Number.isFinite(input.costPrice) || input.costPrice < 0) return 'Cost basis per share must be zero or more'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.exerciseDate)) return 'Enter the exercise date as YYYY-MM-DD'
  const asOf = new Date(`${input.exerciseDate}T00:00:00`)
  if (grant.expiry_date && new Date(grant.expiry_date) < asOf) return 'These options had expired by the exercise date'
  const { vested, exercised } = computeEsopPosition(grant, asOf)
  const available = Math.max(0, vested - exercised)
  if (input.count > available + 1e-9) {
    return `Only ${available.toLocaleString('en-US', { maximumFractionDigits: 4 })} vested option${available === 1 ? '' : 's'} can be exercised on ${input.exerciseDate}`
  }
  return null
}

/**
 * Converts vested options into shares: adds a Market tax lot (cost basis as
 * entered) and records the exercise so the options stop counting as
 * outstanding. `assetId` is the position the grant belongs to.
 */
export async function exerciseOptions(assetId: string, grant: EsopGrant & { id: string }, input: ExerciseInput) {
  const problem = validateExercise(grant, input)
  if (problem) throw new Error(problem)
  const supabase = getSupabaseClient()
  const transactionId = await addMarketLot(assetId, {
    count: input.count,
    cost_price: input.costPrice,
    purchase_date: input.exerciseDate,
  })
  const { error } = await supabase.from('esop_exercises').insert({
    grant_id: grant.id,
    exercise_date: input.exerciseDate,
    count: input.count,
    strike_price: Number(grant.strike_price),
    cost_price: input.costPrice,
    transaction_id: transactionId,
  })
  if (error) {
    // Don't leave shares that no exercise accounts for.
    await supabase.from('transactions').delete().eq('id', transactionId)
    throw error
  }
}

export async function endEsopGrant(grantId: string, endedAt: string) {
  const { error } = await getSupabaseClient().from('esop_grants').update({ ended_at: endedAt }).eq('id', grantId)
  if (error) throw error
}

/** Deletes a grant and its exercise log. Shares already created by exercises
 *  stay (they are ordinary lots now). */
export async function deleteEsopGrant(grantId: string) {
  const supabase = getSupabaseClient()
  const { error: exercisesError } = await supabase.from('esop_exercises').delete().eq('grant_id', grantId)
  if (exercisesError) throw exercisesError
  const { error } = await supabase.from('esop_grants').delete().eq('id', grantId)
  if (error) throw error
}

export type NewEsopGrant = {
  grant_date: string
  total_options: number
  strike_price: number
  vest_start: string
  vest_end: string
  cliff_date?: string | null
  vesting_frequency: 'monthly' | 'quarterly' | 'annually' | 'continuous'
  expiry_date?: string | null
}

/** Records an option grant on a ticker asset, creating its ESOP subtype on first use. */
export async function addEsopGrant(assetId: string, grant: NewEsopGrant) {
  const supabase = getSupabaseClient()
  const { data: existing, error: lookupError } = await supabase.from('stock_subtypes')
    .select('id').eq('asset_id', assetId).eq('subtype', 'ESOP').maybeSingle()
  if (lookupError) throw lookupError
  let subtypeId = existing?.id as string | undefined
  if (!subtypeId) {
    const { data, error } = await supabase.from('stock_subtypes').insert({ asset_id: assetId, subtype: 'ESOP' }).select('id').single()
    if (error) throw error
    subtypeId = data.id as string
  }
  const { error } = await supabase.from('esop_grants').insert({
    subtype_id: subtypeId,
    grant_date: grant.grant_date,
    total_options: grant.total_options,
    strike_price: grant.strike_price,
    vest_start: grant.vest_start,
    vest_end: grant.vest_end,
    cliff_date: grant.cliff_date ?? null,
    vesting_frequency: grant.vesting_frequency,
    expiry_date: grant.expiry_date ?? null,
  })
  if (error) throw error
}
