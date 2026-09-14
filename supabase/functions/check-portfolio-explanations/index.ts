import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Scheduled generator for the Portfolio Performance Explanation feature.
// Invoke with no body (or { force: false }) for the hourly major-move
// sweep — only regenerates a user's explanation when their day's swing has
// moved meaningfully past what's already stored. Invoke with { force: true }
// for the once-daily market-close sweep — always regenerates (still cheap
// on a quiet day, since the no-major-move path skips the LLM/news calls).
//
// This is a self-contained Deno port of src/lib/portfolioExplanation.ts —
// edge functions can't import from src/ (same reason check-vests ports the
// RSU vesting math). Keep the two in sync. See CLAUDE.md for the full
// design and the token-efficiency rules each gate below implements.

const MOVER_COVERAGE_TARGET = 0.7
const MAX_MOVERS = 5
const MAJOR_MOVE_STOCK_PCT = 5
const MAJOR_MOVE_PORTFOLIO_PCT = 1
const REGENERATION_HYSTERESIS_PCT = 0.75
const NOISE_BAND_PCT = 0.3
const BROAD_MOVE_MIN_POSITIONS = 3
const BROAD_MOVE_MAJORITY = 0.6

const MODEL_FOR_PROVIDER: Record<string, string> = {
  claude: 'claude-sonnet-5',
  groq: 'llama-3.3-70b-versatile',
}

const EXPLANATION_SYSTEM_PROMPT = `You explain a user's investment portfolio's daily performance in plain English.
Rules:
- Use ONLY the facts given below. Never invent a cause, headline, or number.
- Write 2-4 sentences, no preamble, no markdown.
- Mention specific ticker symbols and theme names by name where relevant (so the app can highlight them) — don't paraphrase them away.
- If headlines are provided for a mover or the market, briefly weave in the likely cause; if none are provided for something, just report the numbers.
- Distinguish company-specific moves from theme-wide or broad-market moves when the facts show that pattern.`

// ── Portfolio value math (ported from src/lib/portfolio.ts) ────────────────
function netCount(t: any): number {
  return Math.max(0, Number(t.count) - Number(t.sold_at_vest ?? 0))
}

function isTradableFixedIncome(asset: any): boolean {
  return asset.asset_type === 'Fixed Income' && (asset.fixed_income_subtype === 'Bond' || asset.fixed_income_subtype === 'T-Bill')
}

function computeFixedIncomeCostBasis(asset: any): number {
  const raw = (asset.fixed_income_lots ?? []).reduce((sum: number, lot: any) => sum + Number(lot.count) * Number(lot.cost_price), 0)
  return Math.round(raw * 100) / 100
}

function computeShareCount(asset: any): number {
  return (asset.stock_subtypes ?? []).flatMap((st: any) => st.transactions ?? [])
    .reduce((sum: number, t: any) => sum + netCount(t), 0)
}

function computeAssetValue(asset: any): number {
  if (asset.asset_type === 'Stock') {
    if (asset.ticker?.current_price == null) return 0
    return Math.round(asset.ticker.current_price * computeShareCount(asset) * 100) / 100
  }
  if (isTradableFixedIncome(asset) && (asset.fixed_income_lots?.length ?? 0) > 0) {
    return computeFixedIncomeCostBasis(asset)
  }
  return asset.price ?? 0
}

function computeTotalNetWorth(assets: any[]): number {
  return assets.reduce((sum, a) => sum + computeAssetValue(a), 0)
}

function computeDailyChange(asset: any): { dollarChange: number; percentChange: number } | null {
  if (asset.asset_type !== 'Stock') return null
  const currentPrice = asset.ticker?.current_price
  const previousClose = asset.ticker?.previous_close
  if (currentPrice == null || previousClose == null || previousClose === 0) return null
  const shares = computeShareCount(asset)
  if (shares <= 0) return null
  const priceDelta = currentPrice - previousClose
  return {
    dollarChange: Math.round(priceDelta * shares * 100) / 100,
    percentChange: (priceDelta / previousClose) * 100,
  }
}

// ── Movers / theme / breadth attribution (ported from portfolioExplanation.ts) ──
function tickerThemeNames(asset: any): string[] {
  const raw = (asset.ticker?.ticker_themes ?? [])
    .map((tt: any) => String(tt?.theme?.name ?? '').trim())
    .filter((name: string) => name.length > 0)
  return Array.from(new Set<string>(raw))
}

