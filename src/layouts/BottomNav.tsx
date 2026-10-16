import { NavLink } from 'react-router-dom'
import { useHasAssets } from '@/hooks/useHasAssets'
import { NAV_ITEMS } from './Sidebar'

// Mobile navigation: the design system's floating bottom tab bar.
export default function BottomNav() {
  const { hasAssets } = useHasAssets()
  const tabs = NAV_ITEMS.filter(item => !item.requiresAssets || hasAssets)

  return (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 px-3"
      // translateZ(0) keeps this on its own compositor layer so iOS Safari keeps it pinned while scrolling.
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))', transform: 'translateZ(0)' }}
    >
      <nav className="mne-nav is-bottom" aria-label="Main">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
