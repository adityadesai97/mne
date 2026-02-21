// src/components/PositionCard.tsx
import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { TaxLotList } from './TaxLotList'
import { computeAssetValue, computeCostBasis, computeUnrealizedGain } from '@/lib/portfolio'

export function PositionCard({ asset }: { asset: any }) {
  const [expanded, setExpanded] = useState(false)
  const value = computeAssetValue(asset)
  const gain = computeUnrealizedGain(asset)
  const basis = computeCostBasis(asset)
  const gainPct = basis > 0 ? (gain / basis) * 100 : 0
  const isGain = gain >= 0

  return (
    <Card className="mx-4 mb-2">
      <CardContent className="p-4">
        <button className="w-full" onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
          <div className="flex justify-between items-start">
            <div className="text-left">
              <p className="font-medium">{asset.name}</p>
              <p className="text-muted-foreground text-xs">{asset.location_name} · {asset.asset_type}</p>
            </div>
            <div className="text-right">
              <p className="font-medium">{fmt(value)}</p>
              <p className={`text-sm ${isGain ? 'text-gain' : 'text-loss'}`}>
                {isGain ? '+' : ''}{fmt(gain)} ({gainPct.toFixed(1)}%)
              </p>
            </div>
          </div>
          <div className="flex justify-end mt-1">
            {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </div>
        </button>
        {expanded && asset.stock_subtypes?.length > 0 && (
          <TaxLotList subtypes={asset.stock_subtypes} ticker={asset.ticker} />
        )}
        {expanded && asset.notes && (
          <p className="mt-2 text-muted-foreground text-xs border-t border-border pt-2">{asset.notes}</p>
        )}
      </CardContent>
    </Card>
  )
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}