function computeSymbolMoves(assets: any[]) {
  const bySymbol = new Map<string, any>()
  for (const asset of assets) {
    if (asset.asset_type !== 'Stock') continue
    const symbol = asset.ticker?.symbol
    if (!symbol) continue
    if (computeShareCount(asset) <= 0) continue
    const change = computeDailyChange(asset)
    if (!change) continue

    const existing = bySymbol.get(symbol)
    if (existing) {
      existing.dollarChange += change.dollarChange
      continue
    }
    bySymbol.set(symbol, {
      symbol,
      name: String(asset.name ?? symbol),
      dollarChange: change.dollarChange,
      percentChange: change.percentChange,
      themes: tickerThemeNames(asset),
    })
  }
  return [...bySymbol.values()]
}

function detectThemeMoves(symbolMoves: any[]) {
  const byTheme = new Map<string, any[]>()
  for (const move of symbolMoves) {
    for (const theme of move.themes) {
      if (!byTheme.has(theme)) byTheme.set(theme, [])
      byTheme.get(theme)!.push(move)
    }
  }

  const result: any[] = []
  for (const [theme, members] of byTheme) {
    if (members.length < BROAD_MOVE_MIN_POSITIONS) continue
    const avgPercentChange = members.reduce((sum, m) => sum + m.percentChange, 0) / members.length
    const direction = avgPercentChange >= 0 ? 'up' : 'down'
    const agreeing = members.filter((m) =>
      Math.abs(m.percentChange) >= NOISE_BAND_PCT && Math.sign(m.percentChange) === Math.sign(avgPercentChange),
    )
    if (agreeing.length / members.length < BROAD_MOVE_MAJORITY) continue
    result.push({
      theme,
      direction,
      avgPercentChange: Math.round(avgPercentChange * 100) / 100,
      memberSymbols: members.map((m) => m.symbol),
    })
  }
  return result
}

function computeMovers(assets: any[], netWorth: number) {
  const symbolMoves = computeSymbolMoves(assets)
  const dayChangeDollars = Math.round(symbolMoves.reduce((sum, m) => sum + m.dollarChange, 0) * 100) / 100
  const dayChangePercent = netWorth > 0 ? (dayChangeDollars / netWorth) * 100 : 0

  const totalAbsSwing = symbolMoves.reduce((sum, m) => sum + Math.abs(m.dollarChange), 0)
  const ranked = [...symbolMoves].sort((a, b) => Math.abs(b.dollarChange) - Math.abs(a.dollarChange))

  const themeMoves = detectThemeMoves(symbolMoves)
  const themeMemberSymbols = new Set(themeMoves.flatMap((t) => t.memberSymbols))

  const overallDirection = Math.sign(dayChangeDollars)
  const agreeingWithOverall = symbolMoves.filter((m) =>
    overallDirection !== 0 && Math.abs(m.percentChange) >= NOISE_BAND_PCT && Math.sign(m.percentChange) === overallDirection,
  )
  const isBroadMarketMove =
    symbolMoves.length >= BROAD_MOVE_MIN_POSITIONS &&
    overallDirection !== 0 &&
    agreeingWithOverall.length / symbolMoves.length >= BROAD_MOVE_MAJORITY

  const selected: any[] = []
  let coveredAbs = 0
  for (const move of ranked) {
    if (selected.length >= MAX_MOVERS) break
    selected.push(move)
    coveredAbs += Math.abs(move.dollarChange)
    if (coveredAbs / (totalAbsSwing || 1) >= MOVER_COVERAGE_TARGET) break
  }
  const selectedSymbols = new Set(selected.map((m) => m.symbol))
  for (const move of ranked) {
    if (themeMemberSymbols.has(move.symbol) && !selectedSymbols.has(move.symbol)) {
      selected.push(move)
      selectedSymbols.add(move.symbol)
    }
  }

  const themeBySymbol = new Map<string, string>()
  for (const t of themeMoves) {
    for (const symbol of t.memberSymbols) if (!themeBySymbol.has(symbol)) themeBySymbol.set(symbol, t.theme)
  }

  const movers = selected.map((move) => ({
    symbol: move.symbol,
    name: move.name,
    dollarChange: Math.round(move.dollarChange * 100) / 100,
    percentChange: Math.round(move.percentChange * 100) / 100,
    contributionPct: totalAbsSwing > 0 ? Math.round((Math.abs(move.dollarChange) / totalAbsSwing) * 1000) / 10 : 0,
    ...(themeBySymbol.has(move.symbol) ? { theme: themeBySymbol.get(move.symbol) } : {}),
    headlines: [] as any[],
  }))

  const hasMajorMove =
    movers.some((m) => Math.abs(m.percentChange) >= MAJOR_MOVE_STOCK_PCT) ||
    Math.abs(dayChangePercent) >= MAJOR_MOVE_PORTFOLIO_PCT

  return { movers, dayChangeDollars, dayChangePercent, hasMajorMove, isBroadMarketMove, themeMoves }
}

