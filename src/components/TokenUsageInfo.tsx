import { useEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'

/** A small (i) icon button that reveals token usage as a click-triggered
 *  tooltip — usage stays hidden until asked for, rather than always
 *  cluttering the explanation card / command bar reply. Click-triggered
 *  (not hover) so it works the same on touch as on desktop; closes on an
 *  outside click. Renders nothing when there's no usage to show. */
export function TokenUsageInfo({ inputTokens, outputTokens }: { inputTokens?: number | null; outputTokens?: number | null }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const hasUsage = (inputTokens ?? 0) > 0 || (outputTokens ?? 0) > 0
  if (!hasUsage) return null

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        // stopPropagation: this often sits inside a larger click target
        // (e.g. the whole portfolio explanation card) that must not also
        // fire when someone's just checking token usage.
        onClick={(e) => { e.stopPropagation(); setOpen((prev) => !prev) }}
        aria-label="Show token usage"
        aria-expanded={open}
        className="flex h-4 w-4 items-center justify-center text-muted-foreground/60 hover:text-foreground transition-colors"
      >
        <Info size={11} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          role="tooltip"
          className="absolute right-0 bottom-full mb-1.5 px-2 py-1 rounded-md bg-popover border border-border text-popover-foreground text-[11px] whitespace-nowrap shadow-md z-50 tabular-nums"
        >
          {(inputTokens ?? 0).toLocaleString()} in · {(outputTokens ?? 0).toLocaleString()} out tokens
        </div>
      )}
    </div>
  )
}
