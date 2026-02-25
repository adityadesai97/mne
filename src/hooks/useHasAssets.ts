import { useCallback, useEffect, useState } from 'react'
import { getAllAssets } from '@/lib/db/assets'

const STORAGE_KEY = 'mne-has-assets'

function readInitialValue() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(STORAGE_KEY) === '1'
}

export function useHasAssets() {
  const [hasAssets, setHasAssets] = useState<boolean>(() => readInitialValue())

  const refresh = useCallback(async () => {
    try {
      const assets = await getAllAssets()
      const next = (assets?.length ?? 0) > 0
      setHasAssets(next)
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      setHasAssets(false)
      window.localStorage.setItem(STORAGE_KEY, '0')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const onFocus = () => { refresh().catch(() => {}) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  return { hasAssets }
}
