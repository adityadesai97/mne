import { Sparkles } from 'lucide-react'
import { openCommandBarWithPrompt } from '@/lib/commandBarBridge'
import '@/styles/shell.css'

/** Quiet "Ask about this" chip: opens the command bar and sends a context question
 *  about whatever card/page it sits on. Hidden on phones (info is trimmed there). */
export function AskChip({ prompt, label = 'Ask about this', className = '' }: { prompt: string; label?: string; className?: string }) {
  return (
    <button
      type="button"
      className={`mne-askchip hidden md:inline-flex ${className}`}
      onClick={() => openCommandBarWithPrompt(prompt)}
      aria-label={`${label}: ${prompt}`}
      title={prompt}
    >
      <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
      {label}
    </button>
  )
}
