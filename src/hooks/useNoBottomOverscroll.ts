import { useEffect } from 'react'

function canScrollFurther(el: HTMLElement, up: boolean) {
  if (el.scrollHeight <= el.clientHeight) return false
  const overflowY = getComputedStyle(el).overflowY
  if (overflowY !== 'auto' && overflowY !== 'scroll') return false
  return up ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0
}

// iOS rubber-bands the page past its last pixel (dragging the fixed bottom nav up with it, leaving blank canvas
// beneath) and `overscroll-behavior` isn't honoured by every iOS WebKit build. Stop that drag from the one
// place it can be stopped everywhere: cancel a touchmove that would scroll the document past its end, unless
// an inner scroller (command bar thread, dialog, ...) can still take the drag. The top edge is left alone
// because pull-to-refresh uses it.
export function useNoBottomOverscroll(enabled = true) {
  useEffect(() => {
    if (!enabled) return
    let lastY = 0
    const onStart = (e: TouchEvent) => { lastY = e.touches[0].clientY }
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY
      const draggingUp = y < lastY // finger up = content scrolls toward its bottom
      lastY = y
      if (!draggingUp) return
      for (let el = e.target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        if (canScrollFurther(el, true)) return
      }
      const doc = document.documentElement
      if (window.scrollY + window.innerHeight >= doc.scrollHeight - 1 && e.cancelable) e.preventDefault()
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
    }
  }, [enabled])
}
