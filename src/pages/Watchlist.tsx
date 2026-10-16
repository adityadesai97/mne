// src/pages/Watchlist.tsx
import { Fragment, useCallback, useEffect, useState } from 'react'
import { deleteTicker, getAllTickers, refreshAllPrices, updateTickerPrice, upsertTicker } from '@/lib/db/tickers'
import { getAllAssets } from '@/lib/db/assets'
import { isTickerAsset } from '@/lib/portfolio'
import { ensureCryptoTicker } from '@/lib/db/cryptoTickers'
import { config } from '@/store/config'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator'
import { getAllThemes, getOrCreateTheme, addTickerTheme, removeTickerTheme } from '@/lib/db/themes'
import { autoAssignThemesForTicker, autoAssignThemesForTickerIfEnabled } from '@/lib/autoThemes'
import { requestAppConfirm, showAppAlert } from '@/lib/appAlerts'
import { getSupabaseClient } from '@/lib/supabase'
import { Delta, PageHead } from '@/components/mne'
import { computeThemeDistribution } from '@/lib/charts'
import { Sparkles, Star, Trash2 } from 'lucide-react'
import { finnhubFetch } from '@/lib/marketData'

const PRICES_REFRESHED_AT_KEY = 'mne_prices_refreshed_at'

function formatRelativeTime(isoString: string | null): string | null {
  if (!isoString) return null
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function Watchlist() {
  const [tickers, setTickers] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const [assets, setAssets] = useState<any[]>([])
  const [themes, setThemes] = useState<any[]>([])
  const [symbol, setSymbol] = useState('')
  const [isCrypto, setIsCrypto] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deletingTickerId, setDeletingTickerId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [pricesRefreshedAt, setPricesRefreshedAt] = useState<string | null>(
    () => localStorage.getItem(PRICES_REFRESHED_AT_KEY)
  )

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const loadTickers = async () => {
    const [allTickers, allAssets, allThemes] = await Promise.all([getAllTickers(), getAllAssets(), getAllThemes().catch(() => [])])
    setAssets(allAssets ?? [])
    setThemes(allThemes ?? [])
    const stockCountsByTicker = new Map<string, number>()
    for (const asset of allAssets ?? []) {
      if (!isTickerAsset(asset) || !asset.ticker_id) continue
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
    if (config.hasFinnhubKey) {
      await refreshAllPrices().catch(console.error)
      const now = new Date().toISOString()
      localStorage.setItem(PRICES_REFRESHED_AT_KEY, now)
      setPricesRefreshedAt(now)
    }
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
      if (isCrypto) {
        // Crypto is priced from CoinGecko, not Finnhub — resolving the coin,
        // quote, history and theme all live in ensureCryptoTicker.
        await ensureCryptoTicker(user.id, trimmed, { watchlistOnly: true })
        setSymbol('')
        await loadTickers()
        return
      }
      const newTicker = await upsertTicker({ user_id: user.id, symbol: trimmed, watchlist_only: true })
      await Promise.allSettled([
        autoAssignThemesForTickerIfEnabled({
          userId: user.id,
          tickerId: newTicker.id,
          symbol: trimmed,
          skipIfAlreadyTagged: true,
        }),
        (async () => {
          if (!config.hasFinnhubKey) return
          const res = await finnhubFetch('stock/profile2', { symbol: trimmed })
          const profile = await res.json()
          if (!profile.logo) return
          await getSupabaseClient().from('tickers').update({ logo: profile.logo }).eq('id', newTicker.id)
        })(),
        (async () => {
          // New tickers are inserted with current_price null (shown as $0.00)
          // until the next once-per-load refresh; fetch a quote immediately
          // so the price is right as soon as the ticker is added.
          if (!config.hasFinnhubKey) return
          const res = await finnhubFetch('quote', { symbol: trimmed })
          const quote = await res.json()
          if (!quote.c || !Number.isFinite(Number(quote.c))) return
          const previousClose = Number.isFinite(Number(quote.pc)) ? Number(quote.pc) : null
          await updateTickerPrice(trimmed, Number(quote.c), previousClose)
        })(),
      ])
      setSymbol('')
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

  const themeRows = (() => {
    const totals = new Map<string, number>()
    for (const row of computeThemeDistribution(assets)) totals.set(row.name, row.value)
    const sum = Array.from(totals.values()).reduce((a, b) => a + b, 0)
    return themes.map((th: any) => {
      const tg = Array.isArray(th.theme_targets) ? th.theme_targets.find((x: any) => x.is_active !== false) : th.theme_targets
      const target = tg?.target_percentage
      const share = sum > 0 && totals.has(th.name) ? ((totals.get(th.name) ?? 0) / sum) * 100 : null
      return { id: th.id as string, name: th.name as string, target: target != null ? Number(target) : null, share }
    })
  })()

  return (
    <>
    <PullToRefreshIndicator pullY={pullY} refreshing={refreshing} />
    <div className="mne-main">
      <PageHead title="Watchlist">
        {formatRelativeTime(pricesRefreshedAt) && (
          <span className="mne-muted text-xs">Prices {formatRelativeTime(pricesRefreshedAt)}</span>
        )}
      </PageHead>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="mne-field" style={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
            <label htmlFor="watchlist-symbol">Add a ticker</label>
            <input
              id="watchlist-symbol"
              className="mne-input"
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              placeholder={isCrypto ? 'BTC' : 'AAPL or BTC'}
              aria-invalid={error ? true : undefined}
              autoComplete="off"
            />
          </div>
          <button type="submit" className="mne-btn" disabled={submitting || !symbol.trim()}>
            {submitting ? 'Adding…' : 'Add to watchlist'}
          </button>
        </div>
        <label className="mne-check">
          <input type="checkbox" checked={isCrypto} onChange={e => setIsCrypto(e.target.checked)} />
          <span>Cryptocurrency<small>Priced via CoinGecko instead of Finnhub.</small></span>
        </label>
        {error && <span className="mne-help is-error" role="alert">▼ {error}</span>}
      </form>

      {!loaded && (
        <div className="mne-bento">
          <section className="mne-card s4" aria-busy="true">
            <h3 className="mne-card-title">Tickers</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="mne-skel" style={{ height: 44 }} />)}
            </div>
          </section>
          <section className="mne-card s2"><h3 className="mne-card-title">Themes</h3><div className="mne-skel" style={{ height: 44 }} /></section>
        </div>
      )}

      {loaded && tickers.length === 0 && (
        <div className="mne-empty">
          <div className="ico"><Star aria-hidden="true" /></div>
          <h3>No tickers yet</h3>
          <p>No tickers in watchlist yet. Add one above to track its price.</p>
        </div>
      )}

      {loaded && tickers.length > 0 && (
        <div className="mne-bento">
          <section className="mne-card s4">
            <h3 className="mne-card-title">Tickers</h3>
            <div style={{ overflowX: 'auto' }}>
            <table className="mne-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="r">Price</th>
                  <th className="r">Today</th>
                  <th>Themes</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {tickers.map(t => {
                  const currentPrice = Number(t.current_price ?? 0)
                  const previousClose = t.previous_close != null ? Number(t.previous_close) : null
                  const percentChange = previousClose != null && previousClose !== 0
                    ? ((currentPrice - previousClose) / previousClose) * 100
                    : null
                  const isOpen = expanded.has(t.id)
                  return (
                    <Fragment key={t.id}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpanded(t.id)}>
                        <td>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={`${t.symbol} themes`}
                            onClick={e => { e.stopPropagation(); toggleExpanded(t.id) }}
                            style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                          >
                            {t.logo && <img src={t.logo} alt="" width={20} height={20} style={{ borderRadius: 6, objectFit: 'contain' }} />}
                            {t.symbol}
                            {t.is_owned && <span className="mne-chip is-outline">Owned</span>}
                          </button>
                        </td>
                        <td className="r mne-num">${currentPrice.toFixed(2)}</td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}>{percentChange != null ? <Delta value={percentChange} /> : <span className="mne-muted">–</span>}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {t.ticker_themes?.map((tt: any) => (
                              <span key={tt.theme.id} className="mne-chip is-outline">{tt.theme.name}</span>
                            ))}
                          </div>
                        </td>
                        <td className="r">
                          {!t.is_owned && (
                            <button
                              type="button"
                              className="mne-btn is-quiet is-sm"
                              onClick={e => handleDeleteTicker(t, e)}
                              disabled={deletingTickerId === t.id}
                              aria-label={`Delete ${t.symbol}`}
                              title={`Delete ${t.symbol}`}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={5} onClick={e => e.stopPropagation()}>
                            <ThemeManager ticker={t} onUpdated={loadTickers} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            </div>
          </section>

          <section className="mne-card s2">
            <h3 className="mne-card-title">Themes</h3>
            {themeRows.length === 0 ? (
              <p className="mne-muted" style={{ margin: 0 }}>No themes yet. Expand a ticker to add one.</p>
            ) : (
              <div className="mne-list">
                {themeRows.map(th => (
                  <div key={th.id} className="mne-row">
                    <div>
                      <div className="t">{th.name}</div>
                      {th.target != null && <div className="d">Target {th.target}%</div>}
                    </div>
                    {th.share != null && <span className="mne-chip">{th.share.toFixed(0)}%</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
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
    <div style={{ display: 'grid', gap: 12, padding: '4px 0 8px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {ticker.ticker_themes?.map((tt: any) => (
          <span key={tt.theme.id} className="mne-chip is-outline">
            {tt.theme.name}
            <button type="button" onClick={() => handleRemove(tt.theme.id)} aria-label={`Remove ${tt.theme.name}`} style={{ all: 'unset', cursor: 'pointer', padding: '0 2px' }}>×</button>
          </span>
        ))}
        <button type="button" className="mne-btn is-quiet is-sm" onClick={() => setAdding(v => !v)}>
          {adding ? 'Cancel' : '+ theme'}
        </button>
        <button type="button" className="mne-btn is-quiet is-sm" onClick={handleAutoAssign} disabled={autoAssigning || saving}>
          <Sparkles size={12} aria-hidden="true" style={{ display: 'inline', marginRight: 4 }} />
          {autoAssigning ? 'Assigning…' : 'AI themes'}
        </button>
      </div>
      {autoAssignNote && <span className="mne-help">{autoAssignNote}</span>}
      {adding && (
        <div style={{ display: 'grid', gap: 8 }}>
          {availableThemes.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {availableThemes.map(t => (
                <button key={t.id} type="button" className="mne-btn is-ghost is-sm" onClick={() => handleAddExisting(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8 }}>
            <input
              autoFocus
              className="mne-input"
              type="text"
              value={newTheme}
              onChange={e => setNewTheme(e.target.value)}
              placeholder="Theme name"
              aria-label="Theme name"
              style={{ flex: 1 }}
            />
            <button type="submit" className="mne-btn is-ghost" disabled={saving}>Add</button>
          </form>
        </div>
      )}
    </div>
  )
}
