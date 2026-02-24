import { config } from '@/store/config'

export function applyTheme(theme: 'light' | 'dark' | 'system') {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  if (theme === 'system') {
    const prefersDark = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
    root.classList.add(prefersDark ? 'dark' : 'light')
  } else {
    root.classList.add(theme)
  }
}

export function initTheme() {
  applyTheme(config.theme)
  if (typeof window.matchMedia !== 'function') return
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (config.theme === 'system') applyTheme('system')
  })
}
