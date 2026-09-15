// Portfolio Performance Explanation — see CLAUDE.md for the full design.
//
// Everything that can be computed from data already in memory (which
// holdings moved, how much, whether that's a theme-wide or market-wide
// pattern) is pure JS here — the LLM is only ever handed a short digest of
// the result and asked to phrase it into prose. The full explanation is
// generated ONLY on demand (a user opening it from the Home page teaser),
// never by a background job — `buildTeaser` (the Home page card's one-line
// hook) needs no LLM call at all, it's derived straight from computeMovers.

import { getAllAssets } from './db/assets'
import {
  getPortfolioExplanation,
  upsertPortfolioExplanation,
  type PortfolioExplanationHeadline,
  type PortfolioExplanationMover,
  type PortfolioExplanationRow,
  type PortfolioExplanationThemeMove,
} from './db/portfolioExplanations'
import { logLlmUsage } from './db/llmUsage'
import { computeDailyChange, computeShareCount, computeTotalNetWorth } from './portfolio'
import { createLLMClient, MODEL_FOR_PROVIDER } from './llm'
import { config } from '@/store/config'

// ── Tunable constants ─────────────────────────────────────────────────────
/** Fraction of the day's total absolute swing the mover list should cover. */
export const MOVER_COVERAGE_TARGET = 0.7
export const MAX_MOVERS = 5
/** A single holding's own move big enough to call out regardless of its
 *  portfolio-level weight (mirrors the default price_alert_threshold). */
export const MAJOR_MOVE_STOCK_PCT = 5
/** Aggregate portfolio swing big enough to count as a "major move" on its
 *  own, even with no single outsized holding. */
export const MAJOR_MOVE_PORTFOLIO_PCT = 1
/** Percentage-point change (or a sign flip) in the day's swing since the
 *  last generation before it's worth spending another LLM call. */
export const REGENERATION_HYSTERESIS_PCT = 0.75
/** Below this, a holding's move is noise for breadth/theme purposes. */
export const NOISE_BAND_PCT = 0.3
export const BROAD_MOVE_MIN_POSITIONS = 3
export const BROAD_MOVE_MAJORITY = 0.6
/** A single mover dominant enough to name directly in the teaser/prompt
 *  rather than talking about "N holdings" in the abstract. */
export const DOMINANT_MOVER_CONTRIBUTION_PCT = 50

/** The user turn seeded into the command bar when opening the explanation
 *  from the Home page teaser — shared so the teaser's click handler and the
 *  command bar's handling of it agree on the exact text. */
export const EXPLANATION_TRIGGER_QUESTION = 'Why is my portfolio moving?'

export interface SymbolMove {
  symbol: string
  name: string
  dollarChange: number
  percentChange: number
  themes: string[]
}

export interface MoversResult {
  movers: PortfolioExplanationMover[]
  dayChangeDollars: number
  dayChangePercent: number
  hasMajorMove: boolean
  isBroadMarketMove: boolean
  themeMoves: PortfolioExplanationThemeMove[]
}

function tickerThemeNames(asset: any): string[] {
  const raw = (asset.ticker?.ticker_themes ?? [])
    .map((tt: any) => String(tt?.theme?.name ?? '').trim())
    .filter((name: string) => name.length > 0)
  return Array.from(new Set<string>(raw))
}

/** One entry per distinct stock symbol (assets holding the same ticker in
 *  different accounts move identically, since the move is price-only —
 *  dedupe so they aren't double-counted for breadth/theme detection). */
