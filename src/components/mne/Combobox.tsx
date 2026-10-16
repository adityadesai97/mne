import { useEffect, useId, useRef, useState } from 'react'
import { searchCrypto, searchErrorMessage, searchStocks, type SymbolSuggestion } from '@/lib/symbolSearch'
import { config } from '@/store/config'

export const SEARCH_DEBOUNCE_MS = 250

interface Props {
  id: string
  value: string
  onChange: (value: string) => void
  /** Called when a suggestion is chosen. `submit` is true when chosen with Enter. */
  onPick: (s: SymbolSuggestion, submit: boolean) => void
  crypto: boolean
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
}

type Status = 'idle' | 'loading' | 'done' | 'error'

/** Typeahead for the Watchlist add field (ARIA 1.2 combobox with a listbox popup). */
export function SymbolCombobox({ id, value, onChange, onPick, crypto, placeholder, invalid, disabled }: Props) {
  const listId = useId()
  const [items, setItems] = useState<SymbolSuggestion[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const [open, setOpen] = useState(false)
  const [searchedFor, setSearchedFor] = useState('')
  const reqId = useRef(0)
  const pickedRef = useRef<string | null>(null)
  const query = value.trim()

  useEffect(() => {
    const myReq = ++reqId.current
    // Don't re-search for the text a pick just filled in.
    if (pickedRef.current !== null && pickedRef.current === query) { setStatus('idle'); return }
    pickedRef.current = null
    if (!query) { setItems([]); setStatus('idle'); setMessage(null); setActive(-1); return }
    if (!crypto && !config.hasFinnhubKey) {
      setItems([]); setStatus('error'); setMessage('Add a Finnhub key in Settings to see suggestions. You can still type a symbol and press Add.'); return
    }
    setStatus('loading'); setMessage(null)
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const found = await (crypto ? searchCrypto(query, ctrl.signal) : searchStocks(query, ctrl.signal))
        if (ctrl.signal.aborted || myReq !== reqId.current) return
        setItems(found); setSearchedFor(query); setStatus('done'); setActive(-1)
      } catch (err) {
        if (ctrl.signal.aborted || myReq !== reqId.current) return
        setItems([]); setStatus('error'); setMessage(searchErrorMessage(err)); setActive(-1)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [query, crypto])

  const showList = open && query !== '' && status === 'done' && items.length > 0
  const showNote = open && query !== '' && (status === 'loading' || status === 'error' || (status === 'done' && items.length === 0))
  const noteText = status === 'loading' ? 'Searching…' : status === 'error' ? message : `No matches for “${searchedFor}”`
  const optionId = (i: number) => `${listId}-opt-${i}`

  const pick = (i: number, submit: boolean) => {
    const s = items[i]
    if (!s) return
    pickedRef.current = s.symbol.trim()
    setOpen(false); setActive(-1); setItems([])
    onPick(s, submit)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (items.length === 0) return
      e.preventDefault()
      setOpen(true)
      const n = items.length
      setActive(a => e.key === 'ArrowDown' ? (a + 1) % n : (a <= 0 ? n - 1 : a - 1))
    } else if (e.key === 'Enter') {
      if (showList && active >= 0) { e.preventDefault(); pick(active, true) }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setActive(-1) }
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className="wl-combo">
      <input
        id={id}
        className="mne-input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(-1) }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-invalid={invalid ? true : undefined}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        disabled={disabled}
      />
      <ul id={listId} role="listbox" aria-label={crypto ? 'Matching coins' : 'Matching tickers'} className="wl-combo-menu mne-dd-menu" hidden={!showList}>
        {showList && items.map((s, i) => (
          <li
            key={s.coinId ?? s.symbol}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className={`wl-combo-opt${i === active ? ' is-active' : ''}`}
            onMouseDown={e => e.preventDefault()}
            onClick={() => pick(i, false)}
            onMouseMove={() => active !== i && setActive(i)}
          >
            {s.kind === 'crypto' && s.logo && <img src={s.logo} alt="" width={20} height={20} className="wl-combo-logo" />}
            <span className="wl-combo-sym">{s.symbol}</span>
            <span className="wl-combo-name">{s.name}</span>
            <span className="mne-chip is-outline wl-combo-chip">{s.label}</span>
          </li>
        ))}
      </ul>
      {showNote && !showList && (
        <div className={`wl-combo-menu mne-dd-menu wl-combo-note${status === 'error' ? ' is-error' : ''}`}>
          <span>{noteText}</span>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {open && query ? (showList ? `${items.length} suggestion${items.length === 1 ? '' : 's'} available` : noteText) : ''}
      </span>
    </div>
  )
}
