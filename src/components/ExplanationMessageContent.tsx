import { useState, Fragment } from 'react'
import { ExternalLink } from 'lucide-react'
import type { ConversationMessageExplanationDetail } from '@/lib/db/conversations'
import type { PortfolioExplanationMover, PortfolioExplanationThemeMove } from '@/lib/db/portfolioExplanations'

type HighlightTarget =
  | { kind: 'mover'; mover: PortfolioExplanationMover }
  | { kind: 'theme'; theme: string; move: PortfolioExplanationThemeMove }

function fmtDollars(n: number): string {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function fmtPercent(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function DetailPanel({ target, onClose }: { target: HighlightTarget; onClose: () => void }) {
  if (target.kind === 'mover') {
    const { mover } = target
    return (
      <div className="mt-2 rounded-xl bg-muted/40 border border-border/60 p-3 text-xs space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="font-medium text-foreground">{mover.symbol} — {mover.name}</p>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-[11px]">Close</button>
        </div>
        <p className="text-muted-foreground">
          {fmtDollars(mover.dollarChange)} ({fmtPercent(mover.percentChange)}) · {mover.contributionPct}% of that day's swing
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
    <div className="mt-2 rounded-xl bg-muted/40 border border-border/60 p-3 text-xs space-y-1.5">
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

/** Renders a generated portfolio explanation's prose with its mover/theme
 *  names as clickable highlights — clicking one shows that mover's or
 *  theme's numbers + headline links right below the text, matching the
 *  original (pre-command-bar) explanation card's interaction instead of a
 *  flat "Sources" list at the end. Broad-market headlines (not tied to any
 *  single mover/theme) show as their own small list, always visible. The
 *  LLM only ever wrote the plain prose — every link/number here comes from
 *  `detail`, the row's stored structured data, never parsed out of the
 *  text itself. */
export function ExplanationMessageContent({ content, detail }: { content: string; detail: ConversationMessageExplanationDetail }) {
  const [selected, setSelected] = useState<HighlightTarget | null>(null)

  const targets = new Map<string, HighlightTarget>()
  for (const mover of detail.movers) targets.set(mover.symbol, { kind: 'mover', mover })
  for (const move of detail.themeMoves) targets.set(move.theme, { kind: 'theme', theme: move.theme, move })

  const pieces: (string | { text: string; target: HighlightTarget; key: number })[] = targets.size === 0
    ? [content]
    : (() => {
        const terms = [...targets.keys()].sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        const re = new RegExp(`(${terms.join('|')})`, 'g')
        return content.split(re).map((part, i) => {
          const target = targets.get(part)
          return target ? { text: part, target, key: i } : part
        })
      })()

  return (
    <div>
      <p className="text-sm text-foreground whitespace-pre-wrap break-words">
        {pieces.map((piece, i) =>
          typeof piece === 'string'
            ? <Fragment key={i}>{piece}</Fragment>
            : (
              <button
                key={piece.key}
                type="button"
                onClick={() => setSelected(selected === piece.target ? null : piece.target)}
                className="font-medium text-primary hover:underline underline-offset-2"
              >
                {piece.text}
              </button>
            ),
        )}
      </p>

      {detail.marketHeadlines.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground space-y-1">
          <p className="uppercase tracking-[0.1em] text-[10px]">Market context</p>
          {detail.marketHeadlines.map((h, i) => (
            <a key={i} href={h.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              {h.title} <ExternalLink size={10} />
            </a>
          ))}
        </div>
      )}

      {selected && <DetailPanel target={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
