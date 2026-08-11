// src/components/PositionCard.tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Briefcase, Landmark, Banknote, Shield, Wallet, ChartNoAxesCombined, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react'
import { computeAssetValue, computeCostBasis, computeUnrealizedGain, computeShareCount } from '@/lib/portfolio'
import { colorForAssetType, colorForTicker } from '@/lib/typeColors'
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
        <ChartNoAxesCombined size={19} style={{ color: accent }} />
      </div>
    )
  }

  const iconMap: Record<string, React.ElementType> = {
    '401k': Briefcase,
    'Fixed Income': Landmark,
    'Cash': Banknote,
    'HSA': Shield,
  }
  const IconComponent = iconMap[asset.asset_type] ?? Wallet

  return (
    <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
      <IconComponent size={19} style={{ color: accent }} />
    </div>
  )
}

/** Plain muted icon chip for the simplified list layout — no block color,
 *  no async logo-color sampling, matching that layout's lower-chrome intent. */
function LegacyAssetIcon({ asset }: { asset: any }) {
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
      <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
        <ChartNoAxesCombined size={16} className="text-muted-foreground" />
      </div>
    )
  }

  const iconMap: Record<string, React.ElementType> = {
    '401k': Briefcase,
    'Fixed Income': Landmark,
    'Cash': Banknote,
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
 * A position in the Portfolio view. `'grid'` (default) is a large square
 * tile with a solid block-color background: non-stock assets get the
 * shared per-asset-type color (src/lib/typeColors.ts); stocks get their
 * own company's color, sampled from the ticker's logo (src/lib/logoColor.ts)
 * when that succeeds, or a color hashed from the ticker symbol otherwise
 * (rather than one flat Stock-type blue for every unlogo'd ticker — mostly
 * ETFs in practice). A tile renders immediately on its fallback color and
 * may recolor a moment later once its logo's sampled color resolves.
 *
 * `'list'` is the simplified/legacy view (Settings → Appearance → Asset
 * view): a plain compact row with no block color and no logo-color
 * sampling, for users who'd rather scan a calm list than a wall of colored
 * tiles.
 */
export function PositionCard({ asset, index = 0, layout = 'grid' }: { asset: any; index?: number; layout?: 'grid' | 'list' }) {
  const isStock = asset.asset_type === 'Stock'
  const noPriceData = isStock && asset.ticker?.current_price == null
  const value = computeAssetValue(asset)
  const gain = computeUnrealizedGain(asset)
  const basis = computeCostBasis(asset)
  const gainPct = basis > 0 ? (gain / basis) * 100 : 0
  const isGain = gain >= 0
  const shareCount = isStock ? computeShareCount(asset) : 0

  const fallbackColor = isStock
    ? colorForTicker(asset.ticker?.symbol ?? asset.name ?? String(index))
    : colorForAssetType(asset.asset_type, index)
  const logoUrl = asset.ticker?.logo as string | undefined
  const [accent, setAccent] = useState(fallbackColor)

  useEffect(() => {
    if (layout !== 'grid') return
    setAccent(fallbackColor)
    if (!isStock || !logoUrl) return
    let cancelled = false
    getLogoColor(logoUrl).then((color) => {
      if (!cancelled && color) setAccent(color)
    })
    return () => { cancelled = true }
  }, [layout, isStock, logoUrl, fallbackColor])

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
          {/* A hover tint gives rows the same "this is clickable" affordance
              a tile gets from lifting on hover, without the lift itself
              reading oddly on something this thin. */}
          <Card className="hover:bg-muted/40">
            <CardContent className="p-3.5">
              <div className="flex gap-3 items-center">
                <LegacyAssetIcon asset={asset} />
                <div className="flex-1 text-left min-w-0">
                  <p className="font-medium truncate">{asset.name}</p>
                  <p className="text-muted-foreground text-xs truncate">
                    {/* Share count comes from owned lots, not the quote, so it's
                        worth printing even while the price itself is pending. */}
                    {asset.location?.name} · {asset.asset_type}{asset.asset_type === 'Fixed Income' && asset.fixed_income_subtype ? ` (${asset.fixed_income_subtype})` : ''}{isStock ? ` · ${fmtShares(shareCount)} shares` : ''}
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
            </CardContent>
          </Card>
        </Link>
      </motion.div>
    )
  }

  return (
    <motion.div
      // True square from `sm:` up, where 3-4 columns leave enough width (and
      // therefore square-derived height) to fit a stock's icon + name +
      // value + shares/gain line comfortably. Below that, 2 columns on a
      // narrow phone make a true square too short for that same content —
      // it was spilling out past the tile's bottom edge — so mobile gets a
      // taller-than-wide ratio instead of a literal square.
      className="aspect-[3/4] sm:aspect-square"
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
            <p className="text-white/70 text-xs truncate">{asset.location?.name} · {asset.asset_type}{asset.asset_type === 'Fixed Income' && asset.fixed_income_subtype ? ` (${asset.fixed_income_subtype})` : ''}</p>
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
                    <span className="text-[11px] text-white/70 tabular-nums">{fmtShares(shareCount)} shares</span>
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