function shouldRegenerate(current: { dayChangePercent: number }, last: any): boolean {
  if (!last) return true
  const prevPct = Number(last.day_change_percent ?? 0)
  const currPct = current.dayChangePercent
  const signFlipped = prevPct !== 0 && currPct !== 0 && Math.sign(prevPct) !== Math.sign(currPct)
  return signFlipped || Math.abs(currPct - prevPct) >= REGENERATION_HYSTERESIS_PCT
}

function fmtDollars(n: number): string {
  const sign = n >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function fmtPercent(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function buildStaticNoMoveSummary(dayChangeDollars: number, dayChangePercent: number): string {
  if (Math.abs(dayChangeDollars) < 1) return 'No major moves today — your portfolio held steady.'
  return `No major moves today — your portfolio was ${fmtDollars(dayChangeDollars)} (${fmtPercent(dayChangePercent)}), within normal day-to-day movement.`
}

function buildExplanationUserPrompt(movers: any[], dayChangeDollars: number, dayChangePercent: number, themeMoves: any[], marketHeadlines: any[]): string {
  const lines: string[] = []
  lines.push(`Portfolio day change: ${fmtDollars(dayChangeDollars)} (${fmtPercent(dayChangePercent)}).`)

  lines.push('Movers:')
  for (const m of movers) {
    const headlineText = m.headlines.length
      ? ` Headlines: ${m.headlines.map((h: any) => `"${h.title}" (${h.source})`).join('; ')}`
      : ''
    lines.push(`- ${m.symbol} (${m.name}): ${fmtDollars(m.dollarChange)} (${fmtPercent(m.percentChange)}), ${m.contributionPct}% of today's swing.${headlineText}`)
  }

  if (themeMoves.length > 0) {
    lines.push('Theme moves:')
    for (const t of themeMoves) {
      lines.push(`- ${t.theme}: ${t.memberSymbols.length} holdings moved ${t.direction} together, avg ${fmtPercent(t.avgPercentChange)} (${t.memberSymbols.join(', ')}).`)
    }
  }

  if (marketHeadlines.length > 0) {
    lines.push('Market context:')
    for (const h of marketHeadlines) lines.push(`- "${h.title}" (${h.source})`)
  }

  return lines.join('\n')
}

function trimHeadlines(raw: any[], limit: number) {
  return raw
    .filter((a) => a && a.headline)
    .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
    .slice(0, limit)
    .map((a) => ({ title: String(a.headline), source: String(a.source ?? ''), url: String(a.url ?? ''), datetime: Number(a.datetime ?? 0) }))
}

async function fetchMoverHeadlines(symbols: string[], finnhubApiKey: string) {
  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const result = new Map<string, any[]>()
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${weekAgo}&to=${today}&token=${finnhubApiKey}`)
      const raw = await res.json()
      if (Array.isArray(raw)) result.set(symbol, trimHeadlines(raw, 2))
    } catch { /* best-effort */ }
  }))
  return result
}

async function fetchMarketHeadlines(finnhubApiKey: string) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${finnhubApiKey}`)
    const raw = await res.json()
    return Array.isArray(raw) ? trimHeadlines(raw, 2) : []
  } catch {
    return []
  }
}

// ── LLM calls — raw fetch, no SDK, matching every other edge function here ──
async function callClaude(apiKey: string, model: string, systemPrompt: string, userPrompt: string, maxTokens: number) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      output_config: { effort: 'low' },
    }),
  })
  const data = await res.json()
  const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  const usage = data.usage
    ? { inputTokens: data.usage.input_tokens ?? 0, outputTokens: data.usage.output_tokens ?? 0 }
    : { inputTokens: 0, outputTokens: 0 }
  return { text, usage }
}

