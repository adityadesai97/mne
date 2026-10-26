import { useSyncExternalStore, type ReactElement } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { NavLink } from 'react-router-dom'
import { Home, LayoutGrid, LineChart, Eye, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useHasAssets } from '@/hooks/useHasAssets'
import { Tooltip } from '@/components/mne/Tooltip'
import AccountMenu from '@/components/AccountMenu'
import '@/styles/sidebar.css'

export const NAV_ITEMS = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/portfolio', icon: LayoutGrid, label: 'Portfolio', requiresAssets: true },
  { to: '/charts', icon: LineChart, label: 'Charts', requiresAssets: true },
  { to: '/watchlist', icon: Eye, label: 'Watchlist' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

const STORAGE_KEY = 'mne_sidebar_collapsed'
export const SIDEBAR_EXPANDED_PX = 240
export const SIDEBAR_COLLAPSED_PX = 72

function readCollapsed(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
}

// Tiny module-level store so AppLayout's content offset follows the sidebar.
let collapsed = readCollapsed()
const listeners = new Set<() => void>()
function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function setCollapsed(next: boolean) {
  collapsed = next
  try { localStorage.setItem(STORAGE_KEY, String(next)) } catch { /* ignore */ }
  listeners.forEach(fn => fn())
}

export function useSidebarCollapsed() {
  return useSyncExternalStore(subscribe, () => collapsed, () => false)
}

export function sidebarWidthPx(isCollapsed: boolean) {
  return isCollapsed ? SIDEBAR_COLLAPSED_PX : SIDEBAR_EXPANDED_PX
}

// Desktop navigation: labelled 240px sidebar, collapsible to a 72px icon rail. Account and Settings are icons pinned to the bottom.
// NavLink sets aria-current="page" on the active item, which .mne-nav styles.
export default function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { hasAssets } = useHasAssets()
  const isCollapsed = useSidebarCollapsed()
  const items = NAV_ITEMS.filter(item => item.to !== '/settings' && (!item.requiresAssets || hasAssets))
  const ToggleIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose
  const toggleLabel = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'

  // Both states render the exact same DOM (tooltips are only switched on/off), so nothing remounts or reflows:
  // sidebar.css animates only the sidebar width, and label/wordmark opacity.
  return (
    <aside
      className={`mne-side hidden md:flex fixed left-0 top-0 bottom-0 z-40 bg-background${isCollapsed ? ' is-collapsed' : ''}`}
      data-collapsed={isCollapsed}
    >
      <div className="mne-side-head">
        <div className="mne-brand" aria-label="mne">m<span className="mne-brand-rest" aria-hidden="true">ne</span></div>
      </div>
      <nav className="mne-nav is-side" aria-label="Main">
        {items.map(({ to, icon: Icon, label }) => (
          <SideTip key={to} label={label} show={isCollapsed}>
            <NavLink to={to} end={to === '/'} aria-label={label} onClick={onNavigate}>
              <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
              <span className="mne-side-label">{label}</span>
            </NavLink>
          </SideTip>
        ))}
      </nav>
      <div className="mne-side-foot">
        <Tooltip content={toggleLabel} side="right">
          <button
            type="button"
            className="mne-side-btn"
            aria-label={toggleLabel}
            aria-expanded={!isCollapsed}
            onClick={() => setCollapsed(!isCollapsed)}
          >
            <ToggleIcon size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip content="Settings" side="right">
          <NavLink to="/settings" className="mne-side-btn" aria-label="Settings" onClick={onNavigate}>
            <Settings size={20} strokeWidth={1.5} aria-hidden="true" />
          </NavLink>
        </Tooltip>
        <AccountMenu variant="side" />
      </div>
    </aside>
  )
}

// Label tooltip only while collapsed. Always the same wrapper (open forced false when expanded) so the link never remounts.
function SideTip({ label, show, children }: { label: string; show: boolean; children: ReactElement }) {
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root open={show ? undefined : false}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content side="right" sideOffset={6} className="mne-tooltip">{label}</TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
