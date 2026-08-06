import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LayoutDashboard, BarChart2, PieChart, Star, Settings } from 'lucide-react'
import { useHasAssets } from '@/hooks/useHasAssets'

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/portfolio', icon: BarChart2, label: 'Portfolio', requiresAssets: true },
  { to: '/charts', icon: PieChart, label: 'Charts', requiresAssets: true },
  { to: '/watchlist', icon: Star, label: 'Watchlist' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar() {
  const { hasAssets } = useHasAssets()
  const visibleNav = nav.filter((item) => !item.requiresAssets || hasAssets)

  return (
    <nav className="hidden md:flex flex-col items-center w-16 bg-card border-r border-white/[0.05] fixed left-0 top-0 bottom-0 z-40 py-5">
      {/* Logo mark */}
      <div className="mb-6 w-10 h-10 flex-shrink-0 flex items-center justify-center">
        <img src="/logo.png" alt="mne" className="w-full h-full object-cover logo-adaptive" />
      </div>

      <div className="flex flex-col gap-1 flex-1 w-full px-2.5">
        {visibleNav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={label}
            className={({ isActive }) =>
              `relative flex items-center justify-center w-full aspect-square rounded-xl transition-colors duration-150 ${
                isActive ? 'text-white' : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.div
                    layoutId="sidebar-pill"
                    className="absolute inset-0 -z-10 rounded-xl bg-brand shadow-brand"
                    transition={{ type: 'spring', stiffness: 480, damping: 34 }}
                  />
                )}
                <motion.span whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} className="flex items-center justify-center">
                  <Icon size={18} />
                </motion.span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
