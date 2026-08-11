// src/components/PositionCard.tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Briefcase, Landmark, Banknote, PiggyBank, Shield, Wallet, ChartCandlestick, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { computeAssetValue, computeCostBasis, computeUnrealizedGain, computeShareCount } from '@/lib/portfolio'
import { colorForAssetType } from '@/lib/typeColors'
import { getLogoColor } from '@/lib/logoColor'

function AssetIcon({ asset, accent }: { asset: any; accent: string }) {
  if (asset.asset_type === 'Stock') {
    if (asset.ticker?.logo) {
      // Opaque white backing regardless of the tile's own color — a logo
      // that IS that color (which it usually is, since the tile's color was
      // very likely sampled from this same logo) would otherwise disappear
      // into its own background.
      return (
        <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm p-1.5">
          <img src={asset.ticker.logo} className="w-full h-full object-contain" alt={asset.ticker?.symbol ?? ''} />
        </div>
      )
    }
    // No logo on file yet (still backfilling, or the profile fetch never
    // found one) — a generic "this is a stock" glyph reads better here than
    // ticker-symbol initials, which look like a broken-logo placeholder
    // rather than an intentional choice.
    return (
      <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
        <ChartCandlestick size={19} style={{ color: accent }} />
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
    <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
      <IconComponent size={19} style={{ color: accent }} />
    </div>
  )
}

/**
 * A large square position tile in the Portfolio grid. The background is a
 * solid block color: non-stock assets get the shared per-asset-type color
 * (src/lib/typeColors.ts); stocks get their own company's color, sampled
 * from the ticker's logo (src/lib/logoColor.ts) when that succeeds. Every
 * tile therefore renders immediately on its type color and may recolor a
 * moment later once its logo's sampled color resolves — sampling is async
 * and best-effort, never something the tile waits on to render.
 */
export function PositionCard({ asset, index = 0 }: { asset: any; index?: number }) {
  const isStock = asset.asset_type === 'Stock'
  const noPriceData = isStock && asset.ticker?.current_price == null
  const value = computeAssetValue(asset)
  const gain = computeUnrealizedGain(asset)
  const basis = computeCostBasis(asset)
  const gainPct = basis > 0 ? (gain / basis) * 100 : 0
  const isGain = gain >= 0
  const shareCount = isStock ? computeShareCount(asset) : 0

  const typeColor = colorForAssetType(asset.asset_type, index)
  const logoUrl = asset.ticker?.logo as string | undefined
  const [accent, setAccent] = useState(typeColor)

  useEffect(() => {
    setAccent(typeColor)
    if (!isStock || !logoUrl) return
    let cancelled = false
    getLogoColor(logoUrl).then((color) => {
      if (!cancelled && color) setAccent(color)
    })
    return () => { cancelled = true }
  }, [isStock, logoUrl, typeColor])

  return (
    <motion.div
      className="aspect-square"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 10) * 0.03, ease: [0.25, 0.1, 0.25, 1] as const }}
      whileHover={{ y: -3, transition: { duration: 0.15, ease: [0.25, 0.1, 0.25, 1] as const } }}
      whileTap={{ scale: 0.985, transition: { duration: 0.1 } }}
    >
      <Link to={`/portfolio/${asset.id}`} className="block h-full">
        <div
          className="h-full rounded-2xl shadow-card transition-[box-shadow,background-color] duration-200 ease-out hover:shadow-card-hover p-4 flex flex-col text-white"
          style={{ backgroundColor: accent }}
        >
          <AssetIcon asset={asset} accent={accent} />

          <div className="mt-3 min-w-0">
            <p className="font-semibold truncate [text-shadow:0_1px_2px_rgba(0,0,0,0.15)]">{asset.name}</p>
            <p className="text-white/70 text-xs truncate">{asset.location?.name} · {asset.asset_type}</p>
          </div>

          <div className="mt-auto pt-3">
            {isStock ? (
              noPriceData ? (
                <>
                  <p className="font-semibold text-xl font-syne leading-tight text-white/70">—</p>
                  <p className="text-xs text-white/70 mt-0.5">Price pending</p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-xl font-syne tabular-nums leading-tight">{fmt(value)}</p>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className="text-[11px] text-white/70 tabular-nums">{fmtShares(shareCount)} sh</span>
                    {/* Direction is carried by the arrow icon + sign, not by a
                        green/red hue — a hue picked to signal gain/loss could
                        easily collide with (or vanish into) the tile's own
                        block color. */}
                    <span
                      className="inline-flex items-center gap-0.5 text-[11px] font-semibold bg-white/20 rounded-full pl-1 pr-1.5 py-0.5"
                      title={`Cost basis ${fmt(basis)}`}
                    >
                      {isGain ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                      {gainPct.toFixed(1)}%
                    </span>
                  </div>
                </>
              )
            ) : (
              <p className="font-semibold text-xl font-syne tabular-nums leading-tight">{fmt(value)}</p>
            )}
          </div>
        </div>
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
