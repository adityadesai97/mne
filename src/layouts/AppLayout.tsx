import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import BottomNav from './BottomNav'
import TopBar from './TopBar'
import Sidebar, { useSidebarCollapsed, sidebarWidthPx } from './Sidebar'
import { CommandBar } from '@/components/CommandBar'
import { AppAlertsHost } from '@/components/AppAlertsHost'
import { useNoBottomOverscroll } from '@/hooks/useNoBottomOverscroll'
import { useDockedViewport, DOCK_WIDTH_PX } from '@/hooks/useDockedViewport'
import { getAllAssets } from '@/lib/db/assets'
import { computeTotalNetWorth } from '@/lib/portfolio'
import { recordDailySnapshot, backfillHistoricalSnapshots } from '@/lib/db/snapshots'
import { promoteStaleShortTermLots } from '@/lib/db/transactions'
import { migrateLegacyClaudeKey } from '@/lib/db/llmCredentials'
import { migrateLegacyMarketKeys } from '@/lib/db/marketCredentials'
import { finnhubFetch } from '@/lib/marketData'
import { config } from '@/store/config'
import { getSupabaseClient } from '@/lib/supabase'
import { abortActiveImport } from '@/lib/importExport'
import { subscribeToResumeConversationRequests, subscribeToExplanationRequests, subscribeToPrefillRequests } from '@/lib/commandBarBridge'
import type { PortfolioInsightSlot } from '@/lib/portfolioExplanation'
import { getPendingPlaidPositionsCount } from '@/lib/db/plaid'
import { PlaidReviewModal } from '@/components/PlaidReviewModal'
import { onPlaidPendingChanged } from '@/lib/plaidEvents'

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

const CMDK_PANEL_ID = 'cmdk-panel'

/** What the command bar's header calls the page it is sitting beside. */
function pageContextLabel(pathname: string): string {
  if (pathname === '/') return 'Home'
  if (/^\/portfolio\/.+/.test(pathname)) return 'Asset detail'
  if (pathname.startsWith('/portfolio')) return 'Portfolio'
  if (pathname.startsWith('/charts')) return 'Charts'
  if (pathname.startsWith('/watchlist')) return 'Watchlist'
  if (pathname.startsWith('/settings')) return 'Settings'
  return ''
}

