// src/pages/Watchlist.tsx
import { Fragment, useEffect, useState } from 'react'
import { deleteTicker, getAllTickers, updateTickerPrice, upsertTicker } from '@/lib/db/tickers'
import { getAllAssets } from '@/lib/db/assets'
import { refreshPricesOncePerLoad } from '@/lib/priceRefresh'
import { isTickerAsset } from '@/lib/portfolio'
import { ensureCryptoTicker } from '@/lib/db/cryptoTickers'
import { config } from '@/store/config'
import { getAllThemes, getOrCreateTheme, addTickerTheme, removeTickerTheme } from '@/lib/db/themes'
import { autoAssignThemesForTicker, autoAssignThemesForTickerIfEnabled } from '@/lib/autoThemes'
import { requestAppConfirm, showAppAlert } from '@/lib/appAlerts'
import { getSupabaseClient } from '@/lib/supabase'
import { Delta, PageHead } from '@/components/mne'
import { Info, Plus, Star, Trash2 } from 'lucide-react'
import { AiMark } from '@/components/mne/AiMark'
import { Tooltip } from '@/components/mne/Tooltip'
import '@/styles/watchlist.css'
import { finnhubFetch } from '@/lib/marketData'
import { SymbolCombobox } from '@/components/mne/Combobox'
import type { SymbolSuggestion } from '@/lib/symbolSearch'

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
  const [symbol, setSymbol] = useState('')
  const [isCrypto, setIsCrypto] = useState(false)
  // The coin picked from the suggestions, so the exact coin (not just a
  // symbol that may be shared by several) is what gets added.
  const [pickedCoin, setPickedCoin] = useState<SymbolSuggestion | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // The add form stays hidden until the + button in the page header opens it.
  const [addOpen, setAddOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deletingTickerId, setDeletingTickerId] = useState<string | null>(null)
  const [pricesRefreshedAt] = useState<string | null>(
    () => localStorage.getItem(PRICES_REFRESHED_AT_KEY)
  )

  useEffect(() => {
    if (addOpen) document.getElementById('watchlist-symbol')?.focus()
  }, [addOpen])


  const loadTickers = async () => {
    const [allTickers, allAssets] = await Promise.all([getAllTickers(), getAllAssets()])
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
    // Refresh prices first (once per page load) so the list shows current quotes.
    refreshPricesOncePerLoad()
      .then(() => loadTickers())
      .catch(console.error)
      .finally(() => setLoaded(true))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await addSymbol(symbol, pickedCoin)
  }

  const handlePick = (s: SymbolSuggestion, submit: boolean) => {
    setSymbol(s.symbol)
    setPickedCoin(s.kind === 'crypto' ? s : null)
    if (submit) void addSymbol(s.symbol, s.kind === 'crypto' ? s : null)
  }

  const addSymbol = async (raw: string, coin: SymbolSuggestion | null) => {
    const trimmed = raw.toUpperCase().trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) throw new Error('Not authenticated')
      if (isCrypto) {
        // Crypto is priced from CoinGecko, not Finnhub — resolving the coin,
        // quote, history and theme all live in ensureCryptoTicker.
        const chosen = coin?.coinId && coin.symbol === trimmed
          ? { id: coin.coinId, name: coin.name, symbol: coin.symbol, logo: coin.logo ?? null }
          : undefined
        await ensureCryptoTicker(user.id, trimmed, { watchlistOnly: true, coin: chosen })
        setSymbol('')
        setPickedCoin(null)
        await loadTickers()
        setAddOpen(false)
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
      setPickedCoin(null)
      await loadTickers()
      setAddOpen(false)
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
    <div className="mne-main">
      <PageHead title="Watchlist">
        {formatRelativeTime(pricesRefreshedAt) && (
          <span className="mne-muted text-xs max-sm:hidden">Prices {formatRelativeTime(pricesRefreshedAt)}</span>
        )}
        <button
          type="button"
          className={`mne-btn is-sm wl-add-toggle${addOpen ? ' is-quiet' : ''}`}
          aria-expanded={addOpen}
          aria-controls="watchlist-add-form"
          onClick={() => { setAddOpen(o => !o); setError(null) }}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{addOpen ? 'Close' : 'Add ticker'}</span>
        </button>
      </PageHead>

      {addOpen && (
      <form onSubmit={handleSubmit} className="wl-add" id="watchlist-add-form">
        <div className="mne-field wl-add-input">
          <label htmlFor="watchlist-symbol">Add a ticker</label>
          <SymbolCombobox
            id="watchlist-symbol"
            value={symbol}
            onChange={v => { setSymbol(v); setPickedCoin(null) }}
            onPick={handlePick}
            crypto={isCrypto}
            placeholder={isCrypto ? 'BTC' : 'AAPL or BTC'}
            invalid={!!error}
          />
        </div>
        <div className="wl-add-crypto">
          <label className="mne-check">
            <input type="checkbox" checked={isCrypto} onChange={e => { setIsCrypto(e.target.checked); setPickedCoin(null) }} />
            <span>Crypto</span>
          </label>
          <Tooltip content="Cryptocurrency. Priced via CoinGecko instead of Finnhub.">
            <button type="button" className="wl-info" aria-label="About the Crypto option">
              <Info size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <button type="submit" className="mne-btn wl-add-btn" disabled={submitting || !symbol.trim()}>
          {submitting ? 'Adding…' : 'Add to watchlist'}
        </button>
        {error && <span className="mne-help is-error wl-add-error" role="alert">▼ {error}</span>}
      </form>
      )}

      {!loaded && (
        <div className="mne-bento wl-bento">
          <section className="mne-card s4" aria-busy="true">
            <h3 className="mne-card-title">Tickers</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="mne-skel" style={{ height: 44 }} />)}
            </div>
          </section>
        </div>
      )}

      {loaded && tickers.length === 0 && (
        <div className="mne-empty">
          <div className="ico"><Star aria-hidden="true" /></div>
          <h3>No tickers yet</h3>
          <p>No tickers in watchlist yet. Use Add ticker to track its price.</p>
        </div>
      )}

      {loaded && tickers.length > 0 && (
        <div className="mne-bento wl-bento">
          <section className="mne-card s6">
            <h3 className="mne-card-title">Tickers</h3>
            <div style={{ overflowX: 'auto' }}>
            <table className="mne-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="r">Price</th>
                  <th className="r">Today</th>
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
                          </button>
                        </td>
                        <td className="r mne-num">${currentPrice.toFixed(2)}</td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}>{percentChange != null ? <Delta value={percentChange} /> : <span className="mne-muted">–</span>}</td>
                        <td className="r">
                          {!t.is_owned && (
                            <button
                              type="button"
                              className="pf-iconbtn is-danger"
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
                          <td colSpan={4} onClick={e => e.stopPropagation()}>
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
          <AiMark size={12} aria-hidden="true" style={{ display: 'inline', marginRight: 4 }} />
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
