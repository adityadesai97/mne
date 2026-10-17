import { AiMark } from '@/components/mne/AiMark'
import AccountMenu from '@/components/AccountMenu'
import '@/styles/shell.css'

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
const SHORTCUT_LABEL = IS_MAC ? '⌘K' : 'Ctrl K'

// Slim header of the app shell. Desktop/tablet: the command pill ("Ask or search…  ⌘K") that opens the
// command bar. Phone: the wordmark and one button at the right that drops down Settings and the account options (Settings left
// the bottom tab bar to make room for the raised centre action); the pill is hidden there.
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
          <AiMark size={18} aria-hidden="true" />
          <span>Ask or search…</span>
          <kbd className="mne-kbd" aria-hidden="true">{SHORTCUT_LABEL}</kbd>
        </button>
        <AccountMenu variant="top" />
      </div>
    </header>
  )
}
