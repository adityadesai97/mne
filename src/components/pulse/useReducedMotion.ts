import { useEffect, useState } from 'react'

/** Live `prefers-reduced-motion: reduce`; false where matchMedia is missing. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
  })
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    let mq: MediaQueryList
    try { mq = matchMedia('(prefers-reduced-motion: reduce)') } catch { return }
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}
