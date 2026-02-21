// src/pages/Tax.tsx
import { useEffect, useState } from 'react'
import { getAllAssets } from '@/lib/db/assets'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Tax() {
  const [assets, setAssets] = useState<any[]>([])

  useEffect(() => { getAllAssets().then(setAssets).catch(console.error) }, [])

  const allLots = assets.flatMap(a =>
    (a.stock_subtypes ?? []).flatMap((st: any) =>
      (st.transactions ?? []).map((t: any) => ({
        ...t,
        assetName: a.name,
        ticker: a.ticker,
      }))
    )
  )

  const shortTerm = allLots.filter(t => t.capital_gains_status === 'Short Term')
  const longTerm = allLots.filter(t => t.capital_gains_status === 'Long Term')

  function lotGain(t: any) {
    return Number(t.count) * ((t.ticker?.current_price ?? 0) - Number(t.cost_price))
  }

  const shortGain = shortTerm.reduce((s, t) => s + lotGain(t), 0)
  const longGain = longTerm.reduce((s, t) => s + lotGain(t), 0)
  const harvestCandidates = allLots.filter(t => lotGain(t) < -1000)

  return (
    <div className="pt-6 pb-4 px-4 space-y-4">
      <h1 className="text-xl font-bold">Tax</h1>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Short-Term Gains</CardTitle></CardHeader>
          <CardContent><p className={`text-xl font-bold ${shortGain >= 0 ? 'text-gain' : 'text-loss'}`}>{fmt(shortGain)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Long-Term Gains</CardTitle></CardHeader>
          <CardContent><p className={`text-xl font-bold ${longGain >= 0 ? 'text-gain' : 'text-loss'}`}>{fmt(longGain)}</p></CardContent>
        </Card>
      </div>
      {harvestCandidates.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Tax Loss Harvest Candidates</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {harvestCandidates.map(t => (
              <div key={t.id} className="flex justify-between text-sm">
                <span>{t.assetName}</span>
                <span className="text-loss">{fmt(lotGain(t))}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}
