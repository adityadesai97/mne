import { NavLink } from 'react-router-dom'
import { LayoutDashboard, BarChart2, PieChart, Star, Settings } from 'lucide-react'

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/portfolio', icon: BarChart2, label: 'Portfolio' },
  { to: '/charts', icon: PieChart, label: 'Charts' },
  { to: '/watchlist', icon: Star, label: 'Watchlist' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar() {
  return (
    <nav className="hidden md:flex flex-col items-center w-16 bg-card border-r border-white/[0.05] fixed left-0 top-0 bottom-0 z-40 py-5">
      {/* Logo mark */}
      <div className="mb-6 w-10 h-10 flex-shrink-0 flex items-center justify-center">
        <img src="/logo.png" alt="mne" className="w-full h-full object-cover logo-adaptive" />
      </div>

      <div className="flex flex-col gap-1 flex-1 w-full px-2.5">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={label}
            className={({ isActive }) =>
              `flex items-center justify-center w-full aspect-square rounded-xl transition-all duration-150 ${
                isActive
                  ? 'bg-brand text-white shadow-brand'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]'
              }`
            }
          >
            <Icon size={18} />
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
