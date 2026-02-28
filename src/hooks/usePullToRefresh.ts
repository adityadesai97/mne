import { useCallback, useEffect, useRef, useState } from 'react'

const PULL_THRESHOLD = 70 // px

export function usePullToRefresh(onRefresh: () => Promise<void>, enabled = true) {
  const [refreshing, setRefreshing] = useState(false)
  const [pullY, setPullY] = useState(0)
  const startYRef = useRef<number | null>(null)
  const refreshingRef = useRef(false)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || refreshingRef.current) return
    if (window.scrollY > 0) return
    startYRef.current = e.touches[0].clientY
  }, [enabled])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (startYRef.current === null || !enabled || refreshingRef.current) return
    if (window.scrollY > 0) { startYRef.current = null; return }
    const delta = e.touches[0].clientY - startYRef.current
    if (delta <= 0) { setPullY(0); return }
    const clamped = delta < PULL_THRESHOLD
      ? delta
      : PULL_THRESHOLD + (delta - PULL_THRESHOLD) * 0.3
    setPullY(Math.min(clamped, PULL_THRESHOLD * 1.5))
  }, [enabled])

  const handleTouchEnd = useCallback(async () => {
    if (startYRef.current === null || !enabled) return
    const triggered = pullY >= PULL_THRESHOLD
    startYRef.current = null
    setPullY(0)
    if (!triggered || refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [enabled, onRefresh, pullY])

  useEffect(() => {
    if (!enabled) return
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd)
    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd])

  return { refreshing, pullY }
}
