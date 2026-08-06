import { NavLink } from 'react-router-dom'
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

export default function BottomNav() {
  const { hasAssets } = useHasAssets()
  const visibleTabs = tabs.filter((item) => !item.requiresAssets || hasAssets)

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 backdrop-blur-xl bg-card/75 border-t border-white/5 flex justify-around py-2 z-50"
      style={{ paddingBottom: 'calc(0.5rem + var(--app-safe-bottom, 0px))' }}
    >
      {visibleTabs.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `relative flex flex-col items-center gap-1 px-4 py-1.5 text-xs transition-colors duration-150 ${
              isActive ? 'text-primary' : 'text-muted-foreground active:text-foreground'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.div
                  layoutId="bottomnav-pill"
                  className="absolute inset-0 -z-10 rounded-2xl bg-primary/10"
                  transition={{ type: 'spring', stiffness: 480, damping: 34 }}
                />
              )}
              <motion.span whileTap={{ scale: 0.85 }} className="flex flex-col items-center gap-1">
                <Icon size={20} aria-hidden="true" />
                <span>{label}</span>
              </motion.span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
