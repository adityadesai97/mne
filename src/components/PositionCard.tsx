// src/components/PositionCard.tsx
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Briefcase, Landmark, Banknote, PiggyBank, Shield, Wallet } from 'lucide-react'
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
 * A tile in the Portfolio grid. Rendered inside a responsive multi-column
 * grid (see Portfolio.tsx) rather than a single stacked list, with a
 * type-colored top accent and a footer bar showing this position's share of
 * total net worth — real, already-available data (value / portfolioTotal),
 * not a fabricated per-position history.
 */
export function PositionCard({ asset, index = 0, portfolioTotal = 0 }: { asset: any; index?: number; portfolioTotal?: number }) {
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
              <p className="font-medium text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground">Price pending</p>
            </>
          ) : (
            <>
              <p className="font-semibold text-lg font-syne tabular-nums leading-tight">{fmt(value)}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-muted-foreground tabular-nums">{fmtShares(shareCount)} sh</span>
                <span className={`text-xs tabular-nums font-medium ${isGain ? 'text-gain' : 'text-loss'}`}>
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
