import { NavLink } from 'react-router-dom'
import { Home, LayoutGrid, LineChart, Eye, Settings } from 'lucide-react'
import { useHasAssets } from '@/hooks/useHasAssets'

export const NAV_ITEMS = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/portfolio', icon: LayoutGrid, label: 'Portfolio', requiresAssets: true },
  { to: '/charts', icon: LineChart, label: 'Charts', requiresAssets: true },
  { to: '/watchlist', icon: Eye, label: 'Watchlist' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

// Desktop navigation: the design system's 240px labelled sidebar (wordmark + vertical nav).
// NavLink sets aria-current="page" on the active item, which .mne-nav styles.
export default function Sidebar() {
  const { hasAssets } = useHasAssets()
  const items = NAV_ITEMS.filter(item => !item.requiresAssets || hasAssets)

  return (
    <aside className="mne-side hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-60 bg-background">
      <div className="mne-brand">mne</div>
      <nav className="mne-nav is-side" aria-label="Main">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
