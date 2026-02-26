import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import BottomNav from './BottomNav'
import Sidebar from './Sidebar'
import { CommandBar } from '@/components/CommandBar'
import { AppAlertsHost } from '@/components/AppAlertsHost'
import { getAllAssets } from '@/lib/db/assets'
import { computeTotalNetWorth } from '@/lib/portfolio'
import { recordDailySnapshot, backfillHistoricalSnapshots } from '@/lib/db/snapshots'
import { promoteStaleShortTermLots } from '@/lib/db/transactions'
import { syncFinnhubKey } from '@/lib/db/settings'
import { config } from '@/store/config'
import { getSupabaseClient } from '@/lib/supabase'
import { abortActiveImport } from '@/lib/importExport'

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
  return (
    <motion.button
      layoutId="cmdk"
      onClick={onOpen}
      className="fixed bottom-[var(--fab-bottom)] right-4 md:bottom-6 md:right-6 z-40 border-spin text-muted-foreground text-xs px-3.5 py-2 md:px-3 md:py-1.5 rounded-full hover:text-foreground transition-colors"
      aria-label="Open command bar"
      style={{
        borderRadius: 999,
        ['--fab-bottom' as string]: 'calc(6rem + var(--app-safe-bottom, 0px))',
      }}
    >
      <span className="inline-flex items-center md:hidden" aria-hidden="true">
        <Sparkles size={16} />
      </span>
      <span className="hidden md:inline">⌘K</span>
    </motion.button>
  )
}

export default function AppLayout() {
  const location = useLocation()
  const [cgAlert, setCgAlert] = useState<string | null>(null)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [safeInsets, setSafeInsets] = useState(() => readSafeAreaInsets())

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
    const updateInsets = () => setSafeInsets(readSafeAreaInsets())
    const vv = window.visualViewport

    updateInsets()
    window.addEventListener('resize', updateInsets)
    window.addEventListener('orientationchange', updateInsets)
    vv?.addEventListener('resize', updateInsets)
    vv?.addEventListener('scroll', updateInsets)

    return () => {
      window.removeEventListener('resize', updateInsets)
      window.removeEventListener('orientationchange', updateInsets)
      vv?.removeEventListener('resize', updateInsets)
      vv?.removeEventListener('scroll', updateInsets)
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
        className="flex-1 md:ml-16 min-h-screen flex flex-col"
        style={{
          minHeight: '100dvh',
          paddingTop: 'var(--app-safe-top, 0px)',
          paddingBottom: 'calc(4rem + var(--app-safe-bottom, 0px))',
        }}
      >
        <AppAlertsHost />
        <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} />
        {cgAlert && (
          <div
            className="fixed top-0 left-0 right-0 md:left-16 z-50 bg-brand text-white px-4 pb-2 text-sm flex justify-between items-center"
            style={{ paddingTop: 'calc(var(--app-safe-top, 0px) + 0.5rem)' }}
          >
            <span>{cgAlert}</span>
            <button onClick={() => setCgAlert(null)} className="ml-4 text-primary-foreground/70 hover:text-primary-foreground text-lg leading-none">×</button>
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] as const }}
            className="flex-1"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
        <AnimatePresence>
          {!cmdOpen && <CmdKFab onOpen={() => setCmdOpen(true)} />}
        </AnimatePresence>
        {!cmdOpen && <BottomNav />}
      </div>
    </div>
  )
}
