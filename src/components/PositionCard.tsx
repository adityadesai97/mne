// src/components/PositionCard.tsx
import { Link, useNavigate } from 'react-router-dom'
import { computeAssetValue, computeCostBasis, computeShareCount, isTradableFixedIncome, computeFixedIncomeLotCount, isTickerAsset, getPlaidSyncInfo } from '@/lib/portfolio'
import { useHideValues, hiddenValueClass } from '@/hooks/useHideValues'
import { Delta } from '@/components/mne'
import '@/styles/portfolio.css'

const LINK_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
)

/** Percent move vs the ticker's previous close (24h for crypto); null when unknown. */
function todayPct(asset: any): number | null {
  const price = asset.ticker?.current_price
  const prev = asset.ticker?.previous_close
  if (price == null || prev == null || Number(prev) === 0) return null
  return ((Number(price) - Number(prev)) / Number(prev)) * 100
}

function stockPlanTags(asset: any): string[] {
  const tags = new Set<string>()
  for (const st of asset.stock_subtypes ?? []) {
    if ((st.subtype === 'RSU' || st.subtype === 'ESPP') && ((st.transactions?.length ?? 0) > 0 || (st.rsu_grants?.length ?? 0) > 0)) tags.add(st.subtype)
  }
  return Array.from(tags)
}

function caption(asset: any): string {
  const parts: string[] = []
  if (isTickerAsset(asset) && asset.ticker?.symbol) parts.push(asset.ticker.symbol)
  if (asset.location?.name) parts.push(asset.location.name)
  if (asset.asset_type === 'Fixed Income' && asset.fixed_income_subtype) parts.push(asset.fixed_income_subtype)
  else if (!isTickerAsset(asset)) parts.push(asset.asset_type)
  if (asset.ownership) parts.push(asset.ownership)
  return parts.join(' · ')
}

/**
 * A position in the Portfolio view, in the design system's PositionTiles
 * shape: a `mne-card` tile (grid) or a `mne-table` row (list). No per-asset
 * colour; direction is carried by sign + arrow + colour via <Delta>.
 */
export function PositionCard({ asset, layout = 'grid' }: { asset: any; index?: number; layout?: 'grid' | 'list' }) {
  const isStock = isTickerAsset(asset)
  const isCrypto = asset.asset_type === 'Crypto'
  const isTradable = isTradableFixedIncome(asset)
  const noPriceData = isStock && asset.ticker?.current_price == null
  const value = computeAssetValue(asset)
  const basis = computeCostBasis(asset)
  const shareCount = isStock ? computeShareCount(asset) : 0
  const unitCount = isTradable ? computeFixedIncomeLotCount(asset) : 0
  const plaidSync = getPlaidSyncInfo(asset)
  const pct = isStock ? todayPct(asset) : null
  const tags = isStock ? stockPlanTags(asset) : []
  const [hideValues] = useHideValues()
  const navigate = useNavigate()
  const href = `/portfolio/${asset.id}`
  const syncTitle = plaidSync.institutionName ? `Synced via Plaid (${plaidSync.institutionName})` : 'Synced via Plaid'
  const qtyLabel = isStock
    ? `${fmtShares(shareCount, isCrypto ? 8 : 2)} ${isCrypto ? 'units' : 'shares'}`
    : isTradable ? `${fmtShares(unitCount)} units` : null

  if (layout === 'list') {
    const gain = isStock && basis > 0 && !noPriceData ? value - basis : null
    return (
      <tr className="pf-table-row" onClick={() => navigate(href)}>
        <td>
          <Link to={href} onClick={e => e.stopPropagation()}>
            {asset.name}
            <span className="sub">{caption(asset)}</span>
          </Link>
          {(plaidSync.synced || tags.length > 0) && (
            <span className="pf-card-chips" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
              {plaidSync.synced && <span className="mne-chip is-synced is-outline" title={syncTitle}>{LINK_ICON}Synced</span>}
              {tags.map(t => <span key={t} className="mne-chip is-tag">{t}</span>)}
            </span>
          )}
        </td>
        <td className="r pf-hide-sm">{qtyLabel ? qtyLabel.split(' ')[0] : '—'}</td>
        <td className="r">
          {noPriceData ? <span className="mne-muted">Price pending</span> : <span className={hiddenValueClass(hideValues)}>{fmt(value)}</span>}
        </td>
        <td className="r pf-hide-sm">
          {gain != null
            ? <span className={hiddenValueClass(hideValues)}><Delta value={gain} format={abs => fmt(abs)} /></span>
            : <span className="mne-muted">—</span>}
        </td>
        <td className="r">{pct != null ? <Delta value={pct} digits={1} /> : <span className="mne-muted">—</span>}</td>
      </tr>
    )
  }

  return (
    <Link to={href} className="mne-card pf-card pf-fade">
      <div className="pf-card-head">
        <div>
          <b>{asset.name}</b>
          <div className="mne-muted pf-cap">{caption(asset)}</div>
        </div>
        {(plaidSync.synced || tags.length > 0) && (
          <div className="pf-card-chips">
            {plaidSync.synced && <span className="mne-chip is-synced is-outline" title={syncTitle}>{LINK_ICON}Synced</span>}
            {tags.map(t => <span key={t} className="mne-chip is-tag">{t}</span>)}
          </div>
        )}
      </div>
      {noPriceData ? (
        <>
          <div className="mne-hero-figure mne-muted" style={{ fontSize: 34, lineHeight: '40px' }}>—</div>
          <div className="mne-help" style={{ marginTop: 6 }}>Price pending{qtyLabel ? ` · ${qtyLabel}` : ''}</div>
        </>
      ) : (
        <>
          <div className={`mne-hero-figure ${hiddenValueClass(hideValues)}`} style={{ fontSize: 34, lineHeight: '40px' }}>{fmt(value)}</div>
          {pct != null && (
            <div><Delta value={pct} digits={1} suffix={isCrypto ? 'in 24h' : 'today'} /></div>
          )}
          <div className="mne-help" style={{ marginTop: 6 }}>
            {qtyLabel ?? asset.asset_type}
            {(isStock || isTradable) && basis > 0 && (
              <> · cost <span className={hiddenValueClass(hideValues)}>{fmt(basis)}</span></>
            )}
          </div>
        </>
      )}
    </Link>
  )
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function fmtShares(n: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(n)
}
