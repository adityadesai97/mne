import { useEffect, useState, type ElementType } from 'react'
import { Banknote, Bitcoin, Briefcase, ChartNoAxesCombined, Heart, Landmark, Wallet } from 'lucide-react'
import { isTickerAsset } from '@/lib/portfolio'

const TYPE_ICONS: Record<string, ElementType> = {
  Crypto: Bitcoin,
  Stock: ChartNoAxesCombined,
  '401k': Briefcase,
  'Fixed Income': Landmark,
  Cash: Banknote,
  HSA: Heart,
}

/**
 * Small rounded logo for an asset: the ticker's logo when it has one and it
 * loads, otherwise a neutral tile with an icon for the asset type. Never a
 * solid brand-colour background.
 */
export function AssetLogo({ asset, size = 'md' }: { asset: any; size?: 'sm' | 'md' | 'lg' }) {
  const logo = isTickerAsset(asset) ? (asset.ticker?.logo as string | undefined) : undefined
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [logo])
  const Icon = TYPE_ICONS[asset.asset_type] ?? Wallet
  const showImg = !!logo && !failed
  return (
    <span className={`pf-logo is-${size}${showImg ? ' has-img' : ''}`} aria-hidden="true">
      {showImg
        ? <img src={logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : <Icon size={size === 'lg' ? 22 : 18} strokeWidth={1.5} />}
    </span>
  )
}
