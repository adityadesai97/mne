// Shared icon + uppercase caption used at the top of every bento-style card
// (Home, Charts, Portfolio, Watchlist …). Renders the design system's
// `.mne-eyebrow` so the header treatment is identical everywhere.
import type { LucideIcon } from 'lucide-react'

export function CardEyebrow({
  icon: Icon,
  className = '',
  accent = false,
  children,
}: {
  icon: LucideIcon
  /** Colour utility applied to the icon only (e.g. `text-gain`). */
  className?: string
  /** Terracotta label, as on the design's "Largest holding" card. */
  accent?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`mne-eyebrow min-w-0${accent ? ' is-accent' : ''}`}>
      <Icon size={16} strokeWidth={1.5} className={className} aria-hidden="true" />
      <span className="truncate">{children}</span>
    </div>
  )
}
