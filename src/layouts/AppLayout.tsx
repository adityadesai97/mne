import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { BorderBeam } from 'border-beam'
import BottomNav from './BottomNav'
import Sidebar from './Sidebar'
import { CommandBar } from '@/components/CommandBar'
import { AppAlertsHost } from '@/components/AppAlertsHost'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getAllAssets } from '@/lib/db/assets'
import { computeTotalNetWorth } from '@/lib/portfolio'
import { recordDailySnapshot, backfillHistoricalSnapshots } from '@/lib/db/snapshots'
import { promoteStaleShortTermLots } from '@/lib/db/transactions'
import { syncFinnhubKey } from '@/lib/db/settings'
import { config } from '@/store/config'
import { getSupabaseClient } from '@/lib/supabase'
import { abortActiveImport } from '@/lib/importExport'
import { subscribeToResumeConversationRequests } from '@/lib/commandBarBridge'

const MAX_SAFE_TOP_PX = 64
const MAX_SAFE_BOTTOM_PX = 34

function clampInset(value: number, max: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(max, Math.round(value)))
}

function readSafeAreaInsets() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { top: 0, bottom: 0 }
  }

  const probe = document.createElement('div')
  probe.style.cssText = [
    'position: fixed',
    'inset: 0',
    'pointer-events: none',
    'visibility: hidden',
    'padding-top: env(safe-area-inset-top)',
    'padding-bottom: env(safe-area-inset-bottom)',
  ].join(';')

  document.body.appendChild(probe)
  const styles = window.getComputedStyle(probe)
  const top = clampInset(parseFloat(styles.paddingTop) || 0, MAX_SAFE_TOP_PX)
  const bottom = clampInset(parseFloat(styles.paddingBottom) || 0, MAX_SAFE_BOTTOM_PX)
  probe.remove()

  return { top, bottom }
}

function CmdKFab({ onOpen }: { onOpen: () => void }) {
  const theme = useAppTheme()
  return (
    // Fixed positioning lives on this wrapper, not on the BorderBeam div below
    // it: BorderBeam's own stylesheet sets `position: relative` on the
    // element it renders, which would fight a `fixed` class placed directly
    // on it. The button stays the `layoutId="cmdk"` shared-transition anchor
    // — it's still the same DOM node CommandBar's panel morphs from/to, just
    // now normally in-flow inside the beam's box instead of positioned itself.
    //
    // translateZ(0) forces this onto its own GPU compositor layer — without
    // it, iOS Safari can fail to keep a `position: fixed` element pinned
    // during an active touch-scroll (it visibly trails/scrolls with the
    // page and only snaps back to the correct spot once the gesture ends).
    // That's a distinct bug from the overflow-x-hidden containing-block
    // issue fixed elsewhere in this file — promoting to a layer is the
    // standard mitigation for it.
    //
    // The bottom offset reads env(safe-area-inset-bottom) directly, not the
    // JS-measured --app-safe-bottom var: on iOS Safari that inset isn't a
    // device constant, it actually tracks the bottom toolbar's own
    // show/hide state (0 while the toolbar covers the home-indicator area,
    // the full inset once it auto-hides on scroll and exposes it). The
    // browser updates env() in the same paint as its native toolbar
    // animation; round-tripping that same value through a debounced
    // React-state probe (necessarily a tick or more behind) is exactly
    // what made this element visibly lag/misplace itself while the toolbar
    // was animating — i.e. right at the top/bottom of a scroll gesture.
    <div
      className="fixed bottom-[var(--fab-bottom)] right-4 md:bottom-6 md:right-6 z-40"
      style={{
        ['--fab-bottom' as string]: 'calc(6rem + env(safe-area-inset-bottom, 0px))',
        transform: 'translateZ(0)',
      }}
    >
      {/*
        `bg-card` (the button's original fill) sits only ~3 lightness points
        from `bg-background` in both themes — with the rotating "sm" beam
        dim at any given instant everywhere except the one point it's
        currently passing through, the button could fall back to nearly
        that fill alone and read as blending into the page. `bg-secondary`
        has roughly double the contrast gap in both themes, plus a
        persistent shadow for elevation that doesn't depend on the beam's
        rotation phase at all — brightness/strength raise the beam itself
        on top of that baseline, rather than being the only thing carrying
        the button's visibility.
      */}
      <BorderBeam size="sm" colorVariant="ocean" theme={theme} brightness={1.6} strength={1}>
        <motion.button
          layoutId="cmdk"
          onClick={onOpen}
          className="bg-secondary text-muted-foreground text-xs px-3.5 py-2 md:px-3 md:py-1.5 rounded-full hover:text-foreground transition-colors shadow-lg"
          aria-label="Open command bar"
          style={{ borderRadius: 999 }}
        >
          <span className="inline-flex items-center md:hidden" aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <span className="hidden md:inline">⌘K</span>
        </motion.button>
      </BorderBeam>
    </div>
  )
}

