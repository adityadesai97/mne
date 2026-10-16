import { useState, Fragment } from 'react'
import { ExternalLink } from 'lucide-react'
import { Delta } from '@/components/mne'
import type { ConversationMessageExplanationDetail } from '@/lib/db/conversations'
import type { PortfolioExplanationMover, PortfolioExplanationThemeMove } from '@/lib/db/portfolioExplanations'

type HighlightTarget =
  | { kind: 'mover'; mover: PortfolioExplanationMover }
  | { kind: 'theme'; theme: string; move: PortfolioExplanationThemeMove }

function fmtDollars(n: number): string {
  return `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function Change({ dollars, percent }: { dollars?: number; percent: number }) {
  return (
    <>
      <Delta value={percent} />
      {dollars !== undefined && <> · {dollars >= 0 ? '+' : '−'}{fmtDollars(dollars)}</>}
    </>
  )
}

function DetailPanel({ target, onClose }: { target: HighlightTarget; onClose: () => void }) {
  if (target.kind === 'mover') {
    const { mover } = target
    return (
      <div className="mne-expl-detail is-open">
        <div className="flex items-center justify-between gap-2">
          <b>{mover.symbol} — {mover.name}</b>
          <button type="button" onClick={onClose} className="mne-btn is-quiet is-sm">Close</button>
        </div>
        <div>
          <Change dollars={mover.dollarChange} percent={mover.percentChange} /> · {mover.contributionPct}% of that day's swing
          {mover.theme ? ` · ${mover.theme}` : ''}
        </div>
        {mover.headlines.length > 0 && (
          <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
            {mover.headlines.map((h, i) => (
              <li key={i}>
                <a href={h.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
                  {h.title} <ExternalLink size={12} aria-hidden="true" />
                </a>
                <span className="mne-muted"> · {h.source}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const { move } = target
  return (
    <div className="mne-expl-detail is-open">
      <div className="flex items-center justify-between gap-2">
        <b>{move.theme}</b>
        <button type="button" onClick={onClose} className="mne-btn is-quiet is-sm">Close</button>
      </div>
      <div>
        {move.memberSymbols.length} holdings moved {move.direction} together, avg <Change percent={move.avgPercentChange} />
      </div>
      <div className="mne-muted">{move.memberSymbols.join(', ')}</div>
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
      <div className="mne-expl whitespace-pre-wrap break-words">
        {pieces.map((piece, i) =>
          typeof piece === 'string'
            ? <Fragment key={i}>{piece}</Fragment>
            : (
              <button
                key={piece.key}
                type="button"
                aria-expanded={selected === piece.target}
                onClick={() => setSelected(selected === piece.target ? null : piece.target)}
                className="mne-hl"
              >
                {piece.text}
              </button>
            ),
        )}
      </div>

      {detail.marketHeadlines.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="mne-eyebrow">Market context</div>
          <ol className="mne-sources">
            {detail.marketHeadlines.map((h, i) => (
              <li key={i}>
                <a href={h.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
                  {h.title} <ExternalLink size={12} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}

      {selected && <DetailPanel target={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
