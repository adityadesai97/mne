import Anthropic from '@anthropic-ai/sdk'
import { config } from '@/store/config'
import { getSupabaseClient } from './supabase'

const EMPTY_ASSIGNMENT_RESULT = { assignedCount: 0, suggestedThemes: [] as string[] }

function normalizeThemeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function parseThemeSuggestions(raw: string): string[] {
  const trimmed = raw.trim()
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  const sanitize = (themes: unknown[]): string[] =>
    Array.from(new Set(
      themes
        .map((theme) => String(theme ?? '').trim())
        .filter((theme) => theme.length > 0),
    ))
      .slice(0, 3)

  try {
    const parsed = JSON.parse(withoutFences)
    if (Array.isArray(parsed)) return sanitize(parsed)
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).themes)) {
      return sanitize((parsed as any).themes)
    }
  } catch {
    // Fall back to line/comma parsing.
  }

  return sanitize(
    withoutFences
      .split(/[\n,]/)
      .map((entry) => entry.replace(/^[-*\d.)\s]+/, '').trim()),
  )
}

async function fetchTickerProfile(symbol: string): Promise<{ name: string; industry: string }> {
  if (!config.finnhubApiKey) return { name: '', industry: '' }
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${config.finnhubApiKey}`)
    const profile = await res.json()
    return {
      name: String(profile?.name ?? '').trim(),
      industry: String(profile?.finnhubIndustry ?? '').trim(),
    }
  } catch {
    return { name: '', industry: '' }
  }
}

async function suggestTickerThemesWithClaude(
  symbol: string,
  existingThemes: string[],
  profile: { name: string; industry: string },
): Promise<string[]> {
  if (!config.claudeApiKey) return []

  const client = new Anthropic({ apiKey: config.claudeApiKey, dangerouslyAllowBrowser: true })
  const existingThemeList = existingThemes.slice(0, 80)

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 180,
      system: 'Return only valid JSON in shape {"themes":["Theme 1","Theme 2"]}. No extra text.',
      messages: [
        {
          role: 'user',
          content: `Suggest 1-3 investment themes for ticker ${symbol}.
Company name: ${profile.name || 'unknown'}.
Industry: ${profile.industry || 'unknown'}.
Existing user theme vocabulary (reuse exact names when applicable): ${JSON.stringify(existingThemeList)}.
Rules:
- Prefer reusing existing theme names when they fit.
- If nothing fits, suggest concise new themes (1-3 words each).
- Do not include duplicates.
- Return only JSON.`,
        },
      ],
    })

    const text = response.content.find((block) => block.type === 'text')
    if (!text || text.type !== 'text') return []
    return parseThemeSuggestions(text.text)
  } catch {
    return []
  }
}

export async function autoAssignThemesForTicker(params: {
  tickerId: string
  symbol: string
  userId?: string
  skipIfAlreadyTagged?: boolean
}) {
  const { tickerId, symbol, skipIfAlreadyTagged = false } = params
  const supabase = getSupabaseClient()
  let userId = params.userId

  if (!userId) {
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError) throw new Error(`Failed to resolve user for auto theme assignment: ${authError.message}`)
    if (!authData.user?.id) throw new Error('Not authenticated')
    userId = authData.user.id
  }

  const { data: existingLinks, error: existingLinksError } = await supabase
    .from('ticker_themes')
    .select('theme_id')
    .eq('ticker_id', tickerId)
  if (existingLinksError) throw new Error(`Failed to read existing ticker themes: ${existingLinksError.message}`)
  if (skipIfAlreadyTagged && (existingLinks?.length ?? 0) > 0) {
    return EMPTY_ASSIGNMENT_RESULT
  }
  const existingLinkedThemeIds = new Set((existingLinks ?? []).map((row: any) => String(row.theme_id)))

  const { data: existingThemesRows, error: existingThemesError } = await supabase
    .from('themes')
    .select('id, name')
    .eq('user_id', userId)
  if (existingThemesError) throw new Error(`Failed to load themes for auto-tagging: ${existingThemesError.message}`)

  const existingThemeNames = (existingThemesRows ?? [])
    .map((row: any) => String(row.name ?? '').trim())
    .filter(Boolean)

  const profile = await fetchTickerProfile(symbol)
  let suggestedThemes = await suggestTickerThemesWithClaude(symbol, existingThemeNames, profile)
  if (suggestedThemes.length === 0 && profile.industry) {
    suggestedThemes = [profile.industry]
  }
  if (suggestedThemes.length === 0) return EMPTY_ASSIGNMENT_RESULT

  const themeByKey = new Map<string, { id: string; name: string }>()
  for (const row of existingThemesRows ?? []) {
    const name = String((row as any).name ?? '').trim()
    const id = String((row as any).id ?? '').trim()
    const key = normalizeThemeKey(name)
    if (name && id && key) themeByKey.set(key, { id, name })
  }

  let assignedCount = 0

  for (const suggestedName of suggestedThemes) {
    const normalizedSuggestion = normalizeThemeKey(suggestedName)
    if (!normalizedSuggestion) continue

    let themeId = themeByKey.get(normalizedSuggestion)?.id
    if (!themeId) {
      const fuzzy = [...themeByKey.entries()].find(([existingKey]) =>
        existingKey.includes(normalizedSuggestion) || normalizedSuggestion.includes(existingKey),
      )
      themeId = fuzzy?.[1].id
    }

    if (!themeId) {
      const cleanName = suggestedName.trim()
      const { data: upsertedTheme, error: upsertThemeError } = await supabase
        .from('themes')
        .upsert({ user_id: userId, name: cleanName }, { onConflict: 'user_id,name' })
        .select('id, name')
        .single()
      if (upsertThemeError) {
        throw new Error(`Failed to create auto theme "${cleanName}": ${upsertThemeError.message}`)
      }
      themeId = upsertedTheme.id
      if (themeId) {
        themeByKey.set(normalizeThemeKey(String(upsertedTheme.name ?? cleanName)), {
          id: themeId,
          name: String(upsertedTheme.name ?? cleanName),
        })
      }
    }

    if (!themeId || existingLinkedThemeIds.has(themeId)) continue

    const { error: linkError } = await supabase
      .from('ticker_themes')
      .upsert({ ticker_id: tickerId, theme_id: themeId })
    if (linkError) {
      throw new Error(`Failed to auto-link theme "${suggestedName}": ${linkError.message}`)
    }
    existingLinkedThemeIds.add(themeId)
    assignedCount += 1
  }

  return { assignedCount, suggestedThemes }
}

export async function isAutoThemeAssignmentEnabled(userId?: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  let resolvedUserId = userId

  if (!resolvedUserId) {
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError) throw new Error(`Failed to resolve user for auto-theme setting: ${authError.message}`)
    if (!authData.user?.id) throw new Error('Not authenticated')
    resolvedUserId = authData.user.id
  }

  const { data, error } = await supabase
    .from('user_settings')
    .select('auto_theme_assignment_enabled')
    .eq('user_id', resolvedUserId)
    .maybeSingle()

  if (error) {
    const message = String(error.message ?? '').toLowerCase()
    if (message.includes('auto_theme_assignment_enabled')) {
      // Backward-compat fallback while older DB schema is still in place.
      return true
    }
    throw new Error(`Failed to load auto-theme setting: ${error.message}`)
  }

  return (data as any)?.auto_theme_assignment_enabled !== false
}

export async function autoAssignThemesForTickerIfEnabled(params: {
  tickerId: string
  symbol: string
  userId?: string
  skipIfAlreadyTagged?: boolean
}) {
  const enabled = await isAutoThemeAssignmentEnabled(params.userId)
  if (!enabled) return EMPTY_ASSIGNMENT_RESULT
  return autoAssignThemesForTicker(params)
}
