// src/components/TaxLotList.tsx
import { useState } from 'react'
import { Trash2, Pencil } from 'lucide-react'
import { formatDateMDY } from '@/lib/dates'
import { useHideValues, hiddenValueClass } from '@/hooks/useHideValues'
import { Delta } from '@/components/mne'
import '@/styles/portfolio.css'

interface EditValues {
  count: string
  cost_price: string
  purchase_date: string
  capital_gains_status: string
  sold_at_vest: string
}

type EditTransactionUpdates = {
  count: number
  cost_price: number
  purchase_date: string
  capital_gains_status: string
  sold_at_vest?: number
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`pf-chev${open ? ' is-open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function TaxLotList({ subtypes, ticker, onDeleteTransaction, onEditTransaction, onEndGrant, onDeleteGrant }: {
  subtypes: any[]
  ticker: any
  onDeleteTransaction?: (id: string) => Promise<void>
  onEditTransaction?: (id: string, updates: EditTransactionUpdates) => Promise<void>
  onEndGrant?: (id: string) => Promise<void>
  onDeleteGrant?: (grantId: string, transactionIds: string[]) => Promise<void>
}) {
  const [hideValues] = useHideValues()
  const isCrypto = ticker?.kind === 'crypto'
  const [editingId, setEditingId] = useState<string | null>(null)
  // Subtype tables start open (they are compact); RSU grant blocks start
  // collapsed so a stock with lots of vesting history doesn't dump every row.
  const [collapsedSubtypeIds, setCollapsedSubtypeIds] = useState<Set<string>>(new Set())
  const [expandedGrantIds, setExpandedGrantIds] = useState<Set<string>>(new Set())
  const [editValues, setEditValues] = useState<EditValues>({
    count: '',
    cost_price: '',
    purchase_date: '',
    capital_gains_status: '',
    sold_at_vest: '',
  })

  function toggleIn(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const subtypesWithActivity = subtypes.filter(
    (st: any) => (st.transactions?.length ?? 0) > 0 || (st.rsu_grants?.length ?? 0) > 0,
  )

  async function handleSave(tId: string) {
    if (!onEditTransaction) return
    const soldAtVest = parseFloat(editValues.sold_at_vest) || 0
    await onEditTransaction(tId, {
      count: parseFloat(editValues.count),
      cost_price: parseFloat(editValues.cost_price),
      purchase_date: editValues.purchase_date,
      capital_gains_status: editValues.capital_gains_status,
      sold_at_vest: soldAtVest > 0 ? soldAtVest : undefined,
    })
    setEditingId(null)
  }

  const hasActions = Boolean(onEditTransaction || onDeleteTransaction)
  const colCount = 6 + (hasActions ? 1 : 0)

  function renderEditRow(t: any) {
    const step = isCrypto ? 'any' : '0.01'
    return (
      <tr key={t.id}>
        <td colSpan={colCount}>
          <div className="pf-lot-edit">
            <div className="pf-lot-edit-grid">
              <div className="mne-field">
                <label htmlFor={`${t.id}-count`}>{isCrypto ? 'Units' : 'Shares'}</label>
                <input id={`${t.id}-count`} className="mne-input" type="number" step={step} value={editValues.count}
                  onChange={e => setEditValues(v => ({ ...v, count: e.target.value }))} />
              </div>
              <div className="mne-field">
                <label htmlFor={`${t.id}-cost`}>{isCrypto ? 'Cost/unit' : 'Cost/share'}</label>
                <input id={`${t.id}-cost`} className="mne-input" type="number" step={step} value={editValues.cost_price}
                  onChange={e => setEditValues(v => ({ ...v, cost_price: e.target.value }))} />
              </div>
              <div className="mne-field">
                <label htmlFor={`${t.id}-date`}>Purchase date</label>
                <input id={`${t.id}-date`} className="mne-input" type="date" value={editValues.purchase_date}
                  onChange={e => setEditValues(v => ({ ...v, purchase_date: e.target.value }))} />
              </div>
              <div className="mne-field">
                <label htmlFor={`${t.id}-status`}>Status</label>
                <div className="mne-select-wrap">
                  <select id={`${t.id}-status`} className="mne-input" value={editValues.capital_gains_status}
                    onChange={e => setEditValues(v => ({ ...v, capital_gains_status: e.target.value }))}>
                    <option value="Short Term">Short Term</option>
                    <option value="Long Term">Long Term</option>
                  </select>
                </div>
              </div>
              <div className="mne-field">
                <label htmlFor={`${t.id}-sav`}>Sold at vest</label>
                <input id={`${t.id}-sav`} className="mne-input" type="number" step={step} min="0" placeholder="0" value={editValues.sold_at_vest}
                  onChange={e => setEditValues(v => ({ ...v, sold_at_vest: e.target.value }))} />
              </div>
            </div>
            <div className="pf-actions">
              <button type="button" className="mne-btn is-sm" onClick={() => handleSave(t.id)}>Save</button>
              <button type="button" className="mne-btn is-ghost is-sm" onClick={() => setEditingId(null)}>Cancel</button>
            </div>
          </div>
        </td>
      </tr>
    )
  }

  function renderTransactionRow(t: any) {
    if (editingId === t.id) return renderEditRow(t)
    const totalVested = Number(t.count)
    const soldAtVest = Number(t.sold_at_vest ?? 0)
    const shares = Math.max(0, totalVested - soldAtVest)
    const costPerShare = Number(t.cost_price)
    const currentPrice = ticker?.current_price ?? null
    const totalCost = shares * costPerShare
    const currentValue = currentPrice !== null ? shares * currentPrice : null
    const gain = currentValue !== null ? currentValue - totalCost : null
    const isLong = t.capital_gains_status === 'Long Term'

    return (
      <tr key={t.id}>
        <td>{formatDateMDY(t.purchase_date)}</td>
        <td><span className="mne-chip is-outline">{isLong ? 'Long term' : 'Short term'}</span></td>
        <td className="r">
          {isCrypto ? fmtCoins(shares) : shares.toFixed(shares % 1 === 0 ? 0 : 4)}
          {soldAtVest > 0 && (
            <span className="mne-help" style={{ display: 'block' }}>
              {soldAtVest.toFixed(soldAtVest % 1 === 0 ? 0 : 4)} sold at vest
            </span>
          )}
        </td>
        <td className="r"><span className={hiddenValueClass(hideValues)}>{fmt(costPerShare)}</span></td>
        <td className="r pf-hide-sm"><span className={hiddenValueClass(hideValues)}>{currentValue !== null ? fmt(currentValue) : '—'}</span></td>
        <td className="r">
          {gain !== null
            ? <span className={hiddenValueClass(hideValues)}><Delta value={gain} format={abs => fmt(abs)} /></span>
            : <span className="mne-muted">—</span>}
        </td>
        {hasActions && (
          <td className="r" style={{ whiteSpace: 'nowrap' }}>
            {onEditTransaction && (
              <button
                type="button"
                className="pf-iconbtn"
                aria-label="Edit"
                onClick={() => {
                  setEditingId(t.id)
                  setEditValues({
                    count: String(t.count),
                    cost_price: String(t.cost_price),
                    purchase_date: t.purchase_date,
                    capital_gains_status: t.capital_gains_status,
                    sold_at_vest: String(t.sold_at_vest ?? 0),
                  })
                }}
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            )}
            {onDeleteTransaction && (
              <button type="button" className="pf-iconbtn is-danger" aria-label="Delete" onClick={() => onDeleteTransaction(t.id)}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}
          </td>
        )}
      </tr>
    )
  }

  function renderTable(txs: any[]) {
    return (
      <div className="pf-scroll">
        <table className="mne-table is-compact">
          <thead>
            <tr>
              <th>Purchased</th>
              <th>Term</th>
              <th className="r">{isCrypto ? 'Units' : 'Shares'}</th>
              <th className="r">{isCrypto ? 'Cost/unit' : 'Cost/share'}</th>
              <th className="r pf-hide-sm">Value</th>
              <th className="r">Gain</th>
              {hasActions && <th className="r"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>{txs.map(t => renderTransactionRow(t))}</tbody>
        </table>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {subtypesWithActivity.map((st: any) => {
        const transactions = st.transactions ?? []
        const rsuGrants = st.rsu_grants ?? []
        const isRsuSubtype = st.subtype === 'RSU'
        const rsuGrantGroups = isRsuSubtype ? groupRsuActivityByGrant(rsuGrants, transactions) : null
        const isSubtypeOpen = !collapsedSubtypeIds.has(st.id)

        return (
          <div key={st.id} className="pf-sub">
            <button
              type="button"
              className="pf-disclose"
              onClick={() => toggleIn(setCollapsedSubtypeIds, st.id)}
              aria-expanded={isSubtypeOpen}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Chevron open={isSubtypeOpen} />
                <span className="mne-eyebrow">{st.subtype}</span>
              </span>
              <span className="mne-help">
                {transactions.length} tx
                {rsuGrants.length > 0 && <> · {rsuGrants.length} grant{rsuGrants.length === 1 ? '' : 's'}</>}
              </span>
            </button>

            {isSubtypeOpen && (
              <div className="pf-fade" style={{ marginTop: 8 }}>
                {isRsuSubtype && rsuGrantGroups ? (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {rsuGrantGroups.grants.map(group => {
                      const vesting = computeGrantVesting(group.grant, group.transactions)
                      const summary = computeGrantSummary(group.transactions, ticker)
                      const isGrantOpen = expandedGrantIds.has(group.grant.id)
                      return (
                        <div key={group.grant.id} style={{ background: 'var(--mne-surface-300)', borderRadius: 'var(--mne-radius-md)', padding: 12 }}>
                          <button
                            type="button"
                            className="pf-disclose"
                            onClick={() => toggleIn(setExpandedGrantIds, group.grant.id)}
                            aria-expanded={isGrantOpen}
                          >
                            <span>
                              <b>Grant {formatDateMDY(group.grant.grant_date)}</b>
                              <span className="mne-help" style={{ display: 'block' }}>{isCrypto ? `${fmtCoins(summary.shares)} units` : `${fmtShares(summary.shares)} shares`}</span>
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              {summary.gain !== null
                                ? <span className={hiddenValueClass(hideValues)}><Delta value={summary.gain} format={abs => fmt(abs)} /></span>
                                : <span className="mne-muted">—</span>}
                              <Chevron open={isGrantOpen} />
                            </span>
                          </button>

                          {isGrantOpen && (
                            <div className="pf-fade" style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                <div>
                                  <div style={{ fontWeight: 500 }}>{fmtShares(Number(group.grant.total_shares ?? 0))} shares granted</div>
                                  <div className="mne-help">{fmtShares(vesting.unvestedShares)} unvested</div>
                                  <div className="mne-help">
                                    Vesting {formatDateMDY(group.grant.vest_start)} → {formatDateMDY(group.grant.vest_end)}
                                    {group.grant.ended_at && <> · Ended {formatDateMDY(group.grant.ended_at)}</>}
                                  </div>
                                </div>
                                <div className="pf-actions" style={{ alignItems: 'center' }}>
                                  {group.grant.ended_at ? (
                                    <span className="mne-chip is-outline">Ended</span>
                                  ) : onEndGrant ? (
                                    <button type="button" className="mne-btn is-ghost is-sm" onClick={() => { void onEndGrant(group.grant.id) }}>
                                      End Grant
                                    </button>
                                  ) : null}
                                  {onDeleteGrant && (
                                    <button
                                      type="button"
                                      className="pf-iconbtn is-danger"
                                      aria-label="Delete grant"
                                      onClick={() => { void onDeleteGrant(group.grant.id, group.transactions.map((t: any) => t.id)) }}
                                    >
                                      <Trash2 size={14} aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              {group.transactions.length > 0 ? (
                                renderTable(group.transactions)
                              ) : (
                                <p className="mne-help">No transactions mapped to this grant yet.</p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {rsuGrantGroups.unassignedTransactions.length > 0 && (
                      <div>
                        <div className="mne-eyebrow" style={{ marginBottom: 8 }}>Unmatched Transactions</div>
                        {renderTable(rsuGrantGroups.unassignedTransactions)}
                      </div>
                    )}
                  </div>
                ) : (
                  renderTable(transactions)
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function groupRsuActivityByGrant(grants: any[], transactions: any[]) {
  const grantGroups = [...grants]
    .sort((a, b) => String(b.grant_date).localeCompare(String(a.grant_date)))
    .map(grant => ({ grant, transactions: [] as any[] }))

  const unassignedTransactions: any[] = []

  for (const transaction of transactions) {
    if (transaction.rsu_grant_id) {
      const group = grantGroups.find(g => g.grant.id === transaction.rsu_grant_id)
      if (group) {
        group.transactions.push(transaction)
        continue
      }
    }
    const targetGroup = pickGrantForTransaction(grantGroups, transaction)
    if (targetGroup) {
      targetGroup.transactions.push(transaction)
    } else {
      unassignedTransactions.push(transaction)
    }
  }

  for (const group of grantGroups) {
    group.transactions.sort((a, b) => String(b.purchase_date).localeCompare(String(a.purchase_date)))
  }

  return { grants: grantGroups, unassignedTransactions }
}

function pickGrantForTransaction(
  grantGroups: Array<{ grant: any; transactions: any[] }>,
  transaction: any,
) {
  if (grantGroups.length === 0) return null

  const txDate = parseIsoDate(transaction.purchase_date)
  if (!txDate) return grantGroups[0]

  const inWindowCandidates = grantGroups.filter(({ grant }) => {
    const vestStart = parseIsoDate(grant.vest_start) ?? parseIsoDate(grant.grant_date)
    const vestEnd = parseIsoDate(grant.vest_end)
    if (!vestStart || !vestEnd) return false
    const endedAt = parseIsoDate(grant.ended_at)
    const effectiveEnd = endedAt && endedAt < vestEnd ? endedAt : vestEnd
    return txDate >= vestStart && txDate <= effectiveEnd
  })

  if (inWindowCandidates.length > 0) {
    return [...inWindowCandidates].sort((a, b) => {
      const aStart = parseIsoDate(a.grant.vest_start) ?? parseIsoDate(a.grant.grant_date)
      const bStart = parseIsoDate(b.grant.vest_start) ?? parseIsoDate(b.grant.grant_date)
      return (bStart?.getTime() ?? 0) - (aStart?.getTime() ?? 0)
    })[0]
  }

  const grantedBeforeTx = grantGroups.filter(({ grant }) => {
    const grantDate = parseIsoDate(grant.grant_date)
    return Boolean(grantDate && txDate >= grantDate)
  })

  if (grantedBeforeTx.length > 0) {
    return [...grantedBeforeTx].sort((a, b) => {
      const aGrantDate = parseIsoDate(a.grant.grant_date)
      const bGrantDate = parseIsoDate(b.grant.grant_date)
      return (bGrantDate?.getTime() ?? 0) - (aGrantDate?.getTime() ?? 0)
    })[0]
  }

  return [...grantGroups].sort((a, b) => {
    const aGrantDate = parseIsoDate(a.grant.grant_date)
    const bGrantDate = parseIsoDate(b.grant.grant_date)
    const aDistance = Math.abs((aGrantDate?.getTime() ?? Number.POSITIVE_INFINITY) - txDate.getTime())
    const bDistance = Math.abs((bGrantDate?.getTime() ?? Number.POSITIVE_INFINITY) - txDate.getTime())
    return aDistance - bDistance
  })[0]
}

function parseIsoDate(value: string | null | undefined) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (year && month && day) return new Date(year, month - 1, day)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function computeGrantVesting(grant: any, transactions: any[]) {
  const totalShares = Number(grant.total_shares ?? 0)
  const vestedFromTransactions = transactions.reduce((sum, tx) => {
    const shares = Number(tx.count ?? 0)
    return Number.isFinite(shares) ? sum + shares : sum
  }, 0)
  const normalizedVested = Math.max(0, Math.min(totalShares, vestedFromTransactions))
  const unvestedShares = grant.ended_at ? 0 : Math.max(0, totalShares - normalizedVested)

  return { vestedShares: normalizedVested, unvestedShares }
}

function computeGrantSummary(transactions: any[], ticker: any) {
  const currentPrice = ticker?.current_price ?? null
  let shares = 0
  let costBasis = 0
  for (const t of transactions) {
    const totalVested = Number(t.count ?? 0)
    const soldAtVest = Number(t.sold_at_vest ?? 0)
    const heldShares = Math.max(0, totalVested - soldAtVest)
    shares += heldShares
    costBasis += heldShares * Number(t.cost_price ?? 0)
  }
  const currentValue = currentPrice !== null ? shares * currentPrice : null
  const gain = currentValue !== null ? currentValue - costBasis : null
  return { shares, currentValue, gain }
}

function fmt(n: number) {
  // Sub-dollar prices (e.g. a $0.00001 meme coin) need more than 2 decimals
  // to show anything but $0.00.
  const abs = Math.abs(Number(n))
  const maximumFractionDigits = abs > 0 && abs < 1 ? 8 : 2
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits }).format(Number(n))
}

// Crypto quantities are tracked to 8 decimal places (satoshi precision).
function fmtCoins(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(n)
}

function fmtShares(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}
