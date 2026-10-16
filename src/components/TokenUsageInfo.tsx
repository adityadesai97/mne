import { useEffect, useRef, useState } from 'react'

/** Design-system InfoPopover: a small "i" button that reveals token usage in a
 *  click-triggered popover (click, not hover, so it works on touch). Closes on
 *  an outside click. Renders nothing when there's no usage to show. */
export function TokenUsageInfo({ inputTokens, outputTokens }: { inputTokens?: number | null; outputTokens?: number | null }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLSpanElement>(null)

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
    <span ref={containerRef} className="mne-pop-wrap">
      <button
        type="button"
        // stopPropagation: this often sits inside a larger click target that
        // must not also fire when someone's just checking token usage.
        onClick={(e) => { e.stopPropagation(); setOpen((prev) => !prev) }}
        aria-label="Show token usage"
        aria-expanded={open}
        className="mne-info-btn"
      >
        i
      </button>
      <div
        onClick={(e) => e.stopPropagation()}
        role="tooltip"
        hidden={!open}
        className={`mne-pop${open ? ' is-open' : ''}`}
        style={{ top: 'auto', bottom: 'calc(100% + 8px)', left: 'auto', right: 0, display: open ? undefined : 'none' }}
      >
        <div>Input <b>{(inputTokens ?? 0).toLocaleString()}</b> tokens</div>
        <div>Output <b>{(outputTokens ?? 0).toLocaleString()}</b> tokens</div>
      </div>
    </span>
  )
}
