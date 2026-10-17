import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CircleUser, LogOut, Repeat, Settings } from 'lucide-react'
import { Tooltip } from '@/components/mne/Tooltip'
import { getAccountInfo, signOutOfMne, switchGoogleAccount, type AccountInfo } from '@/lib/account'
import '@/styles/account.css'

// Account button with a menu: who is signed in, switch Google account, sign out. The phone header (`top`)
// has a single button, so its menu also leads with Settings. The sidebar clips its
// children (overflow: hidden), so the menu is portalled to <body> and positioned from the trigger.
export default function AccountMenu({ variant }: { variant: 'side' | 'top' }) {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<AccountInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({})
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getAccountInfo().then(a => { if (!cancelled) setInfo(a) }).catch(() => {})
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      cancelled = true
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => { if (open) menu.current?.querySelector<HTMLElement>('button')?.focus() }, [open, info])

  function toggle() {
    if (!open && trigger.current) {
      const r = trigger.current.getBoundingClientRect()
      setPos(variant === 'side'
        ? { left: r.right + 8, bottom: window.innerHeight - r.bottom }
        : { right: window.innerWidth - r.right, top: r.bottom + 6 })
      setError('')
    }
    setOpen(o => !o)
  }

  async function onSwitch() {
    setBusy(true)
    setError('')
    const message = await switchGoogleAccount()
    if (message) { setError(message); setBusy(false) }
  }

  async function onSignOut() {
    setBusy(true)
    await signOutOfMne()
  }

  const button = (
    <button
      ref={trigger}
      type="button"
      className={variant === 'side' ? 'mne-side-btn' : 'mne-topbar-btn'}
      aria-label={variant === 'top' ? 'Account and settings' : 'Account'}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      onClick={toggle}
    >
      <CircleUser size={20} strokeWidth={1.5} aria-hidden="true" />
    </button>
  )

  return (
    <>
      {variant === 'side' ? <Tooltip content="Account" side="right">{button}</Tooltip> : button}
      {open && createPortal(
        <div ref={menu} id={id} role="menu" aria-label={variant === 'top' ? 'Account and settings' : 'Account'} className="mne-acct-menu" style={pos}>
          {variant === 'top' && (
            <button type="button" role="menuitem" className="mne-acct-item" onClick={() => { setOpen(false); navigate('/settings') }}>
              <Settings size={16} strokeWidth={1.5} aria-hidden="true" />
              Settings
            </button>
          )}
          <div className="mne-acct-who">
            {info?.name && <strong>{info.name}</strong>}
            <span>{info ? info.email : 'Signed in'}</span>
          </div>
          <button type="button" role="menuitem" className="mne-acct-item" onClick={onSwitch} disabled={busy}>
            <Repeat size={16} strokeWidth={1.5} aria-hidden="true" />
            Switch Google account
          </button>
          <button type="button" role="menuitem" className="mne-acct-item" onClick={onSignOut} disabled={busy}>
            <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
            Sign out
          </button>
          {error && <p role="alert" className="mne-acct-error">▼ {error}</p>}
        </div>,
        document.body,
      )}
    </>
  )
}