export default function AppLayout() {
  const location = useLocation()
  const sidebarCollapsed = useSidebarCollapsed()
  const [cgAlert, setCgAlert] = useState<string | null>(null)
  const [cmdOpen, setCmdOpen] = useState(false)
  // Docked command bar stretched across the page up to the sidebar; any sidebar navigation (or closing) undoes it.
  const [cmdExpanded, setCmdExpanded] = useState(false)
  const [resumeConversationId, setResumeConversationId] = useState<string | null>(null)
  const [pendingExplanationSlot, setPendingExplanationSlot] = useState<PortfolioInsightSlot | null>(null)
  const [pendingPrefill, setPendingPrefill] = useState<string | null>(null)
  const [safeInsets, setSafeInsets] = useState(() => readSafeAreaInsets())
  const [plaidPendingCount, setPlaidPendingCount] = useState(0)
  const [plaidBannerDismissed, setPlaidBannerDismissed] = useState(false)
  const [plaidReviewOpen, setPlaidReviewOpen] = useState(false)
  // Wide screens dock the command bar beside the page, which then reflows by the panel's width.
  const docked = useDockedViewport()
  useNoBottomOverscroll()
  const dockOffset = cmdOpen && docked ? DOCK_WIDTH_PX : 0
  useEffect(() => { if (!cmdOpen) setCmdExpanded(false) }, [cmdOpen])

  const refreshPlaidPendingCount = async () => {
    try {
      setPlaidPendingCount(await getPendingPlaidPositionsCount())
    } catch {
      // Plaid tables may not exist yet on an older self-hosted schema —
      // treat that the same as "nothing pending" rather than erroring.
    }
  }

  // Reviewing from Settings (its own copy of the review screen), a sync, or a connect can all
  // change what's pending without touching this layout's copy of the count.
  useEffect(() => onPlaidPendingChanged(() => void refreshPlaidPendingCount()), [])

  // Settings' conversation history list lives outside CommandBar's tree —
  // this bridges its "continue this conversation" click into opening the
  // panel resumed on that conversation.
  useEffect(() => {
    return subscribeToResumeConversationRequests((conversationId) => {
      setResumeConversationId(conversationId)
      setCmdOpen(true)
    })
  }, [])

  // Same bridge, for the Portfolio Pulse carousel — it has no existing
  // conversation to resume, just a request to open the command bar and let
  // it fetch/generate the clicked card's own explanation.
  useEffect(() => {
    return subscribeToExplanationRequests((slot) => {
      setPendingExplanationSlot(slot)
      setCmdOpen(true)
    })
  }, [])

  // Portfolio Pulse event cards: open the command bar with a question typed in.
  useEffect(() => {
    return subscribeToPrefillRequests((text) => {
      setPendingPrefill(text)
      setCmdOpen(true)
    })
  }, [])

  // Header pill / mobile centre action: open the bar, or if it is already open but focus is out on the
  // page, bring focus back to its input.
  const focusCommandBarInput = useCallback(() => {
    document.querySelector<HTMLTextAreaElement>(`#${CMDK_PANEL_ID} textarea`)?.focus()
  }, [])
  const askFromTrigger = useCallback(() => {
    if (cmdOpen) focusCommandBarInput()
    else setCmdOpen(true)
  }, [cmdOpen, focusCommandBarInput])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        // Closed: open. Open with focus on the page: focus the input. Open with focus inside: close.
        const panel = document.getElementById(CMDK_PANEL_ID)
        if (cmdOpen && panel && !panel.contains(document.activeElement)) focusCommandBarInput()
        else setCmdOpen(!cmdOpen)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [cmdOpen, focusCommandBarInput])

  // One-time move of pre-proxy API keys (Claude, Finnhub, CoinGecko) from the browser to the server.
  useEffect(() => {
    migrateLegacyClaudeKey().catch(e => console.warn('Could not move the Claude key to the server yet', e))
    migrateLegacyMarketKeys().catch(e => console.warn('Could not move the market data keys to the server yet', e))
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const assets = await getAllAssets()
        const netWorth = computeTotalNetWorth(assets)
        await recordDailySnapshot(netWorth, assets)
        await backfillHistoricalSnapshots(assets)
        const count = await promoteStaleShortTermLots()
        if (count > 0) {
          setCgAlert(`${count} lot${count !== 1 ? 's' : ''} promoted to Long Term capital gains status ✓`)
        }
        await refreshPlaidPendingCount()

        // Backfill logos for tickers that don't have one yet
        if (config.hasFinnhubKey) {
          const seen = new Set<string>()
          const tickersWithoutLogos = assets
            .filter(a => a.asset_type === 'Stock' && a.ticker && !a.ticker.logo && !seen.has(a.ticker.id) && seen.add(a.ticker.id))
            .map(a => a.ticker!)

          await Promise.all(tickersWithoutLogos.map(async ticker => {
            try {
              const res = await finnhubFetch('stock/profile2', { symbol: ticker.symbol })
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
      // still trigger a re-render (and a CSS var rewrite on a fixed element
      // or BottomNav) for nothing.
      setSafeInsets(prev => (prev.top === next.top && prev.bottom === next.bottom ? prev : next))
    }

    // Mobile Safari/Chrome fire visualViewport 'resize'/'scroll' repeatedly
    // while their dynamic toolbar (address bar) animates open/closed during
    // a scroll gesture — recalculating (and re-rendering) on every one of
    // those ticks was what made fixed elements visibly jump mid-scroll.
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

  // The window is the scroller, so without this a new page opens at the old page's scroll offset.
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

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
        ['--sidebar-w' as string]: `${sidebarWidthPx(sidebarCollapsed)}px`,
      }}
    >
      <Sidebar onNavigate={() => setCmdExpanded(false)} />

      {/* Main content — offset by sidebar on desktop */}
      <div
        className="flex-1 mne-with-side mne-with-dock min-w-0 min-h-screen flex flex-col overflow-x-clip"
        style={{
          minHeight: '100dvh',
          // The docked command bar pushes the page over instead of covering it (430ms layout move).
          marginRight: dockOffset,
          // The header carries the safe-area top inset itself, so it can stick to the very top.
          paddingBottom: 'calc(4rem + var(--app-safe-bottom, 0px))',
        }}
      >
        <TopBar onAsk={askFromTrigger} open={cmdOpen} controlsId={CMDK_PANEL_ID} />
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
        rather than staying pinned. That's what made the old floating command bar button
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
        startExplanationRequest={pendingExplanationSlot}
        onExplanationRequestHandled={() => setPendingExplanationSlot(null)}
        prefillQuery={pendingPrefill}
        onPrefillHandled={() => setPendingPrefill(null)}
        contextLabel={pageContextLabel(location.pathname)}
        panelId={CMDK_PANEL_ID}
        expanded={cmdExpanded && docked}
        onToggleExpanded={() => setCmdExpanded(v => !v)}
      />
      {cgAlert && (
        <div
          className="fixed top-0 left-0 right-0 mne-side-offset z-50 bg-brand px-4 pb-2 text-sm flex justify-between items-center"
          // Native env(), not the JS-measured --app-safe-top var: the browser
          // updates env() in sync with its own toolbar animation, a debounced
          // React-state round-trip can't.
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)', transform: 'translateZ(0)', right: dockOffset, transition: 'right 430ms cubic-bezier(.4, 0, .2, 1)' }}
        >
          <span>{cgAlert}</span>
          <button onClick={() => setCgAlert(null)} className="ml-4 text-primary-foreground/70 hover:text-primary-foreground text-lg leading-none">×</button>
        </div>
      )}
      {/*
        Review-first: a Plaid sync only ever stages rows in
        plaid_pending_positions — nothing lands in the portfolio until the
        user confirms it here. This banner is the "surfaces the next time
        the app opens" trigger; Settings has a permanent entry point to the
        same modal for anyone who dismisses it.
      */}
      {plaidPendingCount > 0 && !plaidBannerDismissed && (
        <div
          className={`fixed left-0 right-0 mne-side-offset z-50 bg-brand px-4 pb-2 text-sm flex justify-between items-center ${cgAlert ? 'top-9' : 'top-0'}`}
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)', transform: 'translateZ(0)', right: dockOffset, transition: 'right 430ms cubic-bezier(.4, 0, .2, 1)' }}
        >
          <span>
            {plaidPendingCount} synced position{plaidPendingCount !== 1 ? 's' : ''} to review
          </span>
          <div className="flex items-center gap-3 ml-4">
            <button onClick={() => setPlaidReviewOpen(true)} className="underline underline-offset-2 hover:no-underline">
              Review
            </button>
            <button onClick={() => setPlaidBannerDismissed(true)} className="text-primary-foreground/70 hover:text-primary-foreground text-lg leading-none">×</button>
          </div>
        </div>
      )}
      <PlaidReviewModal
        open={plaidReviewOpen}
        onClose={() => {
          setPlaidReviewOpen(false)
          void refreshPlaidPendingCount()
        }}
        onChanged={() => {
          void refreshPlaidPendingCount()
        }}
      />
      {/* On phones the sheet covers the tab bar while it is open. */}
      {!(cmdOpen && !docked) && <BottomNav onAsk={askFromTrigger} />}
    </div>
  )
}
