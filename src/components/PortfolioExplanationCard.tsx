import { useEffect, useMemo, useState, Fragment } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, RefreshCw, ExternalLink } from 'lucide-react'
import { getUserSettings } from '@/lib/db/settings'
import { getPortfolioExplanation, type PortfolioExplanationRow, type PortfolioExplanationMover } from '@/lib/db/portfolioExplanations'
import { generatePortfolioExplanation } from '@/lib/portfolioExplanation'
import { saveConversation } from '@/lib/db/conversations'
import { resumeConversationInCommandBar } from '@/lib/commandBarBridge'
import { revealUp } from '@/lib/motionPresets'
import { CardEyebrow } from '@/components/CardEyebrow'

const ASK_ABOUT_THIS_PROMPT = 'Why is my portfolio moving?'

type HighlightTarget =
  | { kind: 'mover'; mover: PortfolioExplanationMover }
  | { kind: 'theme'; theme: string; move: PortfolioExplanationRow['theme_moves'][number] }

/** Splits `summary` on every mover symbol/theme name so they can render as
 *  clickable spans — the LLM only ever writes plain prose (see
 *  CLAUDE.md/portfolioExplanation.ts), so highlighting is done here against
 *  data we already have, not anything the model returns. */
function useHighlightedSummary(explanation: PortfolioExplanationRow | null) {
  return useMemo(() => {
    if (!explanation) return null
    const targets = new Map<string, HighlightTarget>()
    for (const mover of explanation.movers) {
      targets.set(mover.symbol, { kind: 'mover', mover })
    }
    for (const move of explanation.theme_moves) {
      targets.set(move.theme, { kind: 'theme', theme: move.theme, move })
    }
    if (targets.size === 0) return [explanation.summary]

    const terms = [...targets.keys()].sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const re = new RegExp(`(${terms.join('|')})`, 'g')
    const parts = explanation.summary.split(re)
    return parts.map((part, i) => {
      const target = targets.get(part)
      return target ? { text: part, target, key: i } : part
    })
  }, [explanation])
}

