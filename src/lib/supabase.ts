import { createClient } from '@supabase/supabase-js'

// These are provided by the user during onboarding, never hardcoded
export function createSupabaseClient(url: string, anonKey: string) {
  return createClient(url, anonKey)
}

// Singleton after onboarding
let client: ReturnType<typeof createSupabaseClient> | null = null

export function getSupabaseClient() {
  if (!client) throw new Error('Supabase not configured. Complete onboarding first.')
  return client
}

export function initSupabase(url: string, anonKey: string) {
  client = createSupabaseClient(url, anonKey)
  return client
}
