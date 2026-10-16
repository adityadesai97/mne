import { NavLink } from 'react-router-dom'
import { Search, Settings } from 'lucide-react'
import '@/styles/shell.css'

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
const SHORTCUT_LABEL = IS_MAC ? '⌘K' : 'Ctrl K'

// Slim header of the app shell. Desktop/tablet: the command pill ("Ask or search…  ⌘K") that opens the
// command bar. Phone: the wordmark and a Settings button (Settings left the bottom tab bar to make room
// for the raised centre action); the pill is hidden there.
export default function TopBar({ onAsk, open, controlsId }: { onAsk: () => void; open: boolean; controlsId: string }) {
  return (
    <header className="mne-topbar" style={{ paddingTop: 'var(--app-safe-top, 0px)' }}>
      <div className="mne-topbar-in">
        <div className="mne-brand" aria-label="mne">m<span aria-hidden="true">ne</span></div>
        <button
          type="button"
          className="mne-askpill"
          onClick={onAsk}
          aria-label="Ask or search"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={controlsId}
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>Ask or search…</span>
          <kbd className="mne-kbd" aria-hidden="true">{SHORTCUT_LABEL}</kbd>
        </button>
        <NavLink to="/settings" className="mne-topbar-btn" aria-label="Settings">
          <Settings size={20} strokeWidth={1.5} aria-hidden="true" />
        </NavLink>
      </div>
    </header>
  )
}
