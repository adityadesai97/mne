import { useCallback, useEffect, useState } from 'react'
import { config } from '@/store/config'

const HIDE_VALUES_EVENT = 'mne:hide-values-changed'

/**
 * Reads/writes the "Privacy mode" preference (Settings → Appearance).
 * Backed by localStorage via `config.hideValues`, kept in sync across every
 * mounted consumer (Home, Portfolio, Charts, Settings) with a same-tab
 * custom event — there's no shared React context wrapping these pages, so a
 * plain module-level localStorage read wouldn't re-render siblings when one
 * of them calls `setHideValues`.
 */
export function useHideValues(): [boolean, (v: boolean) => void] {
  const [hidden, setHidden] = useState(() => config.hideValues)

  useEffect(() => {
    const sync = () => setHidden(config.hideValues)
    window.addEventListener(HIDE_VALUES_EVENT, sync)
    return () => window.removeEventListener(HIDE_VALUES_EVENT, sync)
  }, [])

  const setHideValues = useCallback((v: boolean) => {
    config.setHideValues(v)
    window.dispatchEvent(new Event(HIDE_VALUES_EVENT))
  }, [])

  return [hidden, setHideValues]
}

/**
 * Shared Tailwind classes for blurring a dollar value when hidden is true.
 * `strength` defaults to 'md' (12px) — 'sm' (4px) reads as basically legible
 * on bold tabular-nums digits, which is what let the Home hero number
 * (text-[3.1rem] font-bold) show through. Pass 'lg' (16px) for that kind of
 * large hero/headline figure, where even 12px leaves shapes guessable.
 */
export function hiddenValueClass(hidden: boolean, extra = '', strength: 'sm' | 'md' | 'lg' = 'md'): string {
  if (!hidden) return extra
  const blur = strength === 'sm' ? 'blur-sm' : strength === 'lg' ? 'blur-lg' : 'blur-md'
  return `${blur} select-none ${extra}`.trim()
}
