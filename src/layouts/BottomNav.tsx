import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Liquid } from 'liquid-gooey'
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
  const [indicator, setIndicator] = useState<{ x: number; w: number; h: number } | null>(null)

  const measure = () => {
    const el = tabRefs.current[activeIndex]
    if (el) setIndicator({ x: el.offsetLeft, w: el.offsetWidth, h: el.offsetHeight })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, [activeIndex, visibleTabs.length])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 backdrop-blur-xl bg-card/75 border-t border-white/5 z-50"
      style={{ paddingBottom: 'calc(0.5rem + var(--app-safe-bottom, 0px))' }}
    >
      {/* Goo blur is kept small relative to the tab row: a large sigma would
          smooth the pill's rounded ends into a shallower curve. There's only
          ever one blob here (no neighbours to bridge into) — the liquid
          effect is purely the Move trail as the indicator slides tab to tab. */}
      <Liquid blur={4} fill="hsl(var(--primary) / 0.1)" className="flex justify-around py-2">
        {indicator && (
          <Liquid.Item effect="move" move={{ springiness: 0.6, trail: 0.4 }}>
            <div
              aria-hidden="true"
              className="absolute top-0 left-0 rounded-2xl pointer-events-none"
              style={{
                width: indicator.w,
                height: indicator.h,
                transform: `translateX(${indicator.x}px)`,
                transition: 'transform 260ms cubic-bezier(0.3, 1.05, 0.4, 1), width 260ms cubic-bezier(0.3, 1.05, 0.4, 1)',
              }}
            />
          </Liquid.Item>
        )}
        {visibleTabs.map(({ to, icon: Icon, label }, i) => (
          <NavLink
            key={to}
            ref={(el) => { tabRefs.current[i] = el }}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-4 py-1.5 text-xs transition-colors duration-150 ${
                isActive ? 'text-primary' : 'text-muted-foreground active:text-foreground'
              }`
            }
          >
            <motion.span whileTap={{ scale: 0.85 }} className="flex flex-col items-center gap-1">
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
            </motion.span>
          </NavLink>
        ))}
      </Liquid>
    </nav>
  )
}
