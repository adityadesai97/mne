import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Liquid } from 'liquid-gooey'
import { LayoutDashboard, BarChart2, PieChart, Star, Settings } from 'lucide-react'
import { useHasAssets } from '@/hooks/useHasAssets'

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/portfolio', icon: BarChart2, label: 'Portfolio', requiresAssets: true },
  { to: '/charts', icon: PieChart, label: 'Charts', requiresAssets: true },
  { to: '/watchlist', icon: Star, label: 'Watchlist' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

function isNavActive(to: string, pathname: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

export default function Sidebar() {
  const { hasAssets } = useHasAssets()
  const visibleNav = nav.filter((item) => !item.requiresAssets || hasAssets)
  const { pathname } = useLocation()
  const activeIndex = visibleNav.findIndex((t) => isNavActive(t.to, pathname))

  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const [indicator, setIndicator] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const measure = () => {
    const el = itemRefs.current[activeIndex]
    if (el) setIndicator({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, [activeIndex, visibleNav.length])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  return (
    <nav className="hidden md:flex flex-col items-center w-16 bg-card border-r border-white/[0.05] fixed left-0 top-0 bottom-0 z-40 py-5">
      {/* Logo mark */}
      <div className="mb-6 w-10 h-10 flex-shrink-0 flex items-center justify-center">
        <img src="/logo.png" alt="mne" className="w-full h-full object-cover logo-adaptive" />
      </div>

      {/*
        Same liquid Move indicator as the mobile BottomNav, sliding vertically
        instead of horizontally. The fill must stay opaque — the goo filter's
        alpha-contrast step crushes translucent fills to invisible (see the
        comment in BottomNav.tsx) — so this replaces the previous gradient
        `bg-brand` pill with a flat `--primary` fill; the icon still inverts
        to `--primary-foreground` on top of it, same as before.
      */}
      <Liquid
        blur={3}
        fill="hsl(var(--primary))"
        shadow="0 2px 8px hsl(var(--primary) / 0.35)"
        className="flex flex-col gap-1 flex-1 w-full px-2.5"
      >
        {indicator && (
          <Liquid.Item effect="move" move={{ springiness: 0.6, trail: 0.4 }}>
            <div
              aria-hidden="true"
              className="absolute top-0 left-0 rounded-xl pointer-events-none"
              style={{
                width: indicator.w,
                height: indicator.h,
                transform: `translate(${indicator.x}px, ${indicator.y}px)`,
                transition: 'transform 260ms cubic-bezier(0.3, 1.05, 0.4, 1)',
              }}
            />
          </Liquid.Item>
        )}
        {visibleNav.map(({ to, icon: Icon, label }, i) => (
          <NavLink
            key={to}
            ref={(el) => { itemRefs.current[i] = el }}
            to={to}
            end={to === '/'}
            title={label}
            className={({ isActive }) =>
              `flex items-center justify-center w-full aspect-square rounded-xl transition-colors duration-150 ${
                isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]'
              }`
            }
          >
            <motion.span whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} className="flex items-center justify-center">
              <Icon size={18} />
            </motion.span>
          </NavLink>
        ))}
      </Liquid>
    </nav>
  )
}