async function callGroq(apiKey: string, model: string, systemPrompt: string, userPrompt: string, maxTokens: number) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    }),
  })
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content ?? ''
  const usage = data.usage
    ? { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 }
    : { inputTokens: 0, outputTokens: 0 }
  return { text, usage }
}

Deno.serve(async (req) => {
  let force = false
  try {
    const body = await req.json()
    force = body?.force === true
  } catch { /* no/invalid body — treat as the hourly major-move sweep */ }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: settingsRows } = await supabase
    .from('user_settings')
    .select('*')
    .eq('portfolio_explanation_enabled', true)

  let processed = 0
  let generated = 0

  for (const userSettings of settingsRows ?? []) {
    processed++
    const userId = userSettings.user_id
    try {
      const { data: assets } = await supabase
        .from('assets')
        .select(`
          *,
          ticker:tickers(*, ticker_themes(theme:themes(*))),
          stock_subtypes(*, transactions(*)),
          fixed_income_lots(*)
        `)
        .eq('user_id', userId)
      if (!assets) continue

      const netWorth = computeTotalNetWorth(assets)
      const result = computeMovers(assets, netWorth)

      const { data: existing } = await supabase
        .from('portfolio_explanations')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()

      if (!force && existing && !shouldRegenerate(result, existing)) continue

      const trigger = force ? 'market_close' : 'major_move'

      if (!result.hasMajorMove) {
        await supabase.from('portfolio_explanations').upsert({
          user_id: userId,
          summary: buildStaticNoMoveSummary(result.dayChangeDollars, result.dayChangePercent),
          has_major_moves: false,
          day_change_dollars: result.dayChangeDollars,
          day_change_percent: result.dayChangePercent,
          basis_net_worth: netWorth,
          movers: [],
          is_broad_market_move: false,
          market_headlines: [],
          theme_moves: [],
          trigger,
          input_tokens: null,
          output_tokens: null,
        }, { onConflict: 'user_id' })
        generated++
        continue
      }

      const provider = userSettings.llm_provider === 'groq' ? 'groq' : 'claude'
      const apiKey = provider === 'groq' ? userSettings.groq_api_key : userSettings.claude_api_key
      if (!apiKey) continue

      const finnhubKey = userSettings.finnhub_api_key
      const [headlinesBySymbol, marketHeadlines] = await Promise.all([
        finnhubKey ? fetchMoverHeadlines(result.movers.map((m: any) => m.symbol), finnhubKey) : Promise.resolve(new Map()),
        finnhubKey && result.isBroadMarketMove ? fetchMarketHeadlines(finnhubKey) : Promise.resolve([]),
      ])
      const movers = result.movers.map((m: any) => ({ ...m, headlines: (headlinesBySymbol as Map<string, any[]>).get(m.symbol) ?? [] }))

      const model = MODEL_FOR_PROVIDER[provider]
      const prompt = buildExplanationUserPrompt(movers, result.dayChangeDollars, result.dayChangePercent, result.themeMoves, marketHeadlines)
      const { text, usage } = provider === 'claude'
        ? await callClaude(apiKey, model, EXPLANATION_SYSTEM_PROMPT, prompt, 220)
        : await callGroq(apiKey, model, EXPLANATION_SYSTEM_PROMPT, prompt, 220)

      const summary = text.trim() || buildStaticNoMoveSummary(result.dayChangeDollars, result.dayChangePercent)

      await supabase.from('portfolio_explanations').upsert({
        user_id: userId,
        summary,
        has_major_moves: true,
        day_change_dollars: result.dayChangeDollars,
        day_change_percent: result.dayChangePercent,
        basis_net_worth: netWorth,
        movers,
        is_broad_market_move: result.isBroadMarketMove,
        market_headlines: marketHeadlines,
        theme_moves: result.themeMoves,
        trigger,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
      }, { onConflict: 'user_id' })

      await supabase.from('llm_usage_log').insert({
        user_id: userId,
        feature: 'portfolio_explanation',
        provider,
        model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
      })

      generated++
    } catch (err) {
      console.error(`check-portfolio-explanations failed for user ${userId}`, err)
    }
  }

  return new Response(JSON.stringify({ ok: true, processed, generated }))
})
