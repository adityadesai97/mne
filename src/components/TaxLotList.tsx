// src/components/TaxLotList.tsx
// Tax lots for a stock / crypto asset. Two presentations, chosen in Settings
// (config.lotView): "summary first" (default) and "timeline". Edit / delete /
// grant handlers are unchanged and passed straight through.
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { formatDateMDY } from '@/lib/dates'
import { computeRsuVestEvents } from '@/lib/charts'
import { useHideValues } from '@/hooks/useHideValues'
import { Stat } from '@/components/mne'
import {
  buildStockLot, daysBetween, fmtMoney, fmtMoney0, fmtQty, parseIsoDate, plural, qtyText, sortRsuGrants, startOfToday, toIsoKey,
  type StockLot,
} from '@/components/lots/lotMath'
import {
  Chevron, GainText, Hide, LotDisclosure, ProgressBar, type LotLayout,
} from '@/components/lots/parts'
import {
  StockLotRows, StockSummary, StockTimeline,
  type EditValues, type StockLotCtx, type TimelineExtraEvent,
} from '@/components/lots/StockLotViews'
import { EsopGrantList } from '@/components/EsopGrantList'
import type { ExerciseInput } from '@/lib/db/esop'
import '@/styles/portfolio.css'

type EditTransactionUpdates = {
  count: number
  cost_price: number
  purchase_date: string
  capital_gains_status: string
  sold_at_vest?: number
}

