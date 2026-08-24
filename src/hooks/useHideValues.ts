import { useCallback, useEffect, useState } from 'react'
import { config } from '@/store/config'

const HIDE_VALUES_EVENT = 'mne:hide-values-changed'

/**
 * Reads/writes the "hide values" privacy preference (Settings → Appearance).
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

/** Shared Tailwind classes for blurring a dollar value when hidden is true. */
export function hiddenValueClass(hidden: boolean, extra = ''): string {
  return hidden ? `blur-sm select-none ${extra}`.trim() : extra
}
