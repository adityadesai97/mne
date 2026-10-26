// src/components/PositionCard.tsx
import { Link, useNavigate } from 'react-router-dom'
import { computeAssetValue, computeCostBasis, computeDailyChange, computeShareCount, isTradableFixedIncome, computeFixedIncomeLotCount, isTickerAsset } from '@/lib/portfolio'
import { useHideValues, hiddenValueClass } from '@/hooks/useHideValues'
import { Delta } from '@/components/mne'
import { AssetLogo } from '@/components/AssetLogo'
import { AssetTags } from '@/components/AssetTags'
import '@/styles/portfolio.css'

function caption(asset: any): string {
  const parts: string[] = []
  if (isTickerAsset(asset) && asset.ticker?.symbol) parts.push(asset.ticker.symbol)
  if (asset.location?.name) parts.push(asset.location.name)
  if (asset.asset_type === 'Fixed Income' && asset.fixed_income_subtype) parts.push(asset.fixed_income_subtype)
  else if (!isTickerAsset(asset)) parts.push(asset.asset_type)
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
  const pct = isStock ? (computeDailyChange(asset)?.percentChange ?? null) : null
  const [hideValues] = useHideValues()
  const navigate = useNavigate()
  const href = `/portfolio/${asset.id}`
  const qtyLabel = isStock
    ? `${fmtShares(shareCount, isCrypto ? 8 : 2)} ${isCrypto ? 'units' : 'shares'}`
    : isTradable ? `${fmtShares(unitCount)} units` : null

  if (layout === 'list') {
    const gain = isStock && basis > 0 && !noPriceData ? value - basis : null
    return (
      <tr className="pf-table-row" onClick={() => navigate(href)}>
        <td>
          <div className="pf-rowhead">
            <AssetLogo asset={asset} />
            <div className="pf-rowtext">
              <Link to={href} onClick={e => e.stopPropagation()} className="pf-rowname">
                {asset.name}
                <span className="sub">{caption(asset)}</span>
              </Link>
              <AssetTags asset={asset} />
            </div>
          </div>
        </td>
        <td className="r pf-hide-sm"><span className={hiddenValueClass(hideValues)}>{qtyLabel ? qtyLabel.split(' ')[0] : '—'}</span></td>
        <td className="r">
          {noPriceData ? <span className="mne-muted">Price pending</span> : <span className={hiddenValueClass(hideValues)}>{fmt(value)}</span>}
        </td>
        <td className="r pf-hide-sm">
          {gain != null
            ? <span className={hiddenValueClass(hideValues)}><Delta value={gain} format={abs => fmt(abs)} /></span>
            : <span className="mne-muted">—</span>}
        </td>
      </tr>
    )
  }

  return (
    <Link to={href} className="mne-card pf-card pf-fade">
      <div className="pf-card-head">
        <AssetLogo asset={asset} />
        <div>
          <b>{asset.name}</b>
          <div className="mne-muted pf-cap">{caption(asset)}</div>
        </div>
        <AssetTags asset={asset} />
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
              <span className="max-sm:hidden"> · cost <span className={hiddenValueClass(hideValues)}>{fmt(basis)}</span></span>
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
