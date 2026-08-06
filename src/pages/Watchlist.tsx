// src/pages/Watchlist.tsx
import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { deleteTicker, getAllTickers, refreshAllPrices, upsertTicker } from '@/lib/db/tickers'
import { getAllAssets } from '@/lib/db/assets'
import { config } from '@/store/config'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator'
import { getAllThemes, getOrCreateTheme, addTickerTheme, removeTickerTheme } from '@/lib/db/themes'
import { autoAssignThemesForTicker, autoAssignThemesForTickerIfEnabled } from '@/lib/autoThemes'
import { requestAppConfirm, showAppAlert } from '@/lib/appAlerts'
import { getSupabaseClient } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Sparkles, Star, Trash2, X } from 'lucide-react'

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const },
})

export default function Watchlist() {
  const [tickers, setTickers] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deletingTickerId, setDeletingTickerId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const loadTickers = async () => {
    const [allTickers, allAssets] = await Promise.all([getAllTickers(), getAllAssets()])
    const stockCountsByTicker = new Map<string, number>()
    for (const asset of allAssets ?? []) {
      if (asset.asset_type !== 'Stock' || !asset.ticker_id) continue
      stockCountsByTicker.set(asset.ticker_id, (stockCountsByTicker.get(asset.ticker_id) ?? 0) + 1)
    }
    const enriched = (allTickers ?? []).map((ticker: any) => ({
      ...ticker,
      is_owned: (stockCountsByTicker.get(ticker.id) ?? 0) > 0,
    }))
    setTickers(enriched)
  }

  useEffect(() => {
    loadTickers().catch(console.error).finally(() => setLoaded(true))
  }, [])

  const handleRefresh = useCallback(async () => {
    if (config.finnhubApiKey) await refreshAllPrices(config.finnhubApiKey).catch(console.error)
    await loadTickers().catch(console.error)
  }, [])

  const { refreshing, pullY } = usePullToRefresh(handleRefresh, isMobile)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = symbol.toUpperCase().trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const newTicker = await upsertTicker({ user_id: user.id, symbol: trimmed, watchlist_only: true })
      await Promise.allSettled([
        autoAssignThemesForTickerIfEnabled({
          userId: user.id,
          tickerId: newTicker.id,
          symbol: trimmed,
          skipIfAlreadyTagged: true,
        }),
        (async () => {
          if (!config.finnhubApiKey) return
          const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${trimmed}&token=${config.finnhubApiKey}`)
          const profile = await res.json()
          if (!profile.logo) return
          await getSupabaseClient().from('tickers').update({ logo: profile.logo }).eq('id', newTicker.id)
        })(),
      ])
      setSymbol('')
      setShowForm(false)
      await loadTickers()
    } catch (err: any) {
      setError(err.message ?? 'Failed to add ticker')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleDeleteTicker = async (ticker: any, e: React.MouseEvent) => {
    e.stopPropagation()
    if (ticker.is_owned) {
      showAppAlert('Cannot delete a ticker that is still owned.', { variant: 'error' })
      return
    }
    const confirmed = await requestAppConfirm({
      title: 'Delete ticker?',
      message: `Delete ${ticker.symbol} from watchlist?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    setDeletingTickerId(ticker.id)
    try {
      await deleteTicker(ticker.id)
      setExpanded(prev => {
        const next = new Set(prev)
        next.delete(ticker.id)
        return next
      })
      await loadTickers()
    } catch (err: any) {
      showAppAlert(err.message ?? 'Failed to delete ticker', { variant: 'error' })
    } finally {
      setDeletingTickerId(null)
    }
  }

  return (
    <>
    <PullToRefreshIndicator pullY={pullY} refreshing={refreshing} />
    <div className="pt-6 pb-4">
      <div className="flex items-center justify-between px-4 mb-4">
        <h1 className="text-xl font-bold">Watchlist</h1>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => { setShowForm(v => !v); setError(null); setSymbol('') }}
          className="bg-primary/10 hover:bg-primary/20 text-foreground rounded-full p-1.5 transition-colors"
          aria-label={showForm ? 'Cancel' : 'Add ticker'}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={showForm ? 'close' : 'open'}
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex"
            >
              {showForm ? <X size={18} /> : <Plus size={18} />}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            onSubmit={handleSubmit}
            className="mx-4 mb-4 overflow-hidden"
          >
            <div className="bg-card border border-border rounded-lg p-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="text"
                  value={symbol}
                  onChange={e => setSymbol(e.target.value)}
                  placeholder="e.g. AAPL"
                  className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="submit"
                  disabled={submitting || !symbol.trim()}
                  className="bg-primary/10 hover:bg-primary/20 text-foreground text-sm font-medium px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Adding…' : 'Add'}
                </button>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {!loaded && (
        <div className="px-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px] w-full rounded-xl" />
          ))}
        </div>
      )}

      {loaded && tickers.map((t, i) => (
        <motion.div key={t.id} {...fadeUp(Math.min(i, 10) * 0.03)} whileHover={{ y: -2 }} className="mx-4 mb-2">
          <Card>
          <CardContent className="p-4 cursor-pointer" onClick={() => toggleExpanded(t.id)}>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                {t.logo
                  ? <img src={t.logo} className="w-8 h-8 rounded-lg object-contain bg-muted flex-shrink-0" alt={t.symbol} />
                  : <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground flex-shrink-0">{t.symbol.slice(0, 2)}</div>
                }
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{t.symbol}</p>
                    {t.is_owned && <Badge variant="secondary" className="text-xs">Owned</Badge>}
                  </div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {t.ticker_themes?.map((tt: any) => (
                      <Badge key={tt.theme.id} variant="secondary" className="text-xs">{tt.theme.name}</Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <p className="font-medium">${Number(t.current_price ?? 0).toFixed(2)}</p>
                {!t.is_owned && (
                  <button
                    type="button"
                    onClick={(e) => handleDeleteTicker(t, e)}
                    disabled={deletingTickerId === t.id}
                    className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                    aria-label={`Delete ${t.symbol}`}
                    title={`Delete ${t.symbol}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            <AnimatePresence initial={false}>
              {expanded.has(t.id) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  onClick={e => e.stopPropagation()}
                  className="overflow-hidden"
                >
                  <ThemeManager ticker={t} onUpdated={loadTickers} />
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
          </Card>
        </motion.div>
      ))}
      {loaded && tickers.length === 0 && !showForm && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center mt-16 px-4">
          <Star size={22} className="text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground text-center text-sm">No tickers in watchlist yet.</p>
        </motion.div>
      )}
    </div>
    </>
  )
}

function ThemeManager({ ticker, onUpdated }: { ticker: any; onUpdated: () => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  const [newTheme, setNewTheme] = useState('')
  const [saving, setSaving] = useState(false)
  const [autoAssigning, setAutoAssigning] = useState(false)
  const [autoAssignNote, setAutoAssignNote] = useState<string | null>(null)
  const [allThemes, setAllThemes] = useState<any[]>([])

  useEffect(() => {
    getAllThemes().then(setAllThemes).catch(console.error)
  }, [])

  const assignedIds = new Set(ticker.ticker_themes?.map((tt: any) => tt.theme.id))
  const availableThemes = allThemes.filter(t => !assignedIds.has(t.id))

  async function handleAddExisting(themeId: string) {
    setSaving(true)
    try {
      await addTickerTheme(ticker.id, themeId)
      await onUpdated()
      // Re-fetch allThemes to reflect the newly assigned one (onUpdated reloads tickers, not allThemes)
      const updated = await getAllThemes()
      setAllThemes(updated)
    } catch (err: any) {
      showAppAlert(err.message ?? 'Failed to add theme', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newTheme.trim()) return
    setSaving(true)
    try {
      const themeId = await getOrCreateTheme(newTheme.trim())
      await addTickerTheme(ticker.id, themeId)
      setNewTheme('')
      setAdding(false)
      await onUpdated()
    } catch (err: any) {
      showAppAlert(err.message ?? 'Failed to add theme', { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleAutoAssign() {
    setAutoAssigning(true)
    setAutoAssignNote(null)
    try {
      const result = await autoAssignThemesForTicker({ tickerId: ticker.id, symbol: ticker.symbol })
      await onUpdated()
      const updated = await getAllThemes()
      setAllThemes(updated)
      setAutoAssignNote(result.assignedCount > 0 ? `Added ${result.assignedCount} AI theme${result.assignedCount === 1 ? '' : 's'}` : 'No new AI themes found')
    } catch (err: any) {
      showAppAlert(err.message ?? 'Failed to auto-assign themes', { variant: 'error' })
    } finally {
      setAutoAssigning(false)
    }
  }

  async function handleRemove(themeId: string) {
    try {
      await removeTickerTheme(ticker.id, themeId)
      await onUpdated()
    } catch (err: any) {
      showAppAlert(err.message ?? 'Failed to remove theme', { variant: 'error' })
    }
  }

  return (
    <div className="pt-2 border-t border-border mt-2">
      <div className="flex flex-wrap gap-1 mb-2">
        {ticker.ticker_themes?.map((tt: any) => (
          <span key={tt.theme.id} className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground text-xs px-2 py-0.5 rounded-full">
            {tt.theme.name}
            <button onClick={() => handleRemove(tt.theme.id)} className="text-muted-foreground hover:text-foreground">×</button>
          </span>
        ))}
        <button onClick={() => setAdding(v => !v)} className="text-xs text-muted-foreground hover:text-foreground px-1">
          {adding ? '–' : '+ theme'}
        </button>
        <button
          type="button"
          onClick={handleAutoAssign}
          disabled={autoAssigning || saving}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-1 disabled:opacity-50"
        >
          <Sparkles size={12} />
          {autoAssigning ? 'Assigning…' : 'AI themes'}
        </button>
      </div>
      {autoAssignNote && <p className="text-xs text-muted-foreground mb-2">{autoAssignNote}</p>}
      {adding && (
        <div>
          {availableThemes.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {availableThemes.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleAddExisting(t.id)}
                  className="text-xs border border-border text-muted-foreground hover:border-primary hover:text-foreground px-2 py-0.5 rounded-full transition-colors"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={handleAdd} className="flex gap-1">
            <input
            autoFocus
            type="text"
            value={newTheme}
            onChange={e => setNewTheme(e.target.value)}
            placeholder="Theme name"
            className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button type="submit" disabled={saving} className="text-xs bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded transition-colors disabled:opacity-50">
            Add
          </button>
          </form>
        </div>
      )}
    </div>
  )
}