export default function AppLayout() {
  const location = useLocation()
  const [cgAlert, setCgAlert] = useState<string | null>(null)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [resumeConversationId, setResumeConversationId] = useState<string | null>(null)
  const [safeInsets, setSafeInsets] = useState(() => readSafeAreaInsets())

  // Settings' conversation history list lives outside CommandBar's tree —
  // this bridges its "continue this conversation" click into opening the
  // panel resumed on that conversation.
  useEffect(() => {
    return subscribeToResumeConversationRequests((conversationId) => {
      setResumeConversationId(conversationId)
      setCmdOpen(true)
    })
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdOpen(o => !o)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const assets = await getAllAssets()
        const netWorth = computeTotalNetWorth(assets)
        await recordDailySnapshot(netWorth)
        await backfillHistoricalSnapshots(assets)
        const count = await promoteStaleShortTermLots()
        if (count > 0) {
          setCgAlert(`${count} lot${count !== 1 ? 's' : ''} promoted to Long Term capital gains status ✓`)
        }
        await syncFinnhubKey()

        // Backfill logos for tickers that don't have one yet
        if (config.finnhubApiKey) {
          const seen = new Set<string>()
          const tickersWithoutLogos = assets
            .filter(a => a.asset_type === 'Stock' && a.ticker && !a.ticker.logo && !seen.has(a.ticker.id) && seen.add(a.ticker.id))
            .map(a => a.ticker!)

          await Promise.all(tickersWithoutLogos.map(async ticker => {
            try {
              const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker.symbol}&token=${config.finnhubApiKey}`)
              const profile = await res.json()
              if (profile.logo) {
                await getSupabaseClient().from('tickers').update({ logo: profile.logo }).eq('id', ticker.id)
              }
            } catch { /* best-effort */ }
          }))
        }
      } catch (err) {
        console.error(err)
      }
    })()
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    let debounceId: number | undefined

    const applyInsets = () => {
      const next = readSafeAreaInsets()
      // Bail out on a no-op recalculation so an unchanged value doesn't
      // still trigger a re-render (and a CSS var rewrite on the fixed FAB
      // and BottomNav) for nothing.
      setSafeInsets(prev => (prev.top === next.top && prev.bottom === next.bottom ? prev : next))
    }

    // Mobile Safari/Chrome fire visualViewport 'resize'/'scroll' repeatedly
    // while their dynamic toolbar (address bar) animates open/closed during
    // a scroll gesture — recalculating (and re-rendering) on every one of
    // those ticks was what made the fixed CmdKFab visibly jump mid-scroll.
    // Debouncing collapses a whole gesture's worth of events into one
    // recalculation after it settles, keeping the inset correction without
    // the mid-scroll churn.
    const scheduleUpdate = () => {
      if (debounceId !== undefined) window.clearTimeout(debounceId)
      debounceId = window.setTimeout(applyInsets, 150)
    }

    applyInsets()
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('orientationchange', scheduleUpdate)
    vv?.addEventListener('resize', scheduleUpdate)
    vv?.addEventListener('scroll', scheduleUpdate)

    return () => {
      if (debounceId !== undefined) window.clearTimeout(debounceId)
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('orientationchange', scheduleUpdate)
      vv?.removeEventListener('resize', scheduleUpdate)
      vv?.removeEventListener('scroll', scheduleUpdate)
    }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => setSafeInsets(readSafeAreaInsets()), 80)
    return () => window.clearTimeout(id)
  }, [cmdOpen, location.pathname])

  useEffect(() => {
    if (location.pathname !== '/settings') {
      abortActiveImport()
    }
  }, [location.pathname])

  return (
    <div
      className="min-h-screen bg-background flex"
      style={{
        minHeight: '100dvh',
        ['--app-safe-top' as string]: `${safeInsets.top}px`,
        ['--app-safe-bottom' as string]: `${safeInsets.bottom}px`,
      }}
    >
      <Sidebar />

      {/* Main content — offset by sidebar on desktop */}
      <div
        className="flex-1 md:ml-16 min-h-screen flex flex-col overflow-x-hidden"
        style={{
          minHeight: '100dvh',
          paddingTop: 'var(--app-safe-top, 0px)',
          paddingBottom: 'calc(4rem + var(--app-safe-bottom, 0px))',
        }}
      >
        {/*
          Plain CSS animation, not framer-motion AnimatePresence: this
          wrapper sits around every single page in the app (it's the one
          thing all routes share), so it needs to be as close to
          impossible-to-break as possible. A JS-driven exit/enter state
          machine here can — for reasons that were hard to pin down exactly,
          but were confirmed to require no data loss/caching to reproduce —
          end up stuck, which blanks out every page app-wide until a full
          reload. `key`-based remount + a native CSS keyframe can't get
          stuck in an unresolved animation state the way a JS library's
          internal bookkeeping can; the browser just runs it once per DOM
          node and that's it.
        */}
        <div key={location.pathname} className="flex-1 animate-pageIn">
          <Outlet />
        </div>
      </div>

      {/*
        Every `position: fixed` overlay lives here, as a sibling of the
        `overflow-x-hidden` content wrapper above rather than nested inside
        it. iOS Safari (and other WebKit browsers) treats an ancestor with
        `overflow` set to anything but `visible` as the containing block for
        `position: fixed` descendants instead of the viewport — so a fixed
        element nested inside that wrapper scrolls along with its content
        rather than staying pinned. That's what made the command bar FAB
        (and would equally have hit BottomNav, CommandBar's own panel, the
        capital-gains banner, and toast alerts) appear to scroll with the
        page on mobile.
      */}
      <AppAlertsHost />
      <CommandBar
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        resumeConversationId={resumeConversationId}
        onResumeHandled={() => setResumeConversationId(null)}
      />
      {cgAlert && (
        <div
          className="fixed top-0 left-0 right-0 md:left-16 z-50 bg-brand text-white px-4 pb-2 text-sm flex justify-between items-center"
          // Native env(), not the JS-measured --app-safe-top var — see the
          // CmdKFab comment above for why: the browser updates env() in
          // sync with its own toolbar animation, a debounced React-state
          // round-trip can't.
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)', transform: 'translateZ(0)' }}
        >
          <span>{cgAlert}</span>
          <button onClick={() => setCgAlert(null)} className="ml-4 text-primary-foreground/70 hover:text-primary-foreground text-lg leading-none">×</button>
        </div>
      )}
      <AnimatePresence>
        {!cmdOpen && <CmdKFab onOpen={() => setCmdOpen(true)} />}
      </AnimatePresence>
      {!cmdOpen && <BottomNav />}
    </div>
  )
}
