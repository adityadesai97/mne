import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import BottomNav from './BottomNav'
import Sidebar from './Sidebar'
import { CommandBar } from '@/components/CommandBar'
import { getAllAssets } from '@/lib/db/assets'
import { computeTotalNetWorth } from '@/lib/portfolio'
import { recordDailySnapshot, backfillHistoricalSnapshots } from '@/lib/db/snapshots'
import { promoteStaleShortTermLots } from '@/lib/db/transactions'
import { syncFinnhubKey } from '@/lib/db/settings'
import { config } from '@/store/config'
import { getSupabaseClient } from '@/lib/supabase'

function CmdKFab({ onOpen }: { onOpen: () => void }) {
  return (
    <motion.button
      layoutId="cmdk"
      onClick={onOpen}
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 md:bottom-6 md:right-6 z-40 border-spin text-muted-foreground text-xs px-3 py-1.5 rounded-full hover:text-foreground transition-colors"
      aria-label="Open command bar"
      style={{ borderRadius: 999 }}
    >
      ⌘K
    </motion.button>
  )
}

export default function AppLayout() {
  const location = useLocation()
  const [cgAlert, setCgAlert] = useState<string | null>(null)
  const [cmdOpen, setCmdOpen] = useState(false)

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

  return (
    <div className="min-h-screen bg-background flex" style={{ minHeight: '100dvh' }}>
      <Sidebar />

      {/* Main content — offset by sidebar on desktop */}
      <div
        className="flex-1 md:ml-16 min-h-screen flex flex-col"
        style={{
          minHeight: '100dvh',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))',
        }}
      >
        <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} />
        {cgAlert && (
          <div
            className="fixed top-0 left-0 right-0 md:left-16 z-50 bg-brand text-white px-4 pb-2 text-sm flex justify-between items-center"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
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
