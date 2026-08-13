import { useEffect, useState } from 'react'

function readTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/**
 * Tracks the app's actual resolved appearance ('dark' | 'light') by watching
 * the class `applyTheme` (src/lib/theme.ts) sets on <html>. Reflects the
 * user's explicit Settings choice and the resolved value of 'system', unlike
 * a raw `prefers-color-scheme` check — used to feed third-party components
 * (e.g. border-beam) a `theme` prop that matches what's actually on screen.
 */
export function useAppTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme)

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setTheme(readTheme())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return theme
}
