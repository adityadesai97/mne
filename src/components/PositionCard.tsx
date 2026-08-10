// src/components/PositionCard.tsx
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Briefcase, Landmark, Banknote, PiggyBank, Shield, Wallet, ChevronRight } from 'lucide-react'
import { computeAssetValue, computeCostBasis, computeUnrealizedGain, computeShareCount } from '@/lib/portfolio'
import { colorForAssetType } from '@/lib/typeColors'

function AssetIcon({ asset }: { asset: any }) {
  if (asset.asset_type === 'Stock') {
    if (asset.ticker?.logo) {
      return (
        <img
          src={asset.ticker.logo}
          className="w-9 h-9 rounded-xl object-contain bg-muted flex-shrink-0"
          alt={asset.ticker?.symbol ?? ''}
        />
      )
    }
    return (
      <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
        {asset.ticker?.symbol?.slice(0, 2) ?? '??'}
      </div>
    )
  }

  const iconMap: Record<string, React.ElementType> = {
    '401k': Briefcase,
    'CD': Landmark,
    'Cash': Banknote,
    'Deposit': PiggyBank,
    'HSA': Shield,
  }
  const IconComponent = iconMap[asset.asset_type] ?? Wallet

  return (
    <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
      <IconComponent size={17} className="text-muted-foreground" />
    </div>
  )
}

/**
 * A position in the Portfolio view. Two layouts share the same underlying
 * figures: `'grid'` (default) is a tile with a type-colored top accent and a
 * footer bar showing this position's share of total net worth — real,
 * already-available data (value / portfolioTotal), not a fabricated
 * per-position history. `'list'` is a compact row (type-colored left bar
 * instead of a top one, a bare share-of-net-worth bar instead of the
 * labeled footer) for when the grid's per-card chrome feels like too much
 * at a glance across many positions — same figures, lower chrome.
 */
