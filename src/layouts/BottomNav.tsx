import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Home, BarChart2, PieChart, Star, Settings } from 'lucide-react'
import { useHasAssets } from '@/hooks/useHasAssets'

const tabs = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/portfolio', icon: BarChart2, label: 'Portfolio', requiresAssets: true },
  { to: '/charts', icon: PieChart, label: 'Charts', requiresAssets: true },
  { to: '/watchlist', icon: Star, label: 'Watchlist' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

function isTabActive(to: string, pathname: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

export default function BottomNav() {
  const { hasAssets } = useHasAssets()
  const visibleTabs = tabs.filter((item) => !item.requiresAssets || hasAssets)
  const { pathname } = useLocation()
  const activeIndex = visibleTabs.findIndex((t) => isTabActive(t.to, pathname))

  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const [indicator, setIndicator] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const measure = () => {
    const el = tabRefs.current[activeIndex]
    // offsetTop isn't 0 here — <Liquid>'s own `py-2` pushes the row's
    // content down from its padding edge (what `top` in absolute
    // positioning is measured from), so it has to be captured per tab
    // rather than assumed, same as Sidebar's vertical indicator does.
    if (el) setIndicator({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })
  }

  useLayoutEffect(measure, [activeIndex, visibleTabs.length])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 backdrop-blur-xl bg-card/75 border-t border-white/5 z-50"
      // translateZ(0) promotes this to its own GPU compositor layer — iOS
      // Safari can otherwise fail to keep a `position: fixed` element
      // pinned during an active touch-scroll (see AppLayout.tsx's CmdKFab
      // for the fuller explanation); backdrop-blur here makes this nav an
      // especially likely candidate for that same glitch.
      //
      // Native env(safe-area-inset-bottom), not the JS-measured
      // --app-safe-bottom var — also explained on CmdKFab: that inset
      // itself changes as Safari's bottom toolbar shows/hides on scroll,
      // and only env() tracks that in the same paint as the toolbar's own
      // animation.
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))', transform: 'translateZ(0)' }}
    >
      {/* Active pill slides between tabs on the standard 180ms curve (no spring). */}
      <div className="relative flex justify-around py-2">
        {indicator && (
            <div
              aria-hidden="true"
              className="absolute left-0 rounded-full bg-muted pointer-events-none"
              style={{
                top: indicator.y,
                width: indicator.w,
                height: indicator.h,
                transform: `translateX(${indicator.x}px)`,
                transition: 'transform var(--dur-standard) var(--ease-standard), width var(--dur-standard) var(--ease-standard)',
              }}
            />

        )}
        {visibleTabs.map(({ to, icon: Icon, label }, i) => (
          <NavLink
            key={to}
            ref={(el) => { tabRefs.current[i] = el }}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `relative flex flex-col items-center gap-1 px-4 py-1.5 text-xs transition-colors duration-150 ${
                isActive ? 'text-primary' : 'text-muted-foreground active:text-foreground'
              }`
            }
          >
            <motion.span whileTap={{ scale: 0.96 }} className="flex flex-col items-center gap-1">
              <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
              <span>{label}</span>
            </motion.span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
