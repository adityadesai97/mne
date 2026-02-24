// src/components/PositionCard.tsx
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronRight, Briefcase, Landmark, Banknote, PiggyBank, Shield, Wallet } from 'lucide-react'
import { computeAssetValue, computeCostBasis, computeUnrealizedGain, computeCashGain, computeCashGainPct } from '@/lib/portfolio'

function AssetIcon({ asset }: { asset: any }) {
  if (asset.asset_type === 'Stock') {
    if (asset.ticker?.logo) {
      return (
        <img
          src={asset.ticker.logo}
          className="w-8 h-8 rounded-lg object-contain bg-muted flex-shrink-0"
          alt={asset.ticker?.symbol ?? ''}
        />
      )
    }
    return (
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
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
    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
      <IconComponent size={16} className="text-muted-foreground" />
    </div>
  )
}

export function PositionCard({ asset }: { asset: any }) {
  const isStock = asset.asset_type === 'Stock'
  const noPriceData = isStock && asset.ticker?.current_price == null
  const value = computeAssetValue(asset)
  const gain = computeUnrealizedGain(asset)
  const basis = computeCostBasis(asset)
  const gainPct = basis > 0 ? (gain / basis) * 100 : 0
  const isGain = gain >= 0
  const cashGain = computeCashGain(asset)
  const cashGainPct = computeCashGainPct(asset)
  const hasCashChange = !isStock && asset.initial_price != null && asset.price !== asset.initial_price

  const cardInner = (
    <CardContent className="p-4">
      <div className="flex gap-3 items-center">
        <AssetIcon asset={asset} />
        <div className="flex-1 text-left min-w-0">
          <p className="font-medium">{asset.name}</p>
          <p className="text-muted-foreground text-xs">{asset.location?.name} · {asset.asset_type}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            {isStock ? (
              noPriceData ? (
                <>
                  <p className="font-medium text-muted-foreground">—</p>
                  <p className="text-xs text-muted-foreground">Price pending</p>
                </>
              ) : (
                <>
                  <p className="font-medium">{fmt(value)}</p>
                  <p className={`text-sm ${isGain ? 'text-gain' : 'text-loss'}`}>
                    {isGain ? '+' : ''}{fmt(gain)} ({gainPct.toFixed(1)}%)
                  </p>
                </>
              )
            ) : (
              <>
                <p className="font-medium">{fmt(value)}</p>
                {hasCashChange && (
                  <p className={`text-sm ${cashGain >= 0 ? 'text-gain' : 'text-loss'}`}>
                    {cashGain >= 0 ? '+' : ''}{fmt(cashGain)} ({cashGainPct.toFixed(1)}%)
                  </p>
                )}
              </>
            )}
          </div>
          <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" aria-hidden="true" />
        </div>
      </div>
    </CardContent>
  )

  return (
    <motion.div
      className="mx-4 mb-2"
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] as const }}
    >
      <Link to={`/portfolio/${asset.id}`} className="block">
        <Card>{cardInner}</Card>
      </Link>
    </motion.div>
  )
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}