export function PositionCard({ asset, index = 0, portfolioTotal = 0, layout = 'grid' }: { asset: any; index?: number; portfolioTotal?: number; layout?: 'grid' | 'list' }) {
  const isStock = asset.asset_type === 'Stock'
  const noPriceData = isStock && asset.ticker?.current_price == null
  const value = computeAssetValue(asset)
  const gain = computeUnrealizedGain(asset)
  const basis = computeCostBasis(asset)
  const gainPct = basis > 0 ? (gain / basis) * 100 : 0
  const isGain = gain >= 0
  const shareCount = isStock ? computeShareCount(asset) : 0
  const accent = colorForAssetType(asset.asset_type, index)
  const sharePct = portfolioTotal > 0 ? Math.min(100, (value / portfolioTotal) * 100) : 0

  if (layout === 'list') {
    return (
      <motion.div
        className="mx-4 mb-2"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: Math.min(index, 10) * 0.02, ease: [0.25, 0.1, 0.25, 1] as const }}
        whileTap={{ scale: 0.99, transition: { duration: 0.1 } }}
      >
        <Link to={`/portfolio/${asset.id}`} className="block">
          {/* Same type-colored accent + rounded surface language as the grid
              tile (there it's a top bar; here, rotated to a left bar so it
              reads the same way in a row) — so switching layouts doesn't
              feel like switching themes. A hover tint gives rows the same
              "this is clickable" affordance a tile gets from lifting on
              hover, without the lift itself reading oddly on something this
              thin. */}
          <Card className="relative overflow-hidden hover:bg-muted/40">
            <div className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: accent }} aria-hidden="true" />
            <CardContent className="p-3.5">
              <div className="flex gap-3 items-center">
                <AssetIcon asset={asset} />
                <div className="flex-1 text-left min-w-0">
                  <p className="font-medium truncate">{asset.name}</p>
                  <p className="text-muted-foreground text-xs truncate">
                    {/* Share count comes from owned lots, not the quote, so it's
                        worth printing even while the price itself is pending. */}
                    {asset.location?.name} · {asset.asset_type}{isStock ? ` · ${fmtShares(shareCount)} sh` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="text-right">
                    {isStock ? (
                      noPriceData ? (
                        <>
                          <p className="font-semibold text-lg text-muted-foreground">—</p>
                          <p className="text-xs text-muted-foreground">Price pending</p>
                        </>
                      ) : (
                        <>
                          <p className="font-semibold font-syne tabular-nums">{fmt(value)}</p>
                          <p className={`text-sm tabular-nums ${isGain ? 'text-gain' : 'text-loss'}`} title={`Cost basis ${fmt(basis)}`}>
                            {isGain ? '+' : ''}{fmt(gain)} ({gainPct.toFixed(1)}%)
                          </p>
                        </>
                      )
                    ) : (
                      <p className="font-semibold font-syne tabular-nums">{fmt(value)}</p>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" />
                </div>
              </div>
              {/* Share of total net worth, condensed to a bare bar (no label —
                  the grid tile spells this figure out, but a row's job is to
                  stay scannable at a glance across a long list; the relative
                  bar length alone is enough to compare positions at a glance). */}
              {portfolioTotal > 0 && (
                <div className="mt-2.5 h-[2px] bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${sharePct}%`, backgroundColor: accent }} />
                </div>
              )}
            </CardContent>
          </Card>
        </Link>
      </motion.div>
    )
  }

  const cardInner = (
    <CardContent className="p-4 flex flex-col h-full">
      <div className="flex gap-3 items-start">
        <AssetIcon asset={asset} />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{asset.name}</p>
          <p className="text-muted-foreground text-xs truncate">{asset.location?.name} · {asset.asset_type}</p>
        </div>
      </div>

      <div className="mt-3.5 flex-1">
        {isStock ? (
          noPriceData ? (
            <>
              {/* Same text-lg/leading-tight rhythm as the priced state below,
                  so a card waiting on a quote doesn't sit shorter than its
                  neighbors in the same grid row. */}
              <p className="font-semibold text-lg font-syne leading-tight text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground mt-0.5">Price pending</p>
            </>
          ) : (
            <>
              <p className="font-semibold text-lg font-syne tabular-nums leading-tight">{fmt(value)}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-muted-foreground tabular-nums">{fmtShares(shareCount)} sh</span>
                <span className={`text-xs tabular-nums font-medium ${isGain ? 'text-gain' : 'text-loss'}`} title={`Cost basis ${fmt(basis)}`}>
                  {isGain ? '+' : ''}{fmt(gain)} ({gainPct.toFixed(1)}%)
                </span>
              </div>
            </>
          )
        ) : (
          <p className="font-semibold text-lg font-syne tabular-nums leading-tight">{fmt(value)}</p>
        )}
      </div>

      {/* Share of total net worth — a real, already-available figure (value /
          portfolioTotal), colored to match this asset's type. */}
      {portfolioTotal > 0 && (
        <div className="mt-3.5 pt-3 border-t border-white/[0.05]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Of Portfolio</span>
            <span className="text-[10px] tabular-nums font-medium" style={{ color: accent }}>{sharePct.toFixed(1)}%</span>
          </div>
          <div className="h-[3px] bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${sharePct}%`, backgroundColor: accent }} />
          </div>
        </div>
      )}
    </CardContent>
  )

  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 10) * 0.03, ease: [0.25, 0.1, 0.25, 1] as const }}
      whileHover={{ y: -3, transition: { duration: 0.15, ease: [0.25, 0.1, 0.25, 1] as const } }}
      whileTap={{ scale: 0.985, transition: { duration: 0.1 } }}
    >
      <Link to={`/portfolio/${asset.id}`} className="block h-full">
        <Card className="h-full relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: accent }} aria-hidden="true" />
          {cardInner}
        </Card>
      </Link>
    </motion.div>
  )
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}

function fmtShares(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}
