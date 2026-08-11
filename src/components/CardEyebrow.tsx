// Shared icon + uppercase caption used at the top of every bento-style card
// (Home's net worth / allocation / P&L tiles, Charts' chart cards, …) so the
// header treatment — icon size, text scale, tracking — stays identical
// everywhere instead of drifting page to page. Originally lived only in
// Home.tsx; extracted here once Charts started reusing the same card shell.
import type { LucideIcon } from 'lucide-react'

export function CardEyebrow({
  icon: Icon,
  className = 'text-muted-foreground',
  children,
}: {
  icon: LucideIcon
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Icon size={11} className={`flex-shrink-0 ${className}`} aria-hidden="true" />
      <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] font-medium truncate">{children}</p>
    </div>
  )
}