export function TaxLotList({ subtypes, ticker, layout = 'default', onDeleteTransaction, onEditTransaction, onEndGrant, onDeleteGrant, onExerciseOptions, onEndEsopGrant, onDeleteEsopGrant }: {
  subtypes: any[]
  ticker: any
  layout?: LotLayout
  onDeleteTransaction?: (id: string) => Promise<void>
  onEditTransaction?: (id: string, updates: EditTransactionUpdates) => Promise<void>
  onEndGrant?: (id: string) => Promise<void>
  onDeleteGrant?: (grantId: string, transactionIds: string[]) => Promise<void>
  onExerciseOptions?: (grant: any, input: ExerciseInput) => Promise<void>
  onEndEsopGrant?: (grantId: string) => Promise<void>
  onDeleteEsopGrant?: (grantId: string) => Promise<void>
}) {
  const [hideValues] = useHideValues()
  const isCrypto = ticker?.kind === 'crypto'
  const [editingId, setEditingId] = useState<string | null>(null)
  // Subtype sections start open (they are compact); RSU grant blocks start
  // collapsed so a stock with lots of vesting history doesn't dump every row.
  const [collapsedSubtypeIds, setCollapsedSubtypeIds] = useState<Set<string>>(new Set())
  const [expandedGrantIds, setExpandedGrantIds] = useState<Set<string>>(new Set())
  const today = startOfToday()
  const price = ticker?.current_price != null ? Number(ticker.current_price) : null

  function toggleIn(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const subtypesWithActivity = subtypes.filter(
    (st: any) => (st.transactions?.length ?? 0) > 0 || (st.rsu_grants?.length ?? 0) > 0 || (st.esop_grants?.length ?? 0) > 0,
  )

  async function handleSave(tId: string, values: EditValues) {
    if (!onEditTransaction) return
    const soldAtVest = parseFloat(values.sold_at_vest) || 0
    await onEditTransaction(tId, {
      count: parseFloat(values.count),
      cost_price: parseFloat(values.cost_price),
      purchase_date: values.purchase_date,
      capital_gains_status: values.capital_gains_status,
      sold_at_vest: soldAtVest > 0 ? soldAtVest : undefined,
    })
    setEditingId(null)
  }

  const ctx: StockLotCtx = {
    isCrypto,
    hideValues,
    price,
    today,
    editingId,
    onStartEdit: onEditTransaction ? setEditingId : undefined,
    onSaveEdit: handleSave,
    onCancelEdit: () => setEditingId(null),
    onDelete: onDeleteTransaction,
  }

  const build = (txs: any[]): StockLot[] => txs.map(t => buildStockLot(t, price, today))

  /** A plain lot collection (Market / ESPP subtype, or unmatched RSU rows). */
  function renderLots(txs: any[], opts: { detailLabel?: string; summary?: boolean } = {}) {
    const lots = build(txs)
    if (layout === 'timeline') return <StockTimeline lots={lots} ctx={ctx} legend={opts.summary !== false} />
    if (opts.summary === false) {
      return <StockLotRows lots={[...lots].sort((a, b) => String(b.date).localeCompare(String(a.date)))} ctx={ctx} />
    }
    // With a single subtype section the stat strip repeats the asset header's
    // own Shares / Cost basis / Value / Gain, so it is dropped on phones.
    return <StockSummary lots={lots} ctx={ctx} detailLabel={opts.detailLabel} hideStatsOnMobile={subtypesWithActivity.length === 1} />
  }

  function renderGrant(group: { grant: any; transactions: any[] }) {
    const { grant } = group
    const vesting = computeGrantVesting(grant, group.transactions)
    const summary = computeGrantSummary(group.transactions, ticker)
    const isGrantOpen = expandedGrantIds.has(grant.id)
    const total = Number(grant.total_shares ?? 0)
    const vestedPct = total > 0 ? (vesting.vestedShares / total) * 100 : 0
    const lots = build(group.transactions)
    const next = grant.ended_at ? null : nextVestEvent(grant, today)
    const freq = String(grant.vesting_frequency ?? '')

    const extraEvents: TimelineExtraEvent[] = []
    if (next) {
      extraEvents.push({
        key: `vest-${grant.id}`,
        date: next.key,
        title: `Next vest · ${qtyText(next.shares)}`,
        sub: `${formatDateMDY(next.key)} · ${freq} · ${next.days === 0 ? 'today' : `in ${next.days} ${plural(next.days, 'day', 'days')}`}`,
        right: price !== null ? <span className="mne-help">est. <Hide hidden={hideValues}>{fmtMoney0(next.shares * price)}</Hide></span> : undefined,
      })
    }
    if (parseIsoDate(grant.grant_date)) {
      extraEvents.push({
        key: `grant-${grant.id}`,
        date: String(grant.grant_date).slice(0, 10),
        title: 'Grant awarded',
        sub: `${fmtQty(total)} ${plural(total, 'share', 'shares')} · vests through ${formatDateMDY(grant.vest_end)}`,
        right: <span className="mne-help">{vestedPct.toFixed(0)}% vested</span>,
      })
    }

    const actions = (
      <div className="pf-actions" style={{ alignItems: 'center' }}>
        {grant.ended_at ? (
          <span className="mne-chip is-outline">Ended</span>
        ) : onEndGrant ? (
          <button type="button" className="mne-btn is-ghost is-sm" onClick={() => { void onEndGrant(grant.id) }}>
            End Grant
          </button>
        ) : null}
        {onDeleteGrant && (
          <button
            type="button"
            className="pf-iconbtn is-danger"
            aria-label="Delete grant"
            onClick={() => { void onDeleteGrant(grant.id, group.transactions.map((t: any) => t.id)) }}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    )

    const vestLine = (
      <div className="mne-help">
        Vesting {formatDateMDY(grant.vest_start)} → {formatDateMDY(grant.vest_end)}
        {freq && <> · {freq}</>}
        {grant.ended_at && <> · Ended {formatDateMDY(grant.ended_at)}</>}
      </div>
    )

    return (
      <div key={grant.id} className="lot-grant">
        <button
          type="button"
          className="pf-disclose"
          onClick={() => toggleIn(setExpandedGrantIds, grant.id)}
          aria-expanded={isGrantOpen}
        >
          <span>
            <b>Grant {formatDateMDY(grant.grant_date)}</b>
            <span className="mne-help" style={{ display: 'block' }}>{isCrypto ? `${fmtQty(summary.shares, true)} units` : `${qtyText(summary.shares)} held`}</span>
          </span>
          <span className="lot-flex">
            <GainText gain={summary.gain} hidden={hideValues} format={fmtMoney} />
            <Chevron open={isGrantOpen} />
          </span>
        </button>

        {isGrantOpen && (
          <div className="pf-fade lot-grant-body">
            {layout === 'timeline' ? (
              <>
                <div className="lot-between">
                  <div>
                    <div style={{ fontWeight: 600 }}>{qtyText(total)} granted <span className="mne-muted" style={{ fontWeight: 400 }}>· {fmtQty(vesting.unvestedShares)} unvested</span></div>
                    {vestLine}
                  </div>
                  {actions}
                </div>
                <div>
                  <ProgressBar pct={vestedPct} tone="accent" />
                  <div className="mne-help" style={{ marginTop: 6 }}>{fmtQty(vesting.vestedShares)} of {fmtQty(total)} vested ({vestedPct.toFixed(0)}%)</div>
                </div>
                {group.transactions.length > 0 || extraEvents.length > 0
                  ? <StockTimeline lots={lots} ctx={ctx} extraEvents={extraEvents} />
                  : <p className="mne-help">No transactions mapped to this grant yet.</p>}
              </>
            ) : (
              <>
                <div className="lot-stats">
                  <Stat label="Granted" value={fmtQty(total)} sub={`${formatDateMDY(grant.vest_start)} → ${formatDateMDY(grant.vest_end)}`} subClassName="mne-muted" />
                  <Stat label="Vested" value={fmtQty(vesting.vestedShares)} sub={`${vestedPct.toFixed(0)}% · ${fmtQty(summary.shares)} held`} subClassName="mne-muted" />
                  <Stat label="Unvested" value={fmtQty(vesting.unvestedShares)}
                    sub={grant.ended_at ? `Ended ${formatDateMDY(grant.ended_at)}` : next ? `next ${formatDateMDY(next.key)}` : undefined} subClassName="mne-muted" />
                  <Stat label="Held gain"
                    value={summary.gain !== null ? <Hide hidden={hideValues}>{summary.gain < 0 ? '−' : ''}{fmtMoney0(Math.abs(summary.gain))}</Hide> : <span className="mne-muted">—</span>} />
                </div>
                <ProgressBar pct={vestedPct} tone="accent" />
                <div className="lot-between">
                  <div className="mne-help">
                    {freq && <>{freq} vesting</>}
                    {next && <>{freq ? ' · ' : ''}+{qtyText(next.shares)} in {next.days} {plural(next.days, 'day', 'days')}</>}
                    {grant.ended_at && <>{freq ? ' · ' : ''}Ended {formatDateMDY(grant.ended_at)}</>}
                  </div>
                  {actions}
                </div>
                {group.transactions.length > 0 ? (
                  <LotDisclosure label="vest lots" count={`${group.transactions.length} ${plural(group.transactions.length, 'lot', 'lots')}`}>
                    <StockLotRows lots={[...lots].sort((a, b) => String(b.date).localeCompare(String(a.date)))} ctx={ctx} />
                  </LotDisclosure>
                ) : (
                  <p className="mne-help">No transactions mapped to this grant yet.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="lot-stack">
      {subtypesWithActivity.map((st: any) => {
        const transactions = st.transactions ?? []
        const rsuGrants = sortRsuGrants(st.rsu_grants ?? [])
        const isRsuSubtype = st.subtype === 'RSU'
        const rsuGrantGroups = isRsuSubtype ? groupRsuActivityByGrant(rsuGrants, transactions) : null
        const isSubtypeOpen = !collapsedSubtypeIds.has(st.id)
        const esopGrants = st.esop_grants ?? []
        const isEsopSubtype = st.subtype === 'ESOP'

        return (
          <div key={st.id} className="pf-sub">
            <button
              type="button"
              className="pf-disclose"
              onClick={() => toggleIn(setCollapsedSubtypeIds, st.id)}
              aria-expanded={isSubtypeOpen}
            >
              <span className="lot-flex">
                <Chevron open={isSubtypeOpen} />
                <span className="mne-eyebrow">{st.subtype}</span>
              </span>
              <span className="mne-help">
                {isEsopSubtype
                  ? <>{esopGrants.length} {plural(esopGrants.length, 'option grant', 'option grants')}</>
                  : <>{transactions.length} {plural(transactions.length, 'transaction', 'transactions')}</>}
                {rsuGrants.length > 0 && <> · {rsuGrants.length} {plural(rsuGrants.length, 'grant', 'grants')}</>}
              </span>
            </button>

            {isSubtypeOpen && (
              <div className="pf-fade" style={{ marginTop: 8 }}>
                {isEsopSubtype ? (
                  <EsopGrantList
                    grants={esopGrants}
                    price={price}
                    onExercise={onExerciseOptions}
                    onEndGrant={onEndEsopGrant}
                    onDeleteGrant={onDeleteEsopGrant}
                  />
                ) : isRsuSubtype && rsuGrantGroups ? (
                  <div className="lot-stack">
                    {rsuGrantGroups.grants.map(group => renderGrant(group))}

                    {rsuGrantGroups.unassignedTransactions.length > 0 && (
                      <div>
                        <div className="mne-eyebrow" style={{ marginBottom: 8 }}>Unmatched Transactions</div>
                        {renderLots(rsuGrantGroups.unassignedTransactions, { summary: false })}
                      </div>
                    )}
                  </div>
                ) : (
                  renderLots(transactions)
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Soonest vest installment after today, or null (ended / continuous / done). */
function nextVestEvent(grant: any, today: Date) {
  const todayKey = toIsoKey(today)
  const ev = computeRsuVestEvents(grant).find(e => e.date.toISOString().slice(0, 10) > todayKey)
  if (!ev) return null
  const key = ev.date.toISOString().slice(0, 10)
  const date = parseIsoDate(key)
  return { key, shares: ev.shares, days: date ? daysBetween(today, date) : 0 }
}

function groupRsuActivityByGrant(grants: any[], transactions: any[]) {
  const grantGroups = sortRsuGrants(grants)
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

