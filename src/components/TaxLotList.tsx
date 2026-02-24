// src/components/TaxLotList.tsx
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, Trash2, Pencil } from 'lucide-react'

interface EditValues {
  count: string
  cost_price: string
  purchase_date: string
  capital_gains_status: string
}

type EditTransactionUpdates = {
  count: number
  cost_price: number
  purchase_date: string
  capital_gains_status: string
}

export function TaxLotList({ subtypes, ticker, onDeleteTransaction, onEditTransaction, onEndGrant }: {
  subtypes: any[]
  ticker: any
  onDeleteTransaction?: (id: string) => Promise<void>
  onEditTransaction?: (id: string, updates: EditTransactionUpdates) => Promise<void>
  onEndGrant?: (id: string) => Promise<void>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<EditValues>({
    count: '',
    cost_price: '',
    purchase_date: '',
    capital_gains_status: '',
  })
  const subtypesWithActivity = subtypes.filter(
    (st: any) => (st.transactions?.length ?? 0) > 0 || (st.rsu_grants?.length ?? 0) > 0,
  )

  async function handleSave(tId: string) {
    if (!onEditTransaction) return
    await onEditTransaction(tId, {
      count: parseFloat(editValues.count),
      cost_price: parseFloat(editValues.cost_price),
      purchase_date: editValues.purchase_date,
      capital_gains_status: editValues.capital_gains_status,
    })
    setEditingId(null)
  }

  function renderTransactionCard(t: any) {
    const shares = Number(t.count)
    const costPerShare = Number(t.cost_price)
    const currentPrice = ticker?.current_price ?? null
    const totalCost = shares * costPerShare
    const currentValue = currentPrice !== null ? shares * currentPrice : null
    const gain = currentValue !== null ? currentValue - totalCost : null

    if (editingId === t.id) {
      return (
        <div key={t.id} className="border border-border rounded-lg p-3 space-y-2 bg-background">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Shares</label>
              <input
                type="number"
                step="0.01"
                value={editValues.count}
                onChange={e => setEditValues(v => ({ ...v, count: e.target.value }))}
                className="w-full mt-0.5 bg-background border border-border rounded px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Cost/share</label>
              <input
                type="number"
                step="0.01"
                value={editValues.cost_price}
                onChange={e => setEditValues(v => ({ ...v, cost_price: e.target.value }))}
                className="w-full mt-0.5 bg-background border border-border rounded px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Purchase date</label>
              <input
                type="date"
                value={editValues.purchase_date}
                onChange={e => setEditValues(v => ({ ...v, purchase_date: e.target.value }))}
                className="w-full mt-0.5 bg-background border border-border rounded px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Status</label>
              <select
                value={editValues.capital_gains_status}
                onChange={e => setEditValues(v => ({ ...v, capital_gains_status: e.target.value }))}
                className="w-full mt-0.5 bg-background border border-border rounded px-2 py-1 text-xs"
              >
                <option value="Short Term">Short Term</option>
                <option value="Long Term">Long Term</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleSave(t.id)} className="text-xs bg-primary text-primary-foreground hover:opacity-90 px-3 py-1.5 rounded-md transition-opacity font-medium">Save</button>
            <button onClick={() => setEditingId(null)} className="text-xs bg-muted text-muted-foreground hover:bg-muted/80 px-3 py-1.5 rounded-md transition-colors">Cancel</button>
          </div>
        </div>
      )
    }

    return (
      <details key={t.id} className="group rounded-lg border border-border/50 bg-muted/20">
        <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div>
              <p className="text-xs font-medium">{formatDateLabel(t.purchase_date)}</p>
              <p className="text-[11px] text-muted-foreground">
                {shares.toFixed(shares % 1 === 0 ? 0 : 4)} shares @ {fmt(costPerShare)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium tabular-nums ${gain !== null ? (gain >= 0 ? 'text-gain' : 'text-loss') : 'text-muted-foreground'}`}>
                {gain !== null ? `${gain >= 0 ? '+' : ''}${fmt(gain)}` : '—'}
              </span>
              <ChevronDown size={14} className="text-muted-foreground transition-transform group-open:rotate-180" />
            </div>
          </div>
        </summary>

        <div className="px-3 pb-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-2.5">
            <Metric label="Shares" value={shares.toFixed(shares % 1 === 0 ? 0 : 4)} />
            <Metric label="Cost / share" value={fmt(costPerShare)} />
            <Metric label="Amount paid" value={fmt(totalCost)} />
            <Metric
              label="Current value"
              value={currentValue !== null ? fmt(currentValue) : '—'}
              className={currentValue !== null && gain !== null ? (gain >= 0 ? 'text-gain' : 'text-loss') : ''}
            />
            <Metric label="Purchased" value={t.purchase_date ?? '—'} />
            <Metric
              label="Gain / loss"
              value={gain !== null ? `${gain >= 0 ? '+' : ''}${fmt(gain)}` : '—'}
              className={gain !== null ? (gain >= 0 ? 'text-gain' : 'text-loss') : ''}
            />
          </div>

          <div className="flex items-center justify-between">
            <Badge
              variant={t.capital_gains_status === 'Long Term' ? 'secondary' : 'outline'}
              className="text-[10px]"
            >
              {t.capital_gains_status}
            </Badge>
            <div className="flex items-center gap-2">
              {onEditTransaction && (
                <button
                  onClick={() => {
                    setEditingId(t.id)
                    setEditValues({
                      count: String(t.count),
                      cost_price: String(t.cost_price),
                      purchase_date: t.purchase_date,
                      capital_gains_status: t.capital_gains_status,
                    })
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Edit"
                >
                  <Pencil size={12} />
                </button>
              )}
              {onDeleteTransaction && (
                <button onClick={() => onDeleteTransaction(t.id)} className="text-muted-foreground hover:text-destructive transition-colors" aria-label="Delete">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </details>
    )
  }

  return (
    <div className="space-y-5">
      {subtypesWithActivity.map((st: any) => {
        const transactions = st.transactions ?? []
        const rsuGrants = st.rsu_grants ?? []
        const isRsuSubtype = st.subtype === 'RSU'
        const rsuGrantGroups = isRsuSubtype ? groupRsuActivityByGrant(rsuGrants, transactions) : null

        return (
          <div key={st.id}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{st.subtype}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {transactions.length} tx
                {rsuGrants.length > 0 && <> · {rsuGrants.length} grant{rsuGrants.length === 1 ? '' : 's'}</>}
              </p>
            </div>

            {isRsuSubtype && rsuGrantGroups ? (
              <div className="space-y-2">
                {rsuGrantGroups.grants.map(group => {
                  const vesting = computeGrantVesting(group.grant, group.transactions)
                  return (
                    <div key={group.grant.id} className="rounded-lg border border-border/50 bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium">Grant {formatDateLabel(group.grant.grant_date)}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          {group.transactions.length} tx
                        </p>
                      </div>

                      <div className="mt-2 rounded-md border border-border/60 bg-card px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium tabular-nums">{fmtShares(Number(group.grant.total_shares ?? 0))} shares granted</p>
                          {group.grant.ended_at ? (
                            <Badge variant="outline" className="text-[10px]">Ended</Badge>
                          ) : onEndGrant ? (
                            <button
                              onClick={() => { void onEndGrant(group.grant.id) }}
                              className="text-[11px] text-loss bg-loss/10 px-2 py-1 rounded hover:bg-loss/20 transition-colors"
                            >
                              End Grant
                            </button>
                          ) : null}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                          {fmtShares(vesting.unvestedShares)} unvested
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Vesting {formatDateLabel(group.grant.vest_start)} → {formatDateLabel(group.grant.vest_end)}
                          {group.grant.ended_at && <> · Ended {formatDateLabel(group.grant.ended_at)}</>}
                        </p>
                      </div>

                      <div className="mt-2 space-y-2">
                        {group.transactions.length > 0 ? (
                          group.transactions.map((t: any) => renderTransactionCard(t))
                        ) : (
                          <p className="text-[11px] text-muted-foreground">No transactions mapped to this grant yet.</p>
                        )}
                      </div>
                    </div>
                  )
                })}

                {rsuGrantGroups.unassignedTransactions.length > 0 && (
                  <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Unmatched Transactions</p>
                    <div className="space-y-2">
                      {rsuGrantGroups.unassignedTransactions.map((t: any) => renderTransactionCard(t))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((t: any) => renderTransactionCard(t))}
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

function formatDateLabel(value: string | null | undefined) {
  if (!value || value === 'Unknown') return value ?? '—'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function Metric({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-medium tabular-nums mt-0.5 ${className}`}>{value}</p>
    </div>
  )
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Number(n))
}

function fmtShares(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}