function computeSymbolMoves(assets: any[]): SymbolMove[] {
  const bySymbol = new Map<string, SymbolMove>()
  for (const asset of assets) {
    if (asset.asset_type !== 'Stock') continue
    const symbol = asset.ticker?.symbol
    if (!symbol) continue
    const shares = computeShareCount(asset)
    if (shares <= 0) continue
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

function detectThemeMoves(symbolMoves: SymbolMove[]): PortfolioExplanationThemeMove[] {
  const byTheme = new Map<string, SymbolMove[]>()
  for (const move of symbolMoves) {
    for (const theme of move.themes) {
      if (!byTheme.has(theme)) byTheme.set(theme, [])
      byTheme.get(theme)!.push(move)
    }
  }

  const result: PortfolioExplanationThemeMove[] = []
  for (const [theme, members] of byTheme) {
    if (members.length < BROAD_MOVE_MIN_POSITIONS) continue
    const avgPercentChange = members.reduce((sum, m) => sum + m.percentChange, 0) / members.length
    const direction: 'up' | 'down' = avgPercentChange >= 0 ? 'up' : 'down'
    const agreeing = members.filter(m =>
      Math.abs(m.percentChange) >= NOISE_BAND_PCT && Math.sign(m.percentChange) === Math.sign(avgPercentChange),
    )
    if (agreeing.length / members.length < BROAD_MOVE_MAJORITY) continue
    result.push({
      theme,
      direction,
      avgPercentChange: Math.round(avgPercentChange * 100) / 100,
      memberSymbols: members.map(m => m.symbol),
    })
  }
  return result
}

/** The core attribution pass: ranks movers, and derives both the
 *  theme-cluster and whole-market breadth signals from the same per-symbol
 *  data — see CLAUDE.md's token-efficiency notes for why each tier only
 *  fires (or fetches supporting news) when its own condition is met. */
export function computeMovers(assets: any[], netWorth: number): MoversResult {
  const symbolMoves = computeSymbolMoves(assets)
  const dayChangeDollars = Math.round(symbolMoves.reduce((sum, m) => sum + m.dollarChange, 0) * 100) / 100
  const dayChangePercent = netWorth > 0 ? (dayChangeDollars / netWorth) * 100 : 0

  const totalAbsSwing = symbolMoves.reduce((sum, m) => sum + Math.abs(m.dollarChange), 0)
  const ranked = [...symbolMoves].sort((a, b) => Math.abs(b.dollarChange) - Math.abs(a.dollarChange))

  const themeMoves = detectThemeMoves(symbolMoves)
  const themeMemberSymbols = new Set(themeMoves.flatMap(t => t.memberSymbols))

  const overallDirection = Math.sign(dayChangeDollars)
  const agreeingWithOverall = symbolMoves.filter(m =>
    overallDirection !== 0 && Math.abs(m.percentChange) >= NOISE_BAND_PCT && Math.sign(m.percentChange) === overallDirection,
  )
  const isBroadMarketMove =
    symbolMoves.length >= BROAD_MOVE_MIN_POSITIONS &&
    overallDirection !== 0 &&
    agreeingWithOverall.length / symbolMoves.length >= BROAD_MOVE_MAJORITY

  // Top movers by $ contribution, covering the coverage target (capped),
  // widened to include every member of a flagged theme cluster so a theme
  // mention always has constituent numbers to show on click.
  const selected: SymbolMove[] = []
  let coveredAbs = 0
  for (const move of ranked) {
    if (selected.length >= MAX_MOVERS) break
    selected.push(move)
    coveredAbs += Math.abs(move.dollarChange)
    if (coveredAbs / (totalAbsSwing || 1) >= MOVER_COVERAGE_TARGET) break
  }
  // Widen beyond the cap/coverage cutoff to include every member of a
  // flagged theme cluster, so a theme mention always has constituent
  // numbers to show on click (see CLAUDE.md).
  const selectedSymbols = new Set(selected.map(m => m.symbol))
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

  const movers: PortfolioExplanationMover[] = selected.map(move => ({
    symbol: move.symbol,
    name: move.name,
    dollarChange: Math.round(move.dollarChange * 100) / 100,
    percentChange: Math.round(move.percentChange * 100) / 100,
    contributionPct: totalAbsSwing > 0 ? Math.round((Math.abs(move.dollarChange) / totalAbsSwing) * 1000) / 10 : 0,
    ...(themeBySymbol.has(move.symbol) ? { theme: themeBySymbol.get(move.symbol) } : {}),
    headlines: [],
  }))

  const hasMajorMove =
    movers.some(m => Math.abs(m.percentChange) >= MAJOR_MOVE_STOCK_PCT) ||
    Math.abs(dayChangePercent) >= MAJOR_MOVE_PORTFOLIO_PCT

  return { movers, dayChangeDollars, dayChangePercent, hasMajorMove, isBroadMarketMove, themeMoves }
}

/** Calendar-day key used as a (deliberately simple) stand-in for "which
 *  market session are we in" — the same UTC-date granularity already used
 *  elsewhere in this app for "daily" things (net_worth_snapshots.date,
 *  tickers.last_updated), not a timezone-aware NYSE-open calculation. */
export function todayMarketDate(): string {
  return new Date().toISOString().split('T')[0]
}

/** The set of holdings crossing the individual-mover bar — the "stock
 *  level" for staleness/change comparisons below. Works the same whether
 *  fed a fresh MoversResult.movers or a stored row's movers, since both
 *  are PortfolioExplanationMover[]. */
function significantMoverSymbols(movers: PortfolioExplanationMover[]): Set<string> {
  return new Set(movers.filter(m => Math.abs(m.percentChange) >= MAJOR_MOVE_STOCK_PCT).map(m => m.symbol))
}

function themeNameSet(themeMoves: { theme: string }[]): Set<string> {
  return new Set(themeMoves.map(t => t.theme))
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

/** Whether it's worth spending another LLM call given what's already
 *  stored — checked at three independent levels, any one of which is
 *  enough on its own (see CLAUDE.md):
 *  - market day: the stored explanation is from a prior market session
 *    (reset every market open) regardless of how the numbers compare.
 *  - portfolio: today's aggregate swing has moved meaningfully past what's
 *    stored, or flipped sign (REGENERATION_HYSTERESIS_PCT).
 *  - stock / sector: the *set* of individually-significant movers, or of
 *    flagged theme moves, differs from what's stored — a new holding or
 *    sector joining the story (or one dropping out of it) is a change
 *    even if the aggregate swing happens to look similar.
 *  A `force` regenerate bypasses this entirely (see
 *  generatePortfolioExplanation). */
export function shouldRegenerate(current: MoversResult, last: PortfolioExplanationRow | null): boolean {
  if (!last) return true
  if (last.market_date !== todayMarketDate()) return true

  const prevPct = Number(last.day_change_percent ?? 0)
  const currPct = current.dayChangePercent
  const signFlipped = prevPct !== 0 && currPct !== 0 && Math.sign(prevPct) !== Math.sign(currPct)
  if (signFlipped || Math.abs(currPct - prevPct) >= REGENERATION_HYSTERESIS_PCT) return true

  if (!setsEqual(significantMoverSymbols(current.movers), significantMoverSymbols(last.movers ?? []))) return true
  if (!setsEqual(themeNameSet(current.themeMoves), themeNameSet(last.theme_moves ?? []))) return true

  return false
}

function fmtDollars(n: number): string {
  const sign = n >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function fmtPercent(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

/** The "nothing to report" case — zero tokens, zero news calls. */
export function buildStaticNoMoveSummary(dayChangeDollars: number, dayChangePercent: number): string {
  if (Math.abs(dayChangeDollars) < 1) {
    return 'No major moves today — your portfolio held steady.'
  }
  return `No major moves today — your portfolio was ${fmtDollars(dayChangeDollars)} (${fmtPercent(dayChangePercent)}), within normal day-to-day movement.`
}

/** The Home page card's one-line hook — entirely deterministic (no LLM
 *  call; one cheap DB read for `previous` so it can tell "new" from
 *  "unchanged"), built straight from computeMovers' output. Returns null
 *  when there's nothing worth surfacing (computeMovers.hasMajorMove is
 *  false), in which case the card renders nothing at all.
 *
 *  When `previous` is the same market day's explanation and is now stale
 *  (shouldRegenerate), the wording calls out specifically what's new
 *  since it was generated — a new sector, a new mover, or (if neither)
 *  just the changed swing — rather than repeating a generic line that
 *  might describe the same story the user already read. Otherwise (first
 *  time today, or nothing's changed) picks whichever generic framing fits:
 *  - one holding dominates the swing → name it directly ("CRM moved …")
 *  - several holdings individually crossed the per-stock bar → count them
 *  - otherwise it's the aggregate swing carrying the story on its own */
export function buildTeaser(result: MoversResult, previous?: PortfolioExplanationRow | null): string | null {
  if (!result.hasMajorMove) return null

  const sameDayPrevious = previous && previous.market_date === todayMarketDate() ? previous : null
  if (sameDayPrevious && shouldRegenerate(result, sameDayPrevious)) {
    const newThemes = [...themeNameSet(result.themeMoves)].filter(t => !themeNameSet(sameDayPrevious.theme_moves ?? []).has(t))
    if (newThemes.length > 0) {
      return `New activity in ${newThemes.join(', ')} since your last check. Want an updated explanation?`
    }
    const newSymbols = [...significantMoverSymbols(result.movers)].filter(s => !significantMoverSymbols(sameDayPrevious.movers ?? []).has(s))
    if (newSymbols.length > 0) {
      return `${newSymbols.join(', ')} just moved. Want an updated explanation?`
    }
    return `Your portfolio's move has changed since your last check. Want an updated explanation?`
  }

  const significantMovers = result.movers.filter(m => Math.abs(m.percentChange) >= MAJOR_MOVE_STOCK_PCT)
  const dominant = significantMovers.length === 1 && significantMovers[0].contributionPct >= DOMINANT_MOVER_CONTRIBUTION_PCT
    ? significantMovers[0]
    : null

  if (dominant) {
    return `${dominant.symbol} moved ${fmtPercent(dominant.percentChange)} today. Want to know why?`
  }
  if (significantMovers.length >= 2) {
    return `${significantMovers.length} items in your portfolio moved substantially today. Want to know why?`
  }
  const direction = result.dayChangeDollars >= 0 ? 'up' : 'down'
  return `Your portfolio went ${direction} ${Math.abs(result.dayChangePercent).toFixed(2)}% today. Want to know why?`
}

export const EXPLANATION_SYSTEM_PROMPT = `You explain a user's investment portfolio's daily performance in plain English.
Rules:
- Use ONLY the facts given below. Never invent a cause, headline, or number.
- Write 2-4 sentences, no preamble, no markdown.
- Mention specific ticker symbols and theme names by name where relevant (so the app can highlight them) — don't paraphrase them away.
- If headlines are provided for a mover or the market, briefly weave in the likely cause; if none are provided for something, just report the numbers.
- Distinguish company-specific moves from theme-wide or broad-market moves when the facts show that pattern.
- If an earlier update from today is given, this is a refresh of it, not a brand new answer: keep whatever from it is still relevant (don't silently drop a still-current position or theme just because it isn't repeated below), and clearly work in what's new. Don't just concatenate the two — write one coherent update. If something from the earlier update is no longer reflected in today's facts below, drop it.`

export function buildExplanationUserPrompt(
  movers: PortfolioExplanationMover[],
  dayChangeDollars: number,
  dayChangePercent: number,
  themeMoves: PortfolioExplanationThemeMove[],
  marketHeadlines: PortfolioExplanationHeadline[],
  previousSummary?: string,
): string {
  const lines: string[] = []
  if (previousSummary) {
    lines.push(`Earlier update from today: "${previousSummary}"`)
    lines.push('')
    lines.push('Current facts (may supersede parts of the earlier update):')
  }
  lines.push(`Portfolio day change: ${fmtDollars(dayChangeDollars)} (${fmtPercent(dayChangePercent)}).`)

  lines.push('Movers:')
  for (const m of movers) {
    const headlineText = m.headlines.length
      ? ` Headlines: ${m.headlines.map(h => `"${h.title}" (${h.source})`).join('; ')}`
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
    for (const h of marketHeadlines) {
      lines.push(`- "${h.title}" (${h.source})`)
    }
  }

  return lines.join('\n')
}

/** Appends a deterministic, clickable "Sources" list to the LLM's summary —
 *  built from the headline data we already fetched, never from anything
 *  the model wrote, so a link is always exactly the URL Finnhub gave us
 *  (the LLM is never shown URLs in the first place, only titles/sources,
 *  per buildExplanationUserPrompt — it has no URL to get wrong or invent).
 *  Rendered as markdown links by CommandBar's parseInlineMd. Deduped by
 *  URL since a headline could in principle surface for more than one
 *  mover. Returns the summary unchanged when there's nothing to cite. */
export function appendSources(summary: string, movers: PortfolioExplanationMover[], marketHeadlines: PortfolioExplanationHeadline[]): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const h of [...movers.flatMap(m => m.headlines), ...marketHeadlines]) {
    if (!h.url || seen.has(h.url)) continue
    seen.add(h.url)
    lines.push(`- [${h.title}](${h.url})${h.source ? ` — ${h.source}` : ''}`)
  }
  if (lines.length === 0) return summary
  return `${summary}\n\nSources:\n${lines.join('\n')}`
}

/** The inverse of appendSources — strips the "Sources" list back off
 *  before feeding a stored summary to the LLM as prior-context (its links
 *  are deterministic and get rebuilt fresh from the current headline set
 *  regardless; there's no reason to spend tokens re-showing them, and the
 *  model was never the one that wrote them in the first place). */
export function stripSources(summary: string): string {
  return summary.split(/\n\nSources:\n/)[0]
}

function trimHeadlines(raw: any[], limit: number): PortfolioExplanationHeadline[] {
  return raw
    .filter(a => a && a.headline)
    .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
    .slice(0, limit)
    .map(a => ({ title: String(a.headline), source: String(a.source ?? ''), url: String(a.url ?? ''), datetime: Number(a.datetime ?? 0) }))
}

/** Best-effort per-mover company news — only ever called for the (≤5)
 *  actual movers, never the rest of the portfolio, and only when there's a
 *  major move to explain in the first place. */
export async function fetchMoverHeadlines(symbols: string[], finnhubApiKey: string): Promise<Map<string, PortfolioExplanationHeadline[]>> {
  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const result = new Map<string, PortfolioExplanationHeadline[]>()
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${weekAgo}&to=${today}&token=${finnhubApiKey}`)
      const raw = await res.json()
      if (Array.isArray(raw)) result.set(symbol, trimHeadlines(raw, 2))
    } catch { /* best-effort — a missing headline just means no citation for that mover */ }
  }))
  return result
}

/** Best-effort general market news — only called when computeMovers has
 *  already flagged isBroadMarketMove, i.e. a majority of holdings moved
 *  together (see CLAUDE.md). */
export async function fetchMarketHeadlines(finnhubApiKey: string): Promise<PortfolioExplanationHeadline[]> {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${finnhubApiKey}`)
    const raw = await res.json()
    return Array.isArray(raw) ? trimHeadlines(raw, 2) : []
  } catch {
    return []
  }
}

/** Browser-only orchestration, called only when the user asks for it (the
 *  Home page teaser opening a command bar session — see
 *  CommandBar.tsx/commandBarBridge.ts): loads the portfolio, reuses the
 *  stored explanation if it's still from today's market session and
 *  nothing material has moved since (shouldRegenerate), otherwise
 *  regenerates — fetching supporting headlines only when there's actually
 *  something to explain. There is no background/scheduled path anymore;
 *  every call here is inherently "manual" (a user opened it), `force`
 *  exists only to bypass the cache-reuse check outright if ever needed. */
export async function generatePortfolioExplanation(options: { force?: boolean } = {}): Promise<PortfolioExplanationRow> {
  const { force = false } = options
  const assets = await getAllAssets()
  const netWorth = computeTotalNetWorth(assets)
  const result = computeMovers(assets, netWorth)

  const existing = await getPortfolioExplanation()
  // shouldRegenerate always returns true when `existing` is null, so this
  // branch is only reachable with a non-null row to fall back to.
  if (!force && existing && !shouldRegenerate(result, existing)) {
    return existing
  }

  const marketDate = todayMarketDate()

  if (!result.hasMajorMove) {
    return upsertPortfolioExplanation({
      summary: buildStaticNoMoveSummary(result.dayChangeDollars, result.dayChangePercent),
      has_major_moves: false,
      day_change_dollars: result.dayChangeDollars,
      day_change_percent: result.dayChangePercent,
      basis_net_worth: netWorth,
      movers: [],
      is_broad_market_move: false,
      market_headlines: [],
      theme_moves: [],
      trigger: 'manual',
      market_date: marketDate,
      input_tokens: null,
      output_tokens: null,
    })
  }

  const finnhubKey = config.finnhubApiKey
  const [headlinesBySymbol, marketHeadlines] = await Promise.all([
    finnhubKey ? fetchMoverHeadlines(result.movers.map(m => m.symbol), finnhubKey) : Promise.resolve(new Map<string, PortfolioExplanationHeadline[]>()),
    finnhubKey && result.isBroadMarketMove ? fetchMarketHeadlines(finnhubKey) : Promise.resolve([]),
  ])
  const movers = result.movers.map(m => ({ ...m, headlines: headlinesBySymbol.get(m.symbol) ?? [] }))

  // Carry the still-relevant parts of an earlier update from today forward
  // rather than replacing it outright (see CLAUDE.md) — only within the
  // same market day; a prior day's story has nothing to do with today's.
  const previousSummary = existing && existing.has_major_moves && existing.market_date === marketDate
    ? stripSources(existing.summary)
    : undefined

  const prompt = buildExplanationUserPrompt(movers, result.dayChangeDollars, result.dayChangePercent, result.themeMoves, marketHeadlines, previousSummary)
  const client = createLLMClient(config.llmProvider, config.activeApiKey)
  const model = MODEL_FOR_PROVIDER[config.llmProvider]
  const response = await client.chat.completions.create({
    model,
    max_tokens: 220,
    messages: [
      { role: 'system', content: EXPLANATION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    ...(config.llmProvider === 'claude' ? { output_config: { effort: 'low' as const } } : {}),
  })
  const rawSummary = response.choices[0]?.message?.content?.trim() || buildStaticNoMoveSummary(result.dayChangeDollars, result.dayChangePercent)
  const summary = appendSources(rawSummary, movers, marketHeadlines)
  const inputTokens = response.usage?.inputTokens ?? null
  const outputTokens = response.usage?.outputTokens ?? null

  const saved = await upsertPortfolioExplanation({
    summary,
    has_major_moves: true,
    day_change_dollars: result.dayChangeDollars,
    day_change_percent: result.dayChangePercent,
    basis_net_worth: netWorth,
    movers,
    is_broad_market_move: result.isBroadMarketMove,
    market_headlines: marketHeadlines,
    theme_moves: result.themeMoves,
    trigger: 'manual',
    market_date: marketDate,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  })

  void logLlmUsage({
    feature: 'portfolio_explanation',
    provider: config.llmProvider,
    model,
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  })

  return saved
}
