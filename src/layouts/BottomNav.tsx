import { NavLink, useLocation } from 'react-router-dom'
import { AiMark } from '@/components/mne/AiMark'
import { useHasAssets } from '@/hooks/useHasAssets'
import { NAV_ITEMS } from './Sidebar'
import '@/styles/shell.css'

// Mobile navigation: the design system's floating bottom tab bar with a raised centre action that opens
// the command bar sheet. Settings is not a tab here (it lives behind the header's Settings button) so
// the bar stays at four destinations plus the action.
export default function BottomNav({ onAsk }: { onAsk?: () => void }) {
  const { hasAssets } = useHasAssets()
  const { pathname } = useLocation()
  const tabs = NAV_ITEMS.filter(item => item.to !== '/settings' && (!item.requiresAssets || hasAssets))
  const mid = Math.ceil(tabs.length / 2)

  const renderTab = ({ to, icon: Icon, label }: (typeof tabs)[number]) => (
    <NavLink
      key={to}
      to={to}
      end={to === '/'}
      // Re-tapping the current page's tab doesn't navigate, so scroll to the top by hand.
      onClick={() => {
        if (pathname === to) window.scrollTo({ top: 0, behavior: 'smooth' })
      }}
    >
      <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  )

  return (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 px-3"
      // translateZ(0) keeps this on its own compositor layer so iOS Safari keeps it pinned while scrolling.
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))', transform: 'translateZ(0)' }}
    >
      <nav className="mne-nav is-bottom" aria-label="Main">
        {tabs.slice(0, mid).map(renderTab)}
        {onAsk && (
          <button type="button" className="mne-nav-ask" onClick={onAsk} aria-label="Ask mne" aria-haspopup="dialog">
            <AiMark size={24} aria-hidden="true" />
          </button>
        )}
        {tabs.slice(mid).map(renderTab)}
      </nav>
    </div>
  )
}
