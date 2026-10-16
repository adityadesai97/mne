import { useEffect, useState } from 'react'

/** At and above this width the command bar docks as a side panel; below it, it is a bottom sheet. */
export const DOCK_MIN_PX = 1024
/** Width of the docked panel (the page reflows by exactly this much). */
export const DOCK_WIDTH_PX = 392

/** True when the viewport is wide enough for the docked command bar panel. */
export function useDockedViewport(): boolean {
  const [docked, setDocked] = useState(() => typeof window !== 'undefined' && window.innerWidth >= DOCK_MIN_PX)
  useEffect(() => {
    const update = () => setDocked(window.innerWidth >= DOCK_MIN_PX)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return docked
}
