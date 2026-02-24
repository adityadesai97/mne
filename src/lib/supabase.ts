import { createClient } from '@supabase/supabase-js'

// Supabase credentials must be provided via env vars.
const ENV_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ENV_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const client = ENV_URL && ENV_KEY ? createClient(ENV_URL, ENV_KEY) : null

export function isSupabaseReady(): boolean {
  return client !== null
}

export function getSupabaseClient() {
  if (!client) throw new Error('Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  return client
}