function fmtDollars(n: number): string {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function fmtPercent(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

// stopPropagation everywhere in here: the whole card is a click target for
// "ask about this in the command bar" (see PortfolioExplanationCard below),
// and this panel's own controls (close, headline links) must not also
// trigger that.
function DetailPanel({ target, onClose }: { target: HighlightTarget; onClose: () => void }) {
  if (target.kind === 'mover') {
    const { mover } = target
    return (
      <div className="mt-2 rounded-xl bg-muted/40 border border-border/60 p-3 text-xs space-y-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-medium text-foreground">{mover.symbol} — {mover.name}</p>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-[11px]">Close</button>
        </div>
        <p className="text-muted-foreground">
          {fmtDollars(mover.dollarChange)} ({fmtPercent(mover.percentChange)}) · {mover.contributionPct}% of today's swing
          {mover.theme ? ` · ${mover.theme}` : ''}
        </p>
        {mover.headlines.length > 0 && (
          <ul className="space-y-1 pt-1">
            {mover.headlines.map((h, i) => (
              <li key={i}>
                <a href={h.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  {h.title} <ExternalLink size={10} />
                </a>
                <span className="text-muted-foreground/70"> — {h.source}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const { move } = target
  return (
    <div className="mt-2 rounded-xl bg-muted/40 border border-border/60 p-3 text-xs space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <p className="font-medium text-foreground">{move.theme}</p>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-[11px]">Close</button>
      </div>
      <p className="text-muted-foreground">
        {move.memberSymbols.length} holdings moved {move.direction} together, avg {fmtPercent(move.avgPercentChange)}
      </p>
      <p className="text-muted-foreground">{move.memberSymbols.join(', ')}</p>
    </div>
  )
}

export function PortfolioExplanationCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [explanation, setExplanation] = useState<PortfolioExplanationRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState('')
  const [selectedTarget, setSelectedTarget] = useState<HighlightTarget | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const settings = await getUserSettings()
        const isEnabled = (settings as any)?.portfolio_explanation_enabled === true
        if (cancelled) return
        setEnabled(isEnabled)
        if (!isEnabled) return
        setLoading(true)
        const row = await getPortfolioExplanation()
        if (!cancelled) setExplanation(row)
      } catch (e) {
        console.error('Failed to load portfolio explanation', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function handleRegenerate() {
    setRegenerating(true)
    setError('')
    setSelectedTarget(null)
    try {
      const row = await generatePortfolioExplanation({ force: true })
      setExplanation(row)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to regenerate')
    } finally {
      setRegenerating(false)
    }
  }

  // Clicking the card opens the command bar pre-loaded with this
  // explanation as a two-turn conversation, so the user can ask follow-ups
  // right where they read it — a fresh conversation each click (saved like
  // any other command bar exchange, so it also shows up in history).
  async function handleAskAboutThis() {
    if (!explanation) return
    try {
      const id = await saveConversation({
        messages: [
          { role: 'user', content: ASK_ABOUT_THIS_PROMPT },
          { role: 'assistant', content: explanation.summary },
        ],
      })
      resumeConversationInCommandBar(id)
    } catch (e) {
      console.error('Failed to start command bar session from portfolio explanation', e)
    }
  }

  const highlighted = useHighlightedSummary(explanation)

  if (enabled === false || enabled === null) return null

  return (
    <motion.div
      {...revealUp(0.02)}
      onClick={() => void handleAskAboutThis()}
      role={explanation ? 'button' : undefined}
      tabIndex={explanation ? 0 : undefined}
      onKeyDown={(e) => {
        if (explanation && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); void handleAskAboutThis() }
      }}
      title={explanation ? 'Ask a follow-up in the command bar' : undefined}
      className={`md:col-span-6 bg-card shadow-card rounded-2xl p-5 ${explanation ? 'cursor-pointer' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <CardEyebrow icon={Sparkles}>Why is my portfolio moving?</CardEyebrow>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void handleRegenerate() }}
          disabled={regenerating}
          title="Regenerate"
          aria-label="Regenerate explanation"
          className="flex h-6 w-6 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground hover:text-foreground disabled:opacity-60 transition-colors"
        >
          <RefreshCw size={11} className={regenerating ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <p className="text-xs text-destructive mb-2">{error}</p>}

      {loading && !explanation ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !explanation ? (
        <p className="text-sm text-muted-foreground">No explanation yet — click regenerate to generate one.</p>
      ) : (
        <>
          <p className="text-sm text-foreground leading-relaxed">
            {highlighted?.map((piece, i) =>
              typeof piece === 'string'
                ? <Fragment key={i}>{piece}</Fragment>
                : (
                  <button
                    key={piece.key}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSelectedTarget(selectedTarget === piece.target ? null : piece.target) }}
                    className="font-medium text-primary hover:underline underline-offset-2"
                  >
                    {piece.text}
                  </button>
                ),
            )}
          </p>

          {explanation.is_broad_market_move && explanation.market_headlines.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground space-y-1">
              <p className="uppercase tracking-[0.1em] text-[10px]">Market context</p>
              {explanation.market_headlines.map((h, i) => (
                <a key={i} href={h.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-primary hover:underline">
                  {h.title} <ExternalLink size={10} />
                </a>
              ))}
            </div>
          )}

          {selectedTarget && <DetailPanel target={selectedTarget} onClose={() => setSelectedTarget(null)} />}

          <div className="mt-3 pt-2 border-t border-white/[0.05] flex items-center justify-between text-[10px] text-muted-foreground/70">
            <span>{new Date(explanation.generated_at).toLocaleString()}</span>
            {(explanation.input_tokens || explanation.output_tokens) && (
              <span className="tabular-nums">
                {(explanation.input_tokens ?? 0).toLocaleString()} in · {(explanation.output_tokens ?? 0).toLocaleString()} out tokens
              </span>
            )}
          </div>
        </>
      )}
    </motion.div>
  )
}
